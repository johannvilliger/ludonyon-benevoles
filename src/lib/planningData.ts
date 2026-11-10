import { prisma } from "@/lib/prisma";
import { getPlanningWeeks, shiftKey, type PlanningWeek } from "@/lib/planning";

export type ShiftAssignee = {
  userId: string;
  name: string;
  role: string;
  seekingReplacement: boolean;
  // Fonction Excel (Ordi-caisse/Ordi retours/Accueil/Anim.) attribuée à
  // l'import — précise et propre à ce créneau, mais absente pour une
  // assignation manuelle.
  fonction: string | null;
  // Poste (Accueil/Retour/Sortie — voir postes.ts) fixé sur la fiche du/de
  // la bénévole, affiché en repli quand aucune fonction Excel n'est
  // connue pour ce créneau précis.
  poste: string | null;
};
export type ShiftInfo = { id: string; assignees: ShiftAssignee[] };
export type ShiftMap = Map<string, ShiftInfo>;
export type ClosureInfo = { id: string; startDate: Date; endDate: Date; label: string };

// Charge les semaines du mois demandé, les créneaux déjà assignés (indexés
// par shiftKey(date, site, periode)) et les fermetures globales
// chevauchant la période — partagé entre la page publique (lecture seule)
// et la page de gestion (assignation).
export async function loadPlanningWeeksAndShifts(
  year: number,
  month: number
): Promise<{ weeks: PlanningWeek[]; shiftsByKey: ShiftMap; closures: ClosureInfo[] }> {
  const weeks = getPlanningWeeks(year, month);
  const rangeStart = weeks[0].monday;
  const rangeEnd = new Date(weeks[weeks.length - 1].monday);
  rangeEnd.setDate(rangeEnd.getDate() + 7);

  const [shifts, closures] = await Promise.all([
    prisma.openingShift.findMany({
      where: { date: { gte: rangeStart, lt: rangeEnd } },
      include: {
        assignees: {
          include: { user: { select: { id: true, name: true, active: true, poste: true, role: true } } },
        },
      },
    }),
    prisma.planningClosure.findMany({
      where: { startDate: { lt: rangeEnd }, endDate: { gte: rangeStart } },
      orderBy: { startDate: "asc" },
    }),
  ]);

  const shiftsByKey: ShiftMap = new Map();
  for (const shift of shifts) {
    shiftsByKey.set(shiftKey(shift.date, shift.site as never, shift.periode as never), {
      id: shift.id,
      assignees: shift.assignees
        .filter((a) => a.user.active)
        .map((a) => ({
          userId: a.user.id,
          name: a.user.name,
          role: a.user.role,
          seekingReplacement: a.seekingReplacement,
          fonction: a.fonction,
          poste: a.user.poste,
        })),
    });
  }

  return { weeks, shiftsByKey, closures };
}
