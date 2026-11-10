"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganisationUser, requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isOrganisationRole } from "@/lib/roles";
import { sendPushToUsers } from "@/lib/push";
import { POSTES, canCoverPoste, canReplaceAssignee, isValidPoste, type Poste } from "@/lib/postes";
import type { Prisma } from "@/generated/prisma/client";
import {
  PLANNING_COLUMNS,
  SITE_LABELS,
  formatDayLabel,
  parseDateKey,
  shiftSlotKey,
  type Periode,
  type Site,
} from "@/lib/planning";

const SITES: Site[] = ["NYON", "GLAND"];
const PERIODES: Periode[] = ["JOURNEE", "MATIN", "APREM"];

const shiftSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide"),
  site: z.enum(SITES as [Site, ...Site[]]),
  periode: z.enum(PERIODES as [Periode, ...Periode[]]),
});

// Vérifie que la combinaison (site, période) fait bien partie de la grille
// hebdomadaire fixe, pour éviter de créer des créneaux hors planning via
// une requête forgée.
function isKnownSlot(site: Site, periode: Periode): boolean {
  return PLANNING_COLUMNS.some((column) =>
    column.slots.some((slot) => slot.site === site && slot.periode === periode)
  );
}

export async function assignToShift(formData: FormData) {
  await requireOrganisationUser();

  const parsed = shiftSchema.safeParse({
    date: formData.get("date"),
    site: formData.get("site"),
    periode: formData.get("periode"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Créneau invalide");
  }
  if (!isKnownSlot(parsed.data.site, parsed.data.periode)) {
    throw new Error("Ce créneau ne fait pas partie de la grille d'ouverture");
  }

  const userId = String(formData.get("userId") ?? "");
  const volunteer = await prisma.user.findUnique({ where: { id: userId } });
  if (!volunteer || !volunteer.active) {
    throw new Error("Bénévole introuvable ou archivé");
  }

  // Renseigné quand l'assignation vient d'une des listes déroulantes par
  // poste (voir SEAT_REQUIREMENTS dans autoSchedule.ts et PlanningTable.tsx)
  // — absent pour un usage générique de cette action (ex. override de la
  // répartition automatique), auquel cas le poste du profil sert de repli
  // à l'affichage (voir ShiftAssignee dans lib/planningData.ts).
  const fonctionRaw = formData.get("fonction");
  const fonction = fonctionRaw ? String(fonctionRaw) : null;

  const shift = await prisma.openingShift.upsert({
    where: {
      date_site_periode: {
        date: parseDateKey(parsed.data.date),
        site: parsed.data.site,
        periode: parsed.data.periode,
      },
    },
    create: {
      date: parseDateKey(parsed.data.date),
      site: parsed.data.site,
      periode: parsed.data.periode,
    },
    update: {},
  });

  await prisma.openingShiftAssignee.upsert({
    where: { shiftId_userId: { shiftId: shift.id, userId } },
    create: { shiftId: shift.id, userId, fonction },
    update: { fonction },
  });

  revalidatePath("/planning");
  revalidatePath("/organisation/planning");
}

const removeSchema = z.object({
  shiftId: z.string().min(1),
  userId: z.string().min(1),
});

export async function removeFromShift(formData: FormData) {
  await requireOrganisationUser();

  const parsed = removeSchema.safeParse({
    shiftId: formData.get("shiftId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) {
    throw new Error("Assignation invalide");
  }

  await prisma.openingShiftAssignee.deleteMany({
    where: { shiftId: parsed.data.shiftId, userId: parsed.data.userId },
  });

  const remaining = await prisma.openingShiftAssignee.count({
    where: { shiftId: parsed.data.shiftId },
  });
  if (remaining === 0) {
    await prisma.openingShift.delete({ where: { id: parsed.data.shiftId } });
  }

  revalidatePath("/planning");
  revalidatePath("/organisation/planning");
}

// ---------- Recherche de remplaçant ----------

export async function requestReplacement(formData: FormData) {
  const user = await requireUser();
  const shiftId = String(formData.get("shiftId") ?? "");
  const sendNotification = formData.get("sendNotification") === "on";

  const assignee = await prisma.openingShiftAssignee.findUnique({
    where: { shiftId_userId: { shiftId, userId: user.id } },
    include: { shift: true },
  });
  if (!assignee) {
    throw new Error("Vous n'êtes pas assigné·e à ce créneau");
  }

  await prisma.openingShiftAssignee.update({
    where: { id: assignee.id },
    data: {
      seekingReplacement: true,
      replacementRequestedAt: new Date(),
      problemAlertSentAt: null,
    },
  });

  if (sendNotification) {
    const site = assignee.shift.site as Site;
    const periode = assignee.shift.periode as Periode;
    const key = shiftSlotKey(assignee.shift.date, site, periode);
    if (key) {
      const requester = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { role: true, poste: true },
      });

      // Un·e bénévole n'est proposé·e qu'à d'autres bénévoles (filtrés par
      // la hiérarchie de poste s'il en a un) ; un·e responsable ou membre
      // du comité n'est proposé·e qu'aux autres personnes du même rôle,
      // sans filtre de poste (ça ne les concerne pas).
      let roleFilter: Prisma.UserWhereInput;
      if (requester.role === "BENEVOLE") {
        roleFilter = { role: "BENEVOLE" };
        if (requester.poste && isValidPoste(requester.poste)) {
          const requesterPoste = requester.poste;
          const coveringPostes = POSTES.filter((p) =>
            canCoverPoste(p, requesterPoste as Poste)
          );
          roleFilter = { ...roleFilter, poste: { in: coveringPostes } };
        }
      } else {
        roleFilter = { role: requester.role };
      }

      const candidates = await prisma.user.findMany({
        where: {
          active: true,
          unavailableForOpenings: false,
          id: { not: user.id },
          availabilities: { some: { slotKey: key } },
          // Exclut les bénévoles en vacances déclarées ce jour-là.
          vacations: {
            none: {
              startDate: { lte: assignee.shift.date },
              endDate: { gte: assignee.shift.date },
            },
          },
          ...roleFilter,
        },
        select: { id: true, name: true },
      });

      if (candidates.length > 0) {
        const title = "Remplaçant·e recherché·e";
        const body = `${user.name} ne peut pas assurer son créneau du ${formatDayLabel(
          assignee.shift.date
        )} à ${SITE_LABELS[site]}. Disponible ?`;
        // Ouvre directement le mois du créneau concerné plutôt que le mois
        // courant, pour ne pas obliger la personne à chercher la bonne
        // date après avoir cliqué sur la notification.
        const shiftYear = assignee.shift.date.getFullYear();
        const shiftMonth = assignee.shift.date.getMonth() + 1;

        await sendPushToUsers(
          candidates.map((c) => c.id),
          { title, body, url: `/planning?y=${shiftYear}&m=${shiftMonth}` }
        );
        await prisma.pushNotificationLog.create({
          data: {
            category: "REPLACEMENT_REQUEST",
            title,
            body,
            recipients: candidates.length,
            recipientNames: candidates.map((c) => c.name).join(", "),
          },
        });
      }
    }
  }

  revalidatePath("/planning");
  revalidatePath("/organisation/planning");
}

// ---------- Fermetures globales (vacances) ----------

const closureSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de début invalide"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de fin invalide"),
  label: z.string().trim().min(1, "Libellé requis").max(191),
});

