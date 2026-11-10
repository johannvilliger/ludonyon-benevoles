import { prisma } from "@/lib/prisma";
import { sendPushToUser, sendPushToUsers, pushConfigured } from "@/lib/push";
import { formatEventDate, formatDateOnly } from "@/lib/format";
import {
  SITE_LABELS,
  findColumnForDate,
  findSlotDef,
  formatDayLabel,
  formatHourLabel,
  formatHoursRange,
  shiftKey,
  type Periode,
  type Site,
} from "@/lib/planning";

const REMINDER_WINDOW_MINUTES = 60;
// Fenêtre "semaine suivante" : créneaux dans les 7 prochains jours.
const REPLACEMENT_ALERT_WINDOW_DAYS = 7;

export async function checkAndSendEventReminders() {
  if (!pushConfigured()) return;

  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60000);

  const dueSignups = await prisma.eventSignup.findMany({
    where: {
      wantsReminder: true,
      reminderSentAt: null,
      event: { startsAt: { gte: now, lte: windowEnd } },
    },
    include: { event: true, user: { select: { name: true } } },
  });

  const byEvent = new Map<string, typeof dueSignups>();
  for (const signup of dueSignups) {
    const list = byEvent.get(signup.eventId) ?? [];
    list.push(signup);
    byEvent.set(signup.eventId, list);
  }

  for (const [, signups] of byEvent) {
    const event = signups[0].event;
    const title = "Rappel : " + event.title;
    const body = formatEventDate(event.startsAt, event.endsAt);

    for (const signup of signups) {
      await sendPushToUser(signup.userId, { title, body, url: "/evenements" });
      await prisma.eventSignup.update({
        where: { id: signup.id },
        data: { reminderSentAt: now },
      });
    }

    await prisma.pushNotificationLog.create({
      data: {
        category: "EVENT_REMINDER",
        title,
        body,
        recipients: signups.length,
        recipientNames: signups.map((s) => s.user.name).join(", "),
      },
    });
  }
}

