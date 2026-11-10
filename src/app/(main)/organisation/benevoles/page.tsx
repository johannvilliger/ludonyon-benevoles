import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireOrganisationUser } from "@/lib/session";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/roles";
import { POSTES, POSTE_LABELS, POSTE_UNSET_LABEL, type Poste } from "@/lib/postes";
import {
  OPENING_FREQUENCIES,
  OPENING_FREQUENCY_LABELS,
  ANIM_FREQUENCIES,
  ANIM_FREQUENCY_LABELS,
  type OpeningFrequency,
  type AnimFrequency,
} from "@/lib/frequencies";
import { CLOTHING_SIZES, CLOTHING_CUTS, CLOTHING_CUT_LABELS, type ClothingCut } from "@/lib/clothing";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { mailConfigured } from "@/lib/mail";
import Avatar from "@/components/Avatar";
import PhotoUploadField from "@/components/PhotoUploadField";
import { AvailabilityFields } from "@/components/AvailabilityForm";
import SaveButton from "@/components/SaveButton";
import {
  createVolunteer,
  updateVolunteerContactInfo,
  updateVolunteerProfile,
  archiveVolunteer,
  unarchiveVolunteer,
  deleteVolunteer,
  resetVolunteerPassword,
  updateVolunteerPhoto,
  addVacationForUser,
  deleteVacationForUser,
} from "@/lib/actions/organisation";

