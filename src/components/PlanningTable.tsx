import {
  buildClosureLabelByDate,
  dateKey,
  formatDayLabel,
  getLeafSlots,
  shiftKey,
  slotKey,
  type PlanningWeek,
} from "@/lib/planning";
import type { ClosureInfo, ShiftMap } from "@/lib/planningData";
import {
  assignToShift,
  removeFromShift,
  requestReplacement,
  cancelReplacementRequest,
  fulfillShiftReplacement,
} from "@/lib/actions/planning";
import { SEAT_REQUIREMENTS, type SeatSpec } from "@/lib/autoSchedule";
import { POSTE_LABELS, canCoverPoste, canReplaceAssignee, isValidPoste } from "@/lib/postes";
import PlanningAssignSelect from "./PlanningAssignSelect";

type ActiveUser = { id: string; name: string; role: string; poste: string | null };

// Fonction Excel (précise, propre au créneau) si connue, sinon poste fixé
// sur la fiche du/de la bénévole (Accueil/Retour/Sortie) en repli — voir
// ShiftAssignee dans lib/planningData.ts.
function roleLabel(fonction: string | null, poste: string | null): string | null {
  if (fonction) return fonction;
  if (poste && isValidPoste(poste)) return POSTE_LABELS[poste];
  return null;
}

// Éligibilité d'un·e bénévole pour un siège de la structure (voir
// SEAT_REQUIREMENTS dans autoSchedule.ts) au moment de l'assignation
// manuelle : un·e responsable/comité est toujours proposé·e, quel que
// soit son poste (souvent non renseigné) ; sinon la hiérarchie des
// postes s'applique (canCoverPoste). Pour un siège "responsable" — y
// compris à Gland — un·e bénévole de niveau Sortie est toujours
// proposé·e en repli manuel (utile p. ex. pendant l'absence prolongée
// d'une responsable) : contrairement à la répartition automatique
// (SEAT_REQUIREMENTS), Gland n'est pas restreint ici.
function isEligibleForSeat(seat: SeatSpec, user: ActiveUser): boolean {
  if (user.role === "RESPONSABLE" || user.role === "COMITE") return true;
  if (seat.kind === "open") return true;
  if (seat.kind === "responsable") {
    return user.poste === "SORTIE";
  }
  return !!user.poste && isValidPoste(user.poste) && canCoverPoste(user.poste, seat.posteRequired!);
}

// Une fois pourvu, le siège Responsable/Sortie et le siège Retour
// disparaissent (une seule personne suffit) — mais pas le siège Accueil,
// car certaines ouvertures ont besoin de 2 personnes en accueil (ni la
// place Anim./accueil, ouverte à tou·te·s sans limite).
function seatHidesWhenFilled(seat: SeatSpec): boolean {
  return seat.kind === "responsable" || (seat.kind === "poste" && seat.posteRequired === "RETOUR");
}