export async function createPlanningClosure(formData: FormData) {
  await requireOrganisationUser();

  const parsed = closureSchema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    label: formData.get("label"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Fermeture invalide");
  }

  const startDate = parseDateKey(parsed.data.startDate);
  const endDate = parseDateKey(parsed.data.endDate);
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("La date de fin doit être après la date de début");
  }

  await prisma.planningClosure.create({
    data: { startDate, endDate, label: parsed.data.label },
  });

  revalidatePath("/planning");
  revalidatePath("/organisation/planning");
}

export async function deletePlanningClosure(formData: FormData) {
  await requireOrganisationUser();

  const id = String(formData.get("id") ?? "");
  await prisma.planningClosure.delete({ where: { id } }).catch(() => {});

  revalidatePath("/planning");
  revalidatePath("/organisation/planning");
}

export async function cancelReplacementRequest(formData: FormData) {
  const user = await requireUser();
  const shiftId = String(formData.get("shiftId") ?? "");
  const targetUserId = String(formData.get("userId") ?? user.id);

  if (targetUserId !== user.id && !isOrganisationRole(user.role)) {
    throw new Error("Action non autorisée");
  }

  await prisma.openingShiftAssignee.updateMany({
    where: { shiftId, userId: targetUserId },
    data: {
      seekingReplacement: false,
      replacementRequestedAt: null,
      problemAlertSentAt: null,
    },
  });

  revalidatePath("/planning");
  revalidatePath("/organisation/planning");
}

// N'importe quel·le bénévole connecté·e peut se proposer pour un créneau
// en attente de remplaçant·e (comme pour les événements) : la personne
// initiale est retirée du créneau, remplacée par celle qui clique.
export async function fulfillShiftReplacement(formData: FormData) {
  const user = await requireUser();
  const shiftId = String(formData.get("shiftId") ?? "");
  const replacedUserId = String(formData.get("userId") ?? "");

  const [target, viewer] = await Promise.all([
    prisma.openingShiftAssignee.findUnique({
      where: { shiftId_userId: { shiftId, userId: replacedUserId } },
      include: { user: { select: { role: true, poste: true } } },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { role: true, poste: true } }),
  ]);
  if (!target || !target.seekingReplacement) {
    throw new Error("Ce créneau n'est plus à remplacer");
  }
  if (target.userId === user.id) {
    throw new Error("Vous ne pouvez pas remplacer votre propre créneau");
  }
  // Même règle que côté affichage (voir canReplaceAssignee) : pas de
  // message distinct ici, le même refus générique qu'un créneau qui
  // n'est plus à remplacer, pour ne jamais dire à quelqu'un qu'il/elle
  // n'a pas le niveau.
  if (!canReplaceAssignee(target.user, viewer)) {
    throw new Error("Ce créneau n'est plus à remplacer");
  }

  await prisma.$transaction([
    prisma.openingShiftAssignee.delete({ where: { id: target.id } }),
    prisma.openingShiftAssignee.upsert({
      where: { shiftId_userId: { shiftId, userId: user.id } },
      update: {
        seekingReplacement: false,
        replacementRequestedAt: null,
        problemAlertSentAt: null,
        fonction: target.fonction,
      },
      create: { shiftId, userId: user.id, fonction: target.fonction },
    }),
  ]);

  revalidatePath("/planning");
  revalidatePath("/organisation/planning");
}
