import { prisma } from "@/lib/prisma";
import {
  findColumnForDate,
  getPlanningWeeks,
  shiftKey,
  type PlanningWeek,
  type Periode,
  type Site,
} from "@/lib/planning";

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

export type UpcomingShiftRow = {
  date: Date;
  site: Site;
  periode: Periode;
  assignees: ShiftAssignee[];
  closed: boolean;
  // Créneau sans personne, ou avec quelqu'un en recherche de
  // remplaçant·e — mis en évidence sur le tableau de bord (Vue
  // d'ensemble). Un créneau fermé (vacances globales) n'est jamais un
  // problème. Ne vérifie pas la couverture fine par poste (ça, c'est le
  // rôle de l'alerte hebdomadaire — voir checkAndSendUnfilledShiftAlerts
  // dans reminders.ts), juste "visiblement vide ou en souci".
  problem: boolean;
  // Dernier appel ouvert lancé pour ce créneau (bouton "Lancer un appel",
  // voir launchShiftCall) — affiché pour éviter qu'un·e autre
  // responsable/comité ne relance sans le savoir.
  callLaunchedAt: Date | null;
  callLaunchedByName: string | null;
};

// Grille théorique des `days` prochains jours (aujourd'hui inclus)
// comparée à ce qui est réellement assigné — pour le tableau de bord de
// Vue d'ensemble. Contrairement à loadPlanningWeeksAndShifts (semaines
// calendaires complètes d'un mois), ici c'est une fenêtre glissante de N
// jours à partir d'aujourd'hui.
export async function loadUpcomingShiftsOverview(days: number): Promise<UpcomingShiftRow[]> {
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const endUTC = new Date(todayUTC);
  endUTC.setUTCDate(endUTC.getUTCDate() + days);

  const [shifts, closures] = await Promise.all([
    prisma.openingShift.findMany({
      where: { date: { gte: todayUTC, lt: endUTC } },
      include: {
        assignees: {
          include: { user: { select: { id: true, name: true, active: true, poste: true, role: true } } },
        },
        callLaunchedBy: { select: { name: true } },
      },
    }),
    prisma.planningClosure.findMany({
      where: { startDate: { lt: endUTC }, endDate: { gte: todayUTC } },
    }),
  ]);

  const shiftsByKey = new Map<string, (typeof shifts)[number]>();
  for (const shift of shifts) {
    shiftsByKey.set(shiftKey(shift.date, shift.site as Site, shift.periode as Periode), shift);
  }

  const rows: UpcomingShiftRow[] = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(todayUTC);
    date.setUTCDate(date.getUTCDate() + d);
    const column = findColumnForDate(date);
    if (!column) continue;

    const closed = closures.some((c) => c.startDate <= date && c.endDate >= date);

    for (const slot of column.slots) {
      const shift = shiftsByKey.get(shiftKey(date, slot.site, slot.periode));
      const assignees: ShiftAssignee[] = (shift?.assignees ?? [])
        .filter((a) => a.user.active)
        .map((a) => ({
          userId: a.user.id,
          name: a.user.name,
          role: a.user.role,
          seekingReplacement: a.seekingReplacement,
          fonction: a.fonction,
          poste: a.user.poste,
        }));
      rows.push({
        date,
        site: slot.site,
        periode: slot.periode,
        assignees,
        closed,
        problem: !closed && (assignees.length === 0 || assignees.some((a) => a.seekingReplacement)),
        callLaunchedAt: shift?.callLaunchedAt ?? null,
        callLaunchedByName: shift?.callLaunchedBy?.name ?? null,
      });
    }
  }

  return rows;
}