export default async function OrganisationBenevolesPage({
  searchParams,
}: {
  searchParams: Promise<{ filtre?: string }>;
}) {
  const currentUser = await requireOrganisationUser();
  const { filtre } = await searchParams;
  const showArchived = filtre === "archives";

  const users = await prisma.user.findMany({
    where: { active: !showArchived },
    orderBy: { name: "asc" },
    include: {
      vacations: { orderBy: { startDate: "asc" } },
      availabilities: { select: { slotKey: true } },
      _count: { select: { pushSubscriptions: true } },
    },
  });

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-stone-900">
            Ajouter un·e bénévole
          </h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/organisation/benevoles/import"
              className="text-sm text-brand-blue hover:underline"
            >
              📋 Import groupé depuis Excel
            </Link>
            <Link
              href="/organisation/benevoles/ludoapp"
              className="text-sm text-brand-blue hover:underline"
            >
              🔗 Synchro LudoApp
            </Link>
          </div>
        </div>
        <p className="mt-1 text-xs text-stone-400">
          {mailConfigured()
            ? "Un email avec les identifiants sera envoyé automatiquement à la personne."
            : "Serveur d'envoi d'emails non configuré (voir Paramètres) : communiquez les identifiants manuellement."}
          {" "}Email et mot de passe facultatifs : laissez-les vides pour
          ajouter un nom qui ne figure que dans les plannings, sans compte
          de connexion.
        </p>
        <form
          action={createVolunteer}
          className="mt-3 grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-2"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Nom complet
            </label>
            <input
              type="text"
              name="name"
              required
              maxLength={200}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Email <span className="font-normal text-stone-400">(facultatif)</span>
            </label>
            <input
              type="email"
              name="email"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Téléphone
            </label>
            <input
              type="tel"
              name="phone"
              maxLength={50}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Rôle
            </label>
            <select
              name="role"
              defaultValue="BENEVOLE"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Compétences / disponibilités
            </label>
            <input
              type="text"
              name="skills"
              maxLength={1000}
              placeholder="Ex : animation, samedis, prêt de jeux"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Mot de passe provisoire{" "}
              <span className="font-normal text-stone-400">
                (facultatif si aucun email — requis sinon)
              </span>
            </label>
            <input
              type="text"
              name="password"
              minLength={8}
              placeholder="À transmettre au/à la bénévole, à changer ensuite"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg border-2 border-black bg-brand-yellow px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand-yellow-dark"
            >
              Ajouter
            </button>
          </div>
        </form>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-stone-900">
            {showArchived ? "Comptes archivés" : "Comptes existants"}
          </h2>
          <div className="flex gap-1 rounded-lg border border-stone-200 bg-white p-1 text-sm">
            <Link
              href="/organisation/benevoles"
              className={
                !showArchived
                  ? "rounded-md bg-stone-900 px-3 py-1 text-white"
                  : "rounded-md px-3 py-1 text-stone-600 hover:bg-stone-100"
              }
            >
              Actifs
            </Link>
            <Link
              href="/organisation/benevoles?filtre=archives"
              className={
                showArchived
                  ? "rounded-md bg-stone-900 px-3 py-1 text-white"
                  : "rounded-md px-3 py-1 text-stone-600 hover:bg-stone-100"
              }
            >
              Archivés
            </Link>
          </div>
        </div>
        {showArchived && users.length === 0 && (
          <p className="mt-3 text-sm text-stone-400">
            Aucun compte archivé.
          </p>
        )}
        <ul className="mt-3 space-y-3">
          {users.map((u) => {
            const isSelf = u.id === currentUser.id;
            return (
              <li
                key={u.id}
                className="rounded-xl border border-stone-200 bg-white p-4"
              >
                <div className="flex items-start gap-3">
                    <Avatar name={u.name} photoPath={u.photoPath} />
                    <div>
                      <p className="font-medium text-stone-900">{u.name}</p>
                      {u.email ? (
                        <p className="text-sm text-stone-600">{u.email}</p>
                      ) : (
                        <p className="text-sm italic text-stone-400">
                          Sans compte de connexion (planning uniquement)
                        </p>
                      )}
                      {u.phone && <p className="text-sm text-stone-600">📞 {u.phone}</p>}
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${
                          u.wantsOpeningReminders && u._count.pushSubscriptions > 0
                            ? "bg-brand-blue-soft text-brand-blue-dark"
                            : "bg-stone-100 text-stone-400"
                        }`}
                      >
                        🔔{" "}
                        {u.wantsOpeningReminders
                          ? u._count.pushSubscriptions > 0
                            ? "Rappels ouverture actifs"
                            : "Rappel demandé — notifications désactivées sur l’appareil"
                          : "Rappels ouverture désactivés"}
                      </span>
                      <p className="mt-1 text-xs text-stone-400">
                        {u.lastSeenAt
                          ? `Dernière connexion : ${formatDateTime(u.lastSeenAt)}`
                          : "Jamais connecté·e"}
                      </p>

                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-xs text-brand-blue hover:underline">
                          ✏️ Éditer nom / téléphone / email
                        </summary>
                        <form
                          action={updateVolunteerContactInfo}
                          className="mt-2 space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-2"
                        >
                          <input type="hidden" name="id" value={u.id} />
                          <div>
                            <label className="mb-0.5 block text-xs font-medium text-stone-600">
                              Nom complet
                            </label>
                            <input
                              type="text"
                              name="name"
                              defaultValue={u.name}
                              required
                              maxLength={200}
                              className="w-full rounded-lg border border-stone-300 px-2 py-1 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-xs font-medium text-stone-600">
                              Email <span className="font-normal text-stone-400">(facultatif)</span>
                            </label>
                            <input
                              type="email"
                              name="email"
                              defaultValue={u.email ?? ""}
                              className="w-full rounded-lg border border-stone-300 px-2 py-1 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-xs font-medium text-stone-600">
                              Téléphone
                            </label>
                            <input
                              type="tel"
                              name="phone"
                              defaultValue={u.phone ?? ""}
                              maxLength={50}
                              className="w-full rounded-lg border border-stone-300 px-2 py-1 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                            />
                          </div>
                          <SaveButton className="rounded-lg border-2 border-black bg-brand-yellow px-2 py-1 text-xs font-semibold text-black hover:bg-brand-yellow-dark disabled:opacity-60">
                            Enregistrer
                          </SaveButton>
                        </form>
                      </details>
                    </div>
                  </div>

                <form action={updateVolunteerProfile} className="mt-3">
                  <input type="hidden" name="id" value={u.id} />
                  <div className="flex flex-wrap items-center gap-2">
                      <select
                        key={u.role}
                        name="role"
                        defaultValue={u.role}
                        disabled={isSelf}
                        className="rounded-lg border border-stone-300 px-2 py-1 text-sm disabled:opacity-50"
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role as Role]}
                          </option>
                        ))}
                      </select>

                      {u.role === "BENEVOLE" && (
                        <select
                          key={u.poste ?? "none"}
                          name="poste"
                          defaultValue={u.poste ?? ""}
                          className="rounded-lg border border-stone-300 px-2 py-1 text-sm"
                        >
                          <option value="">Poste : {POSTE_UNSET_LABEL}</option>
                          {POSTES.map((poste) => (
                            <option key={poste} value={poste}>
                              {POSTE_LABELS[poste as Poste]}
                            </option>
                          ))}
                        </select>
                      )}

                      {u.role === "BENEVOLE" && (
                        <label className="flex items-center gap-1.5 text-xs text-stone-600">
                          <input
                            key={String(u.unavailableForOpenings)}
                            type="checkbox"
                            name="unavailableForOpenings"
                            defaultChecked={u.unavailableForOpenings}
                            className="h-4 w-4 rounded border-stone-300 text-brand-blue focus:ring-brand-blue"
                          />
                          Pas d&rsquo;ouvertures
                        </label>
                      )}

                      <SaveButton className="rounded-lg border-2 border-black bg-brand-yellow px-2 py-1 text-xs font-semibold text-black hover:bg-brand-yellow-dark disabled:opacity-60" />
                  </div>

                  {!u.unavailableForOpenings && (
                    <>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-600">
                          Disponibilités pour le planning des ouvertures
                        </summary>
                        <div className="mt-2">
                          <input type="hidden" name="availabilityFieldsRendered" value="1" />
                          <AvailabilityFields selectedKeys={u.availabilities.map((a) => a.slotKey)} />
                        </div>
                      </details>

                      <div className="mt-2 flex items-center gap-2 text-xs text-stone-500">
                        <label htmlFor={`openingFrequency-${u.id}`}>Fréquence :</label>
                        <select
                          id={`openingFrequency-${u.id}`}
                          key={u.openingFrequency ?? "none"}
                          name="openingFrequency"
                          defaultValue={u.openingFrequency ?? ""}
                          className="rounded-lg border border-stone-300 px-2 py-1 text-xs"
                        >
                          <option value="">Non renseignée</option>
                          {OPENING_FREQUENCIES.map((freq) => (
                            <option key={freq} value={freq}>
                              {OPENING_FREQUENCY_LABELS[freq as OpeningFrequency]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}

                  <div className="mt-2 grid gap-2 text-xs text-stone-500 sm:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <label htmlFor={`animWeekendFrequency-${u.id}`}>Anim. weekend :</label>
                      <select
                        id={`animWeekendFrequency-${u.id}`}
                        key={u.animWeekendFrequency ?? "none"}
                        name="animWeekendFrequency"
                        defaultValue={u.animWeekendFrequency ?? ""}
                        className="rounded-lg border border-stone-300 px-2 py-1 text-xs"
                      >
                        <option value="">Non renseignée</option>
                        {ANIM_FREQUENCIES.map((freq) => (
                          <option key={freq} value={freq}>
                            {ANIM_FREQUENCY_LABELS[freq as AnimFrequency]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label htmlFor={`animWeekFrequency-${u.id}`}>Anim. semaine :</label>
                      <select
                        id={`animWeekFrequency-${u.id}`}
                        key={u.animWeekFrequency ?? "none"}
                        name="animWeekFrequency"
                        defaultValue={u.animWeekFrequency ?? ""}
                        className="rounded-lg border border-stone-300 px-2 py-1 text-xs"
                      >
                        <option value="">Non renseignée</option>
                        {ANIM_FREQUENCIES.map((freq) => (
                          <option key={freq} value={freq}>
                            {ANIM_FREQUENCY_LABELS[freq as AnimFrequency]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-600">
                      Habits (polo, pull)
                    </summary>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-stone-200 p-3">
                        <label className="flex items-center gap-2 text-sm text-stone-700">
                          <input
                            key={String(u.poloReceived)}
                            type="checkbox"
                            name="poloReceived"
                            defaultChecked={u.poloReceived}
                            className="h-4 w-4 rounded border-stone-300 text-brand-blue focus:ring-brand-blue"
                          />
                          Polo reçu
                        </label>
                        <div className="mt-2 flex gap-2">
                          <select
                            key={u.poloSize ?? "none"}
                            name="poloSize"
                            defaultValue={u.poloSize ?? ""}
                            className="w-full rounded-lg border border-stone-300 px-2 py-1 text-sm"
                          >
                            <option value="">Taille</option>
                            {CLOTHING_SIZES.map((size) => (
                              <option key={size} value={size}>
                                {size}
                              </option>
                            ))}
                          </select>
                          <select
                            key={u.poloCut ?? "none"}
                            name="poloCut"
                            defaultValue={u.poloCut ?? ""}
                            className="w-full rounded-lg border border-stone-300 px-2 py-1 text-sm"
                          >
                            <option value="">Coupe</option>
                            {CLOTHING_CUTS.map((cut) => (
                              <option key={cut} value={cut}>
                                {CLOTHING_CUT_LABELS[cut as ClothingCut]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="rounded-lg border border-stone-200 p-3">
                        <label className="flex items-center gap-2 text-sm text-stone-700">
                          <input
                            key={String(u.pullReceived)}
                            type="checkbox"
                            name="pullReceived"
                            defaultChecked={u.pullReceived}
                            className="h-4 w-4 rounded border-stone-300 text-brand-blue focus:ring-brand-blue"
                          />
                          Pull reçu
                        </label>
                        <div className="mt-2 flex gap-2">
                          <select
                            key={u.pullSize ?? "none"}
                            name="pullSize"
                            defaultValue={u.pullSize ?? ""}
                            className="w-full rounded-lg border border-stone-300 px-2 py-1 text-sm"
                          >
                            <option value="">Taille</option>
                            {CLOTHING_SIZES.map((size) => (
                              <option key={size} value={size}>
                                {size}
                              </option>
                            ))}
                          </select>
                          <select
                            key={u.pullCut ?? "none"}
                            name="pullCut"
                            defaultValue={u.pullCut ?? ""}
                            className="w-full rounded-lg border border-stone-300 px-2 py-1 text-sm"
                          >
                            <option value="">Coupe</option>
                            {CLOTHING_CUTS.map((cut) => (
                              <option key={cut} value={cut}>
                                {CLOTHING_CUT_LABELS[cut as ClothingCut]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="mt-1.5 text-xs text-stone-400">
                          À rendre si le/la bénévole quitte l’association.
                        </p>
                      </div>
                    </div>
                  </details>
                </form>

                {(!isSelf || showArchived) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!isSelf && !showArchived && (
                      <form action={archiveVolunteer}>
                        <input type="hidden" name="id" value={u.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
                        >
                          Archiver
                        </button>
                      </form>
                    )}
                    {showArchived && (
                      <form action={unarchiveVolunteer}>
                        <input type="hidden" name="id" value={u.id} />
                        <button
                          type="submit"
                          className="rounded-lg border-2 border-black bg-brand-yellow px-2 py-1 text-xs font-semibold text-black hover:bg-brand-yellow-dark"
                        >
                          Réactiver
                        </button>
                      </form>
                    )}
                  </div>
                )}

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-600">
                    Réinitialiser le mot de passe
                  </summary>
                  <form
                    action={resetVolunteerPassword}
                    className="mt-2 flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="id" value={u.id} />
                    <input
                      type="text"
                      name="password"
                      required
                      minLength={8}
                      placeholder="Nouveau mot de passe"
                      className="rounded-lg border border-stone-300 px-2 py-1 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                    />
                    <SaveButton className="rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-60">
                      Réinitialiser
                    </SaveButton>
                  </form>
                </details>

                <details className="mt-2" open={u.vacations.length > 0}>
                  <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-600">
                    Vacances / indisponibilités
                  </summary>
                  {u.vacations.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-stone-600">
                      {u.vacations.map((v) => (
                        <li key={v.id} className="flex items-center justify-between gap-2">
                          <span>
                            {formatDateOnly(v.startDate)} – {formatDateOnly(v.endDate)}
                            {v.note && <span className="text-stone-400"> ({v.note})</span>}
                          </span>
                          <form action={deleteVacationForUser}>
                            <input type="hidden" name="id" value={v.id} />
                            <button
                              type="submit"
                              className="text-stone-400 hover:text-red-600"
                              aria-label="Supprimer cette période"
                            >
                              ×
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    action={addVacationForUser}
                    className="mt-2 grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2 sm:grid-cols-2"
                  >
                    <input type="hidden" name="userId" value={u.id} />
                    <div>
                      <label className="mb-0.5 block text-xs font-medium text-stone-600">
                        Début
                      </label>
                      <input
                        type="date"
                        name="startDate"
                        required
                        className="w-full rounded-lg border border-stone-300 px-2 py-1 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs font-medium text-stone-600">
                        Fin
                      </label>
                      <input
                        type="date"
                        name="endDate"
                        required
                        className="w-full rounded-lg border border-stone-300 px-2 py-1 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-0.5 block text-xs font-medium text-stone-600">
                        Note (facultatif)
                      </label>
                      <input
                        type="text"
                        name="note"
                        maxLength={200}
                        placeholder="Ex. Arrêt maladie"
                        className="w-full rounded-lg border border-stone-300 px-2 py-1 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <SaveButton className="rounded-lg border-2 border-black bg-brand-yellow px-2 py-1 text-xs font-semibold text-black hover:bg-brand-yellow-dark disabled:opacity-60">
                        Ajouter la période
                      </SaveButton>
                    </div>
                  </form>
                </details>

                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-600">
                    Changer la photo
                  </summary>
                  <div className="mt-2">
                    <PhotoUploadField
                      action={updateVolunteerPhoto}
                      extraFields={{ id: u.id }}
                      buttonClassName="rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-60"
                    />
                  </div>
                </details>

                {showArchived && !isSelf && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-red-500 hover:text-red-700">
                      Supprimer définitivement
                    </summary>
                    <div className="mt-2 rounded-lg bg-red-50 p-3">
                      <p className="text-xs text-red-700">
                        Tout ce qui est lié à ce compte disparaîtra
                        définitivement : présences et heures enregistrées sur
                        les événements passés, tâches assignées, vacances
                        déclarées. Cette action est irréversible.
                      </p>
                      <form action={deleteVolunteer} className="mt-2">
                        <input type="hidden" name="id" value={u.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                        >
                          Confirmer la suppression définitive
                        </button>
                      </form>
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