// Alerte les responsables/comité quand un ou plusieurs créneaux des 7
// prochains jours (la semaine suivante) sont toujours "en attente de
// remplaçant·e" (recherche non annulée). Une seule notification groupée,
// envoyée une fois par semaine, le dimanche à 19h (voir la planification
// dans instrumentation.ts), plutôt qu'à chaque vérification.
// problemAlertSentAt évite de réinclure un créneau déjà signalé ; il est
// remis à null si la recherche est annulée puis relancée.
export async function checkAndSendReplacementProblemAlerts() {
  if (!pushConfigured()) return;

  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const end = new Date(start.getTime() + REPLACEMENT_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const atRisk = await prisma.openingShiftAssignee.findMany({
    where: {
      seekingReplacement: true,
      problemAlertSentAt: null,
      shift: { date: { gte: start, lte: end } },
    },
    include: { shift: true, user: { select: { name: true } } },
    orderBy: { shift: { date: "asc" } },
  });

  if (atRisk.length === 0) return;

  const managers = await prisma.user.findMany({
    where: { active: true, role: { in: ["RESPONSABLE", "COMITE"] } },
    select: { id: true, name: true },
  });

  if (managers.length > 0) {
    const lines = atRisk.map((assignee) => {
      const site = assignee.shift.site as Site;
      const periode = assignee.shift.periode as Periode;
      const slot = findSlotDef(assignee.shift.date, site, periode);
      const hours = slot ? ` (${formatHoursRange(slot.start, slot.end)})` : "";
      return `${formatDayLabel(assignee.shift.date)} à ${SITE_LABELS[site]}${hours} — ${assignee.user.name}`;
    });

    const title = atRisk.length > 1 ? "Créneaux à risque" : "Créneau à risque";
    const body =
      (atRisk.length > 1
        ? `${atRisk.length} créneaux sans remplaçant·e cette semaine :\n`
        : "Aucun·e remplaçant·e trouvé·e :\n") + lines.join("\n");

    await sendPushToUsers(
      managers.map((m) => m.id),
      { title, body, url: "/organisation/planning" }
    );
    await prisma.pushNotificationLog.create({
      data: {
        category: "REPLACEMENT_PROBLEM",
        title,
        body,
        recipients: managers.length,
        recipientNames: managers.map((m) => m.name).join(", "),
      },
    });
  }

  await prisma.openingShiftAssignee.updateMany({
    where: { id: { in: atRisk.map((a) => a.id) } },
    data: { problemAlertSentAt: now },
  });
}

// Alerte les responsables/comité quand un créneau des 7 prochains jours
// n'a personne du tout — contrairement à checkAndSendReplacementProblemAlerts
// ci-dessus, qui ne couvre que les créneaux déjà pourvus puis abandonnés.
// Un OpeningShift n'existe en base que si quelqu'un y a été assigné : un
// créneau jamais pourvu n'a donc aucune ligne, il faut comparer la grille
// théorique (planning.ts) à ce qui existe réellement. La ligne est créée
// ici au moment de l'alerte (assignees vide) pour pouvoir y marquer
// unfilledAlertSentAt et, plus tard, un appel lancé (voir launchShiftCall
// dans actions/planning.ts) — même mécanisme qu'un appel lancé en premier.
export async function checkAndSendUnfilledShiftAlerts() {
  if (!pushConfigured()) return;

  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const [existingShifts, closures] = await Promise.all([
    prisma.openingShift.findMany({
      where: { date: { gte: todayUTC, lte: new Date(todayUTC.getTime() + REPLACEMENT_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000) } },
      include: { _count: { select: { assignees: true } } },
    }),
    prisma.planningClosure.findMany({
      where: {
        startDate: { lte: new Date(todayUTC.getTime() + REPLACEMENT_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
        endDate: { gte: todayUTC },
      },
    }),
  ]);
  const shiftByKey = new Map(
    existingShifts.map((s) => [shiftKey(s.date, s.site as Site, s.periode as Periode), s])
  );

  const unfilled: { date: Date; site: Site; periode: Periode }[] = [];
  for (let d = 0; d <= REPLACEMENT_ALERT_WINDOW_DAYS; d++) {
    const date = new Date(todayUTC);
    date.setUTCDate(date.getUTCDate() + d);
    const column = findColumnForDate(date);
    if (!column) continue;
    if (closures.some((c) => c.startDate <= date && c.endDate >= date)) continue;

    for (const slot of column.slots) {
      const existing = shiftByKey.get(shiftKey(date, slot.site, slot.periode));
      if (existing && (existing._count.assignees > 0 || existing.unfilledAlertSentAt)) continue;
      unfilled.push({ date, site: slot.site, periode: slot.periode });
    }
  }

  if (unfilled.length === 0) return;

  const managers = await prisma.user.findMany({
    where: { active: true, role: { in: ["RESPONSABLE", "COMITE"] } },
    select: { id: true, name: true },
  });

  // Les lignes sont créées (ou mises à jour) même si personne n'est
  // responsable/comité pour l'instant, pour ne pas réessayer en boucle la
  // semaine prochaine sur un créneau déjà passé en revue.
  await Promise.all(
    unfilled.map((u) =>
      prisma.openingShift.upsert({
        where: { date_site_periode: { date: u.date, site: u.site, periode: u.periode } },
        create: { date: u.date, site: u.site, periode: u.periode, unfilledAlertSentAt: now },
        update: { unfilledAlertSentAt: now },
      })
    )
  );

  if (managers.length > 0) {
    const lines = unfilled.map((u) => {
      const slot = findSlotDef(u.date, u.site, u.periode);
      const hours = slot ? ` (${formatHoursRange(slot.start, slot.end)})` : "";
      return `${formatDayLabel(u.date)} à ${SITE_LABELS[u.site]}${hours}`;
    });

    const title = unfilled.length > 1 ? "Créneaux non pourvus" : "Créneau non pourvu";
    const body =
      (unfilled.length > 1
        ? `${unfilled.length} créneaux sans personne cette semaine :\n`
        : "Aucune personne sur ce créneau :\n") + lines.join("\n");

    await sendPushToUsers(
      managers.map((m) => m.id),
      { title, body, url: "/organisation" }
    );
    await prisma.pushNotificationLog.create({
      data: {
        category: "UNFILLED_SHIFT",
        title,
        body,
        recipients: managers.length,
        recipientNames: managers.map((m) => m.name).join(", "),
      },
    });
  }
}

// Rappel individuel la veille au soir (19h, voir instrumentation.ts) pour
// chaque bénévole ayant activé "Rappels pour les ouvertures" (profil) et
// assigné à un créneau le lendemain.
export async function checkAndSendOpeningShiftReminders() {
  if (!pushConfigured()) return;

  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowUTC = new Date(Date.UTC(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()));

  const shifts = await prisma.openingShift.findMany({
    where: { date: tomorrowUTC },
    include: {
      assignees: {
        where: { reminderSentAt: null, user: { wantsOpeningReminders: true } },
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  for (const shift of shifts) {
    if (shift.assignees.length === 0) continue;

    const site = shift.site as Site;
    const periode = shift.periode as Periode;
    const slot = findSlotDef(shift.date, site, periode);
    if (!slot) continue;

    const title = "Rappel ouverture";
    const body = `Demain ${formatDayLabel(shift.date)}, tu es inscrit·e à l’ouverture à ${SITE_LABELS[site]} dès ${formatHourLabel(slot.start)}`;

    await sendPushToUsers(
      shift.assignees.map((a) => a.userId),
      { title, body, url: "/planning" }
    );
    await prisma.openingShiftAssignee.updateMany({
      where: { id: { in: shift.assignees.map((a) => a.id) } },
      data: { reminderSentAt: now },
    });
    await prisma.pushNotificationLog.create({
      data: {
        category: "OPENING_REMINDER",
        title,
        body,
        recipients: shift.assignees.length,
        recipientNames: shift.assignees.map((a) => a.user.name).join(", "),
      },
    });
  }
}

// Rappel individuel (une vérification par jour, voir instrumentation.ts)
// pour chaque tâche d'événement dont le rappel — exprimé en jours avant
// l'échéance (Task.reminderDaysBefore), configurable par tâche — est
// atteint. 0 jour = rappel le jour même de l'échéance.
export async function checkAndSendTaskReminders() {
  if (!pushConfigured()) return;

  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const candidates = await prisma.task.findMany({
    where: {
      done: false,
      reminderSentAt: null,
      reminderDaysBefore: { not: null },
    },
    include: {
      event: { select: { title: true } },
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
  });

  for (const task of candidates) {
    if (task.assignees.length === 0 || task.reminderDaysBefore === null) continue;

    const reminderDate = new Date(task.dueDate);
    reminderDate.setUTCDate(reminderDate.getUTCDate() - task.reminderDaysBefore);
    if (reminderDate.getTime() > todayUTC.getTime()) continue;

    const title = "Rappel tâche : " + task.title;
    const body = `À faire d'ici le ${formatDateOnly(task.dueDate)} — ${task.event.title}`;

    await sendPushToUsers(
      task.assignees.map((a) => a.userId),
      { title, body, url: "/profil" }
    );
    await prisma.task.update({
      where: { id: task.id },
      data: { reminderSentAt: now },
    });
    await prisma.pushNotificationLog.create({
      data: {
        category: "TASK_REMINDER",
        title,
        body,
        recipients: task.assignees.length,
        recipientNames: task.assignees.map((a) => a.user.name).join(", "),
      },
    });
  }
}