export default function PlanningTable({
  weeks,
  shiftsByKey,
  closures = [],
  editable,
  activeUsers,
  currentUserId,
  currentUserRole,
  currentUserPoste,
  isOrg,
}: {
  weeks: PlanningWeek[];
  shiftsByKey: ShiftMap;
  closures?: ClosureInfo[];
  editable: boolean;
  activeUsers: ActiveUser[];
  currentUserId: string;
  currentUserRole: string;
  currentUserPoste: string | null;
  isOrg: boolean;
}) {
  const leaves = getLeafSlots();
  const closureByDate = buildClosureLabelByDate(closures);
  const nyonCount = leaves.filter((l) => l.site === "NYON").length;
  // Bordure pour marquer visuellement la frontière entre le bloc Nyon (à
  // gauche, ~3/4 de la largeur) et le bloc Gland (à droite).
  const siteDivider = (i: number) => (i === nyonCount ? "border-l-2 border-l-stone-300" : "");

  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="w-full min-w-[800px] table-fixed border-collapse text-sm">
        <colgroup>
          {leaves.map((leaf, i) => (
            <col
              key={i}
              style={{
                width: `${
                  leaf.site === "NYON" ? 75 / nyonCount : 25 / (leaves.length - nyonCount)
                }%`,
              }}
            />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-stone-200">
            <th
              colSpan={nyonCount}
              className="bg-brand-blue-soft/50 px-3 py-1.5 text-center font-medium text-stone-700"
            >
              Nyon
            </th>
            <th
              colSpan={leaves.length - nyonCount}
              className="border-l-2 border-l-stone-300 bg-brand-yellow-soft/50 px-3 py-1.5 text-center font-medium text-stone-700"
            >
              Gland
            </th>
          </tr>
          <tr className="border-b border-stone-200 bg-stone-50">
            {leaves.map((leaf, i) => (
              <th
                key={i}
                className={`border-r border-stone-200 px-3 py-2 text-left font-medium text-stone-700 last:border-r-0 ${siteDivider(
                  i
                )}`}
              >
                {leaf.groupLabel}
                <div className="text-xs font-normal text-stone-400">{leaf.hours}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr
              key={week.monday.toISOString()}
              className={`border-b border-stone-100 last:border-b-0 ${
                wi % 2 === 1 ? "bg-stone-100" : ""
              }`}
            >
              {week.cells.map((cell, i) => {
                const key = shiftKey(cell.date, cell.leaf.site, cell.leaf.periode);
                const shift = shiftsByKey.get(key);
                const assignees = shift?.assignees ?? [];
                const availableUsers = activeUsers.filter(
                  (u) => !assignees.some((a) => a.userId === u.id)
                );
                const seats = SEAT_REQUIREMENTS[slotKey(cell.leaf.groupKey, cell.leaf.site)] ?? [];
                const closureLabel = closureByDate.get(dateKey(cell.date));
                if (closureLabel) {
                  return (
                    <td
                      key={i}
                      className={`align-top border-r border-stone-100 bg-stone-100 p-2 last:border-r-0 ${siteDivider(
                        i
                      )} ${cell.inMonth ? "" : "opacity-60"}`}
                    >
                      <div
                        className={`text-xs font-medium ${
                          cell.inMonth ? "text-stone-700" : "text-stone-400"
                        }`}
                      >
                        {formatDayLabel(cell.date)}
                      </div>
                      <p className="mt-1 text-xs italic text-stone-400">
                        Fermé — {closureLabel}
                      </p>
                    </td>
                  );
                }
                return (
                  <td
                    key={i}
                    className={`align-top border-r border-stone-100 p-2 last:border-r-0 ${siteDivider(
                      i
                    )} ${cell.inMonth ? "" : "bg-stone-50/60"}`}
                  >
                    <div
                      className={`text-xs font-medium ${
                        cell.inMonth ? "text-stone-700" : "text-stone-400"
                      }`}
                    >
                      {formatDayLabel(cell.date)}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {assignees.length === 0 && (
                        <li className="text-xs text-stone-300">—</li>
                      )}
                      {assignees.map((a) => {
                        const canManage = editable || isOrg || a.userId === currentUserId;
                        // Un·e bénévole dont le poste ne couvre pas celui à
                        // remplacer voit quand même qu'il y a un trou (pas
                        // d'information cachée), mais ça ne le/la concerne
                        // pas : pas de rouge alarmant, pas de bouton
                        // cliquable, et surtout aucun message expliquant
                        // pourquoi (voir canReplaceAssignee).
                        const eligibleToReplace =
                          a.seekingReplacement &&
                          a.userId !== currentUserId &&
                          canReplaceAssignee(a, { role: currentUserRole, poste: currentUserPoste });
                        return (
                          <li key={a.userId}>
                            <div
                              className={`flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-xs ${
                                a.seekingReplacement
                                  ? eligibleToReplace || a.userId === currentUserId
                                    ? "border border-red-300 bg-red-100 text-red-800"
                                    : "border border-stone-200 bg-stone-100 text-stone-500"
                                  : a.userId === currentUserId
                                    ? "border border-brand-blue bg-brand-blue-soft font-medium text-stone-900"
                                    : "bg-brand-yellow-soft text-stone-800"
                              }`}
                            >
                              <span>
                                {a.name}
                                {roleLabel(a.fonction, a.poste) && (
                                  <span className="text-stone-400"> ({roleLabel(a.fonction, a.poste)})</span>
                                )}
                                {a.seekingReplacement && " ⏳"}
                              </span>
                              {editable && shift && (
                                <form action={removeFromShift}>
                                  <input type="hidden" name="shiftId" value={shift.id} />
                                  <input type="hidden" name="userId" value={a.userId} />
                                  <button
                                    type="submit"
                                    className="text-stone-400 hover:text-red-600"
                                    aria-label={`Retirer ${a.name}`}
                                  >
                                    ×
                                  </button>
                                </form>
                              )}
                            </div>

                            {a.seekingReplacement && canManage && shift && (
                              <form action={cancelReplacementRequest} className="mt-0.5">
                                <input type="hidden" name="shiftId" value={shift.id} />
                                <input type="hidden" name="userId" value={a.userId} />
                                <button
                                  type="submit"
                                  className="text-[10px] text-stone-400 underline hover:text-stone-600"
                                >
                                  Annuler la recherche
                                </button>
                              </form>
                            )}

                            {eligibleToReplace && shift && (
                              <form action={fulfillShiftReplacement} className="mt-0.5">
                                <input type="hidden" name="shiftId" value={shift.id} />
                                <input type="hidden" name="userId" value={a.userId} />
                                <button
                                  type="submit"
                                  className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-700"
                                >
                                  Je remplace
                                </button>
                              </form>
                            )}

                            {!a.seekingReplacement && a.userId === currentUserId && shift && (
                              <details className="mt-0.5">
                                <summary className="cursor-pointer text-[10px] text-stone-400 hover:text-red-600">
                                  Empêchement ?
                                </summary>
                                <form
                                  action={requestReplacement}
                                  className="mt-1 space-y-1 rounded border border-red-200 bg-red-50 p-1.5"
                                >
                                  <input type="hidden" name="shiftId" value={shift.id} />
                                  <p className="text-[10px] text-red-700">
                                    Vous restez responsable de ce créneau tant
                                    qu&rsquo;un remplaçant n&rsquo;est pas trouvé.
                                  </p>
                                  <label className="flex items-center gap-1 text-[10px] text-stone-600">
                                    <input
                                      type="checkbox"
                                      name="sendNotification"
                                      defaultChecked
                                      className="h-3 w-3 rounded border-stone-300"
                                    />
                                    Notifier les bénévoles disponibles
                                  </label>
                                  <button
                                    type="submit"
                                    className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-700"
                                  >
                                    Confirmer l&rsquo;empêchement
                                  </button>
                                </form>
                              </details>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {editable &&
                      seats.map((seat, si) => {
                        if (
                          seatHidesWhenFilled(seat) &&
                          assignees.some((a) => a.fonction === seat.label)
                        ) {
                          return null;
                        }
                        const seatOptions = availableUsers.filter((u) => isEligibleForSeat(seat, u));
                        if (seatOptions.length === 0) return null;
                        return (
                          <PlanningAssignSelect
                            key={si}
                            action={assignToShift}
                            date={dateKey(cell.date)}
                            site={cell.leaf.site}
                            periode={cell.leaf.periode}
                            options={seatOptions}
                            placeholder={`+ ${seat.label}…`}
                            fonction={seat.label}
                          />
                        );
                      })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
