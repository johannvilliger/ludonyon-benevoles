"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireOrganisationUser, requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ROLES, isOrganisationRole, canAccessEventAudience } from "@/lib/roles";
import { savePhoto, deletePhoto } from "@/lib/photoStorage";
import { sendPushToUsers } from "@/lib/push";
import { mailConfigured, sendMail } from "@/lib/mail";
import { guideAttachmentPath, guideExists, saveGuide, deleteGuide } from "@/lib/guideStorage";
import { getAvailabilityOptions } from "@/lib/planning";
import { isValidPoste } from "@/lib/postes";
import { isValidClothingSize, isValidClothingCut } from "@/lib/clothing";
import { isValidOpeningFrequency, isValidAnimFrequency } from "@/lib/frequencies";
import { saveRecording, deleteRecording } from "@/lib/recordingStorage";
import { generateProvisionalPassword } from "@/lib/password";

// ---------- Annonces ----------

const announcementSchema = z.object({
  title: z.string().trim().min(1, "Le titre est requis").max(200),
  body: z.string().trim().min(1, "Le contenu est requis").max(5000),
});

export async function createAnnouncement(formData: FormData) {
  const user = await requireOrganisationUser();

  const parsed = announcementSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  await prisma.announcement.create({
    data: { ...parsed.data, authorId: user.id },
  });

  revalidatePath("/annonces");
  revalidatePath("/organisation/annonces");
  revalidatePath("/");
}

export async function deleteAnnouncement(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));

  await prisma.announcement.delete({ where: { id } });

  revalidatePath("/annonces");
  revalidatePath("/organisation/annonces");
  revalidatePath("/");
}

// ---------- Événements ----------

const eventSchema = z.object({
  title: z.string().trim().min(1, "Le titre est requis").max(200),
  description: z.string().trim().max(5000).optional(),
  location: z.string().trim().max(200).optional(),
  startsAt: z.string().min(1, "La date de début est requise"),
  endsAt: z.string().optional(),
  paid: z.coerce.boolean().optional(),
  committeeOnly: z.coerce.boolean().optional(),
});

export async function createEvent(formData: FormData) {
  const user = await requireOrganisationUser();

  const parsed = eventSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    location: formData.get("location") || undefined,
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt") || undefined,
    paid: formData.get("paid") === "on" ? true : undefined,
    committeeOnly: formData.get("committeeOnly") === "on" ? true : undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Date de début invalide");
  }
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    throw new Error("Date de fin invalide");
  }

  // Seul le comité peut créer une séance réservée au comité, même si le
  // champ était présent dans la requête (défense en profondeur : la case
  // n'est de toute façon affichée qu'aux membres du comité).
  const committeeOnly = parsed.data.committeeOnly && user.role === "COMITE";

  await prisma.event.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      location: parsed.data.location ?? null,
      startsAt,
      endsAt,
      paid: parsed.data.paid ?? false,
      audience: committeeOnly ? "COMITE" : "ALL",
      createdById: user.id,
    },
  });

  revalidatePath("/evenements");
  revalidatePath("/organisation/evenements");
  revalidatePath("/");
}

// L'ordre du jour (comité uniquement) a son propre formulaire
// (updateEventAgenda) : il n'existe pas dans eventSchema.
const eventUpdateSchema = eventSchema.omit({ committeeOnly: true });

// Modifie le contenu d'un événement existant (titre, description, lieu,
// horaires, rémunéré), y compris un événement déjà terminé — utile pour
// corriger une erreur de saisie (ex. mauvaise date). L'audience (comité ou
// tout le monde) n'est en revanche jamais modifiable après création, pour
// ne pas basculer une séance confidentielle par erreur.
export async function updateEvent(formData: FormData) {
  const user = await requireOrganisationUser();
  const id = String(formData.get("id"));

  const existing = await prisma.event.findUnique({ where: { id } });
  if (!existing || !canAccessEventAudience(existing.audience, user.role)) {
    throw new Error("Événement introuvable");
  }
  if (!existing.active) {
    throw new Error("Un événement archivé ne peut plus être modifié");
  }

  const parsed = eventUpdateSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    location: formData.get("location") || undefined,
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt") || undefined,
    paid: formData.get("paid") === "on" ? true : undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Date de début invalide");
  }
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    throw new Error("Date de fin invalide");
  }

  await prisma.event.update({
    where: { id },
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      location: parsed.data.location ?? null,
      startsAt,
      endsAt,
      paid: parsed.data.paid ?? false,
    },
  });

  revalidatePath("/evenements");
  revalidatePath(`/evenements/${id}`);
  revalidatePath("/organisation/evenements");
  revalidatePath(`/organisation/evenements/${id}`);
  revalidatePath("/");
}

export async function archiveEvent(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));

  await prisma.event.update({ where: { id }, data: { active: false } });

  revalidatePath("/evenements");
  revalidatePath("/organisation/evenements");
  revalidatePath("/");
}

export async function unarchiveEvent(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));

  await prisma.event.update({ where: { id }, data: { active: true } });

  revalidatePath("/evenements");
  revalidatePath("/organisation/evenements");
  revalidatePath("/");
}

export async function deleteEvent(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));

  const event = await prisma.event.findUniqueOrThrow({ where: { id } });
  if (event.active) {
    throw new Error("Archivez d'abord cet événement avant de le supprimer");
  }

  await prisma.event.delete({ where: { id } });

  revalidatePath("/evenements");
  revalidatePath("/organisation/evenements");
  revalidatePath("/");
}

export async function toggleEventPaid(formData: FormData) {
  const id = String(formData.get("id"));
  await requireOrganisationUser();

  const event = await prisma.event.findUniqueOrThrow({ where: { id } });
  await prisma.event.update({
    where: { id },
    data: { paid: !event.paid },
  });

  revalidatePath("/evenements");
  revalidatePath("/organisation/evenements");
  revalidatePath(`/organisation/evenements/${id}`);
}

export async function updateEventAgenda(formData: FormData) {
  const user = await requireOrganisationUser();
  const eventId = String(formData.get("eventId"));
  const agenda = String(formData.get("agenda") ?? "").trim();

  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  if (!canAccessEventAudience(event.audience, user.role)) {
    throw new Error("Accès refusé");
  }
  // Ordre du jour réservé aux séances comité, même via une requête forgée —
  // pas seulement un masquage côté page de gestion.
  if (event.audience !== "COMITE") {
    throw new Error("L'ordre du jour n'est disponible que pour les séances comité");
  }

  await prisma.event.update({
    where: { id: eventId },
    data: { agenda: agenda || null },
  });

  revalidatePath(`/organisation/evenements/${eventId}`);
}

export async function uploadEventRecording(formData: FormData) {
  const user = await requireOrganisationUser();
  const eventId = String(formData.get("eventId"));
  const file = formData.get("recording");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Aucun enregistrement reçu");
  }

  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  if (!canAccessEventAudience(event.audience, user.role)) {
    throw new Error("Accès refusé");
  }
  // Enregistrement audio réservé aux séances comité, même via une requête
  // forgée — pas seulement un masquage côté page de gestion.
  if (event.audience !== "COMITE") {
    throw new Error("L'enregistrement audio n'est disponible que pour les séances comité");
  }

  const filename = await saveRecording(eventId, file);
  await deleteRecording(event.recordingPath);
  await prisma.event.update({
    where: { id: eventId },
    data: { recordingPath: filename },
  });

  revalidatePath(`/organisation/evenements/${eventId}`);
}

export async function deleteEventRecording(formData: FormData) {
  const user = await requireOrganisationUser();
  const eventId = String(formData.get("eventId"));

  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  if (!canAccessEventAudience(event.audience, user.role)) {
    throw new Error("Accès refusé");
  }
  if (event.audience !== "COMITE") {
    throw new Error("L'enregistrement audio n'est disponible que pour les séances comité");
  }

  await deleteRecording(event.recordingPath);
  await prisma.event.update({
    where: { id: eventId },
    data: { recordingPath: null },
  });

  revalidatePath(`/organisation/evenements/${eventId}`);
}

// ---------- Modèles d'événements (événements cycliques) ----------

const eventTemplateSchema = z.object({
  name: z.string().trim().min(1, "Le nom du modèle est requis").max(200),
  title: z.string().trim().min(1, "Le titre est requis").max(200),
  description: z.string().trim().max(5000).optional(),
  location: z.string().trim().max(200).optional(),
  paid: z.coerce.boolean().optional(),
});

export async function createEventTemplate(formData: FormData) {
  await requireOrganisationUser();

  const parsed = eventTemplateSchema.safeParse({
    name: formData.get("name"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    location: formData.get("location") || undefined,
    paid: formData.get("paid") === "on" ? true : undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  await prisma.eventTemplate.create({
    data: {
      name: parsed.data.name,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      location: parsed.data.location ?? null,
      paid: parsed.data.paid ?? false,
    },
  });

  revalidatePath("/organisation/evenements/modeles");
}

export async function deleteEventTemplate(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));

  await prisma.eventTemplate.delete({ where: { id } });

  revalidatePath("/organisation/evenements/modeles");
}

// daysBeforeEvent n'a pas de borne minimale : une valeur négative signifie
// une échéance après l'événement (ex. rapport, synthèse à rédiger après le
// troc annuel).
const taskTemplateSchema = z.object({
  eventTemplateId: z.string().min(1),
  title: z.string().trim().min(1, "Le titre est requis").max(200),
  description: z.string().trim().max(2000).optional(),
  daysBeforeEvent: z.coerce.number().int(),
  reminderDaysBefore: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
});

export async function addTaskTemplate(formData: FormData) {
  await requireOrganisationUser();

  const reminderRaw = formData.get("reminderDaysBefore");
  const parsed = taskTemplateSchema.safeParse({
    eventTemplateId: formData.get("eventTemplateId"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    daysBeforeEvent: formData.get("daysBeforeEvent"),
    reminderDaysBefore: reminderRaw === null || reminderRaw === "" ? undefined : reminderRaw,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const count = await prisma.eventTaskTemplate.count({
    where: { eventTemplateId: parsed.data.eventTemplateId },
  });

  await prisma.eventTaskTemplate.create({
    data: {
      eventTemplateId: parsed.data.eventTemplateId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      daysBeforeEvent: parsed.data.daysBeforeEvent,
      reminderDaysBefore:
        typeof parsed.data.reminderDaysBefore === "number" ? parsed.data.reminderDaysBefore : null,
      order: count,
    },
  });

  revalidatePath("/organisation/evenements/modeles");
}

const taskTemplateUpdateSchema = taskTemplateSchema
  .omit({ eventTemplateId: true })
  .extend({ id: z.string().min(1) });

export async function updateTaskTemplate(formData: FormData) {
  await requireOrganisationUser();

  const reminderRaw = formData.get("reminderDaysBefore");
  const parsed = taskTemplateUpdateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    daysBeforeEvent: formData.get("daysBeforeEvent"),
    reminderDaysBefore: reminderRaw === null || reminderRaw === "" ? undefined : reminderRaw,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  await prisma.eventTaskTemplate.update({
    where: { id: parsed.data.id },
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      daysBeforeEvent: parsed.data.daysBeforeEvent,
      reminderDaysBefore:
        typeof parsed.data.reminderDaysBefore === "number" ? parsed.data.reminderDaysBefore : null,
    },
  });

  revalidatePath("/organisation/evenements/modeles");
}

export async function deleteTaskTemplate(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));

  await prisma.eventTaskTemplate.delete({ where: { id } });

  revalidatePath("/organisation/evenements/modeles");
}

const createFromTemplateSchema = z.object({
  eventTemplateId: z.string().min(1),
  startsAt: z.string().min(1, "La date de début est requise"),
  endsAt: z.string().optional(),
});

// Crée un événement à partir d'un modèle (ex. le troc annuel) : reprend
// titre/description/lieu/rémunéré du modèle, et génère une Task pour
// chaque tâche type, avec une échéance calculée en reculant de
// `daysBeforeEvent` jours depuis la date choisie ici — pas depuis une date
// fixe, puisque l'événement peut tomber à une date différente chaque
// année. Les tâches générées n'ont pas d'assigné·e à la création (voir
// updateTaskAssignees pour les répartir ensuite).
export async function createEventFromTemplate(formData: FormData) {
  const user = await requireOrganisationUser();

  const parsed = createFromTemplateSchema.safeParse({
    eventTemplateId: formData.get("eventTemplateId"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Date de début invalide");
  }
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    throw new Error("Date de fin invalide");
  }

  const template = await prisma.eventTemplate.findUnique({
    where: { id: parsed.data.eventTemplateId },
    include: { taskTemplates: { orderBy: { order: "asc" } } },
  });
  if (!template) {
    throw new Error("Modèle introuvable");
  }

  const event = await prisma.event.create({
    data: {
      title: template.title,
      description: template.description,
      location: template.location,
      paid: template.paid,
      startsAt,
      endsAt,
      audience: "ALL",
      createdById: user.id,
      eventTemplateId: template.id,
    },
  });

  if (template.taskTemplates.length > 0) {
    // dueDate normalisée à minuit UTC du jour calendaire de l'événement,
    // comme les autres champs "date seule" de l'app (voir createTask et
    // checkAndSendTaskReminders) — sinon l'heure de l'événement (ex. 23h)
    // pourrait faire basculer le calcul sur le mauvais jour UTC.
    const eventDay = new Date(
      Date.UTC(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate())
    );
    await prisma.task.createMany({
      data: template.taskTemplates.map((tt) => {
        const dueDate = new Date(eventDay);
        dueDate.setUTCDate(dueDate.getUTCDate() - tt.daysBeforeEvent);
        return {
          eventId: event.id,
          title: tt.title,
          dueDate,
          reminderDaysBefore: tt.reminderDaysBefore,
        };
      }),
    });
  }

  revalidatePath("/evenements");
  revalidatePath("/organisation/evenements");
  revalidatePath("/");

  redirect(`/organisation/evenements/${event.id}`);
}

// ---------- Présences ----------

export async function addVolunteerToEvent(formData: FormData) {
  const eventId = String(formData.get("eventId"));
  const userId = String(formData.get("userId"));
  if (!eventId || !userId) {
    throw new Error("Champs invalides");
  }
  await requireOrganisationUser();

  // Une séance comité ne peut accueillir que des membres du comité, même
  // via une requête forgée — pas seulement un filtrage côté formulaire.
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { audience: true } });
  if (event?.audience === "COMITE") {
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (target?.role !== "COMITE") {
      throw new Error("Seul·es les membres du comité peuvent être ajouté·es à une séance comité");
    }
  }

  await prisma.eventSignup.upsert({
    where: { eventId_userId: { eventId, userId } },
    update: {},
    create: { eventId, userId },
  });

  revalidatePath(`/organisation/evenements/${eventId}`);
  revalidatePath("/evenements");
  revalidatePath("/");
}

export async function removeEventSignup(formData: FormData) {
  const signupId = String(formData.get("signupId"));
  const eventId = String(formData.get("eventId"));
  await requireOrganisationUser();

  await prisma.eventSignup.delete({ where: { id: signupId } });

  revalidatePath(`/organisation/evenements/${eventId}`);
  revalidatePath("/evenements");
  revalidatePath("/");
}

export async function markArrival(formData: FormData) {
  const eventSignupId = String(formData.get("eventSignupId"));
  const eventId = String(formData.get("eventId"));
  await requireOrganisationUser();

  const openSession = await prisma.attendanceSession.findFirst({
    where: { eventSignupId, leftAt: null },
  });
  if (!openSession) {
    await prisma.attendanceSession.create({
      data: { eventSignupId, arrivedAt: new Date() },
    });
  }

  revalidatePath(`/organisation/evenements/${eventId}`);
}

export async function markDeparture(formData: FormData) {
  const eventSignupId = String(formData.get("eventSignupId"));
  const eventId = String(formData.get("eventId"));
  await requireOrganisationUser();

  const openSession = await prisma.attendanceSession.findFirst({
    where: { eventSignupId, leftAt: null },
    orderBy: { arrivedAt: "desc" },
  });
  if (openSession) {
    await prisma.attendanceSession.update({
      where: { id: openSession.id },
      data: { leftAt: new Date() },
    });
  }

  revalidatePath(`/organisation/evenements/${eventId}`);
}

export async function togglePullLoaned(formData: FormData) {
  const eventSignupId = String(formData.get("eventSignupId"));
  const eventId = String(formData.get("eventId"));
  await requireOrganisationUser();

  const signup = await prisma.eventSignup.findUniqueOrThrow({
    where: { id: eventSignupId },
  });
  await prisma.eventSignup.update({
    where: { id: eventSignupId },
    data: { pullLoaned: !signup.pullLoaned },
  });

  revalidatePath(`/organisation/evenements/${eventId}`);
}

const manualTimeSchema = z.object({
  eventSignupId: z.string().min(1),
  eventId: z.string().min(1),
  minutes: z.coerce.number().int().min(1).max(1440),
});

export async function addManualTime(formData: FormData) {
  const parsed = manualTimeSchema.safeParse({
    eventSignupId: formData.get("eventSignupId"),
    eventId: formData.get("eventId"),
    minutes: formData.get("minutes"),
  });
  if (!parsed.success) {
    throw new Error("Durée invalide (entre 1 et 1440 minutes)");
  }
  await requireOrganisationUser();

  const leftAt = new Date();
  const arrivedAt = new Date(leftAt.getTime() - parsed.data.minutes * 60000);
  await prisma.attendanceSession.create({
    data: {
      eventSignupId: parsed.data.eventSignupId,
      arrivedAt,
      leftAt,
      manual: true,
    },
  });

  revalidatePath(`/organisation/evenements/${parsed.data.eventId}`);
}

// ---------- Bénévoles ----------

// Email et mot de passe facultatifs : un·e bénévole peut être ajouté·e
// juste pour figurer dans les plannings, sans compte de connexion. Un mot
// de passe reste requis si un email est renseigné (le compte doit alors
// pouvoir se connecter).
const volunteerSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis").max(200),
    email: z
      .union([z.string().trim().toLowerCase().email("Email invalide"), z.literal("")])
      .optional(),
    phone: z.string().trim().max(50).optional(),
    skills: z.string().trim().max(1000).optional(),
    role: z.enum(ROLES),
    password: z.union([z.string().min(8, "8 caractères minimum"), z.literal("")]).optional(),
  })
  .refine((data) => !data.email || data.password, {
    message: "Mot de passe requis (8 caractères minimum) si un email est renseigné",
    path: ["password"],
  });

export async function createVolunteer(formData: FormData) {
  await requireOrganisationUser();

  const parsed = volunteerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    skills: formData.get("skills") || undefined,
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const email = parsed.data.email || null;

  if (email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error("Un compte existe déjà avec cet email");
    }
  }

  const passwordHash = email ? await bcrypt.hash(parsed.data.password!, 10) : null;

  await prisma.user.create({
    data: {
      name: parsed.data.name,
      email,
      phone: parsed.data.phone ?? null,
      skills: parsed.data.skills ?? null,
      role: parsed.data.role,
      passwordHash,
    },
  });

  if (email && mailConfigured()) {
    try {
      await sendWelcomeEmail(parsed.data.name, email, parsed.data.password!);
    } catch (err) {
      // La création du compte ne doit pas échouer si l'email ne part pas :
      // les identifiants restent transmissibles manuellement.
      console.error("Échec de l'envoi de l'email de bienvenue :", err);
    }
  }

  revalidatePath("/annuaire");
  revalidatePath("/organisation/benevoles");
}

export async function sendWelcomeEmail(
  name: string,
  email: string,
  password: string
): Promise<void> {
  const url = process.env.AUTH_URL;
  const attachments = (await guideExists())
    ? [{ filename: "mode-emploi.pdf", path: guideAttachmentPath() }]
    : undefined;

  const lines = [
    `Bonjour ${name},`,
    "",
    "Un compte a été créé pour vous sur la plateforme des bénévoles de la Ludothèque Nyon Région.",
    "",
    ...(url ? [`Adresse : ${url}`] : []),
    `Identifiant : ${email}`,
    `Mot de passe provisoire : ${password}`,
    "",
    'Nous vous recommandons de changer ce mot de passe dès votre première connexion (menu "Mon profil").',
    ...(attachments
      ? ["", "Vous trouverez en pièce jointe un mode d'emploi des fonctionnalités."]
      : []),
    "",
    "À bientôt,",
    "L'équipe de la Ludothèque Nyon Région",
  ];

  const html = lines
    .map((line) => (line ? `<p>${line}</p>` : ""))
    .join("\n")
    .replace(
      `<p>Identifiant : ${email}</p>`,
      `<p>Identifiant : <strong>${email}</strong></p>`
    )
    .replace(
      `<p>Mot de passe provisoire : ${password}</p>`,
      `<p>Mot de passe provisoire : <strong>${password}</strong></p>`
    );

  await sendMail({
    to: email,
    subject: "Bienvenue sur la plateforme des bénévoles — vos identifiants",
    text: lines.join("\n"),
    html,
    attachments,
  });
}

const volunteerContactInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Le nom est requis").max(200),
  email: z
    .union([z.string().trim().toLowerCase().email("Email invalide"), z.literal("")])
    .optional(),
  phone: z.string().trim().max(50).optional(),
});

// Édition du nom, téléphone et email d'un·e bénévole — séparée de
// updateVolunteerProfile (rôle/poste/disponibilités/habits) pour rester un
// petit formulaire autonome ("✏️ Éditer" replié par défaut sur la fiche),
// utilisable même sur son propre compte. Email facultatif : un compte
// ajouté sans email (juste pour les plannings) peut le rester, ou en
// recevoir un pour devenir un compte de connexion (utiliser ensuite
// "Réinitialiser le mot de passe" pour lui donner un accès).
export async function updateVolunteerContactInfo(formData: FormData) {
  await requireOrganisationUser();

  const parsed = volunteerContactInfoSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }
  const { id, name, phone } = parsed.data;
  const email = parsed.data.email || null;

  if (email) {
    const existing = await prisma.user.findFirst({
      where: { email, NOT: { id } },
    });
    if (existing) {
      throw new Error("Un compte existe déjà avec cet email");
    }
  }

  await prisma.user.update({
    where: { id },
    data: { name, email, phone: phone ?? null },
  });

  revalidatePath("/annuaire");
  revalidatePath("/organisation/benevoles");
}

const volunteerProfileSchema = z.object({
  id: z.string().min(1),
  role: z.enum(ROLES).optional(),
});

// Un seul bouton "Enregistrer" par bénévole dans la liste de gestion, pour
// le rôle, le poste et les disponibilités à la fois — plutôt que trois
// formulaires séparés. Le champ "role" est absent du formulaire (select
// désactivé côté client) quand on tente de modifier son propre compte ;
// "poste" est absent pour les rôles autres que bénévole (case non rendue).
export async function updateVolunteerProfile(formData: FormData) {
  const currentUser = await requireOrganisationUser();

  const roleRaw = formData.get("role");
  const parsed = volunteerProfileSchema.safeParse({
    id: formData.get("id"),
    role: roleRaw === null ? undefined : roleRaw,
  });
  if (!parsed.success) {
    throw new Error("Champs invalides");
  }
  const { id, role } = parsed.data;

  if (role) {
    if (id === currentUser.id) {
      throw new Error("Vous ne pouvez pas modifier votre propre rôle");
    }
    await prisma.user.update({ where: { id }, data: { role } });
  }

  const posteRaw = formData.get("poste");
  if (posteRaw !== null) {
    const rawStr = String(posteRaw);
    const poste = rawStr && isValidPoste(rawStr) ? rawStr : null;
    await prisma.user.update({ where: { id }, data: { poste } });
  }

  const unavailableForOpenings = formData.get("unavailableForOpenings") === "on";

  function readFrequency<T extends string>(
    field: string,
    isValid: (v: string) => v is T
  ): T | null {
    const raw = formData.get(field);
    const str = raw === null ? "" : String(raw);
    return str && isValid(str) ? str : null;
  }

  await prisma.user.update({
    where: { id },
    data: {
      unavailableForOpenings,
      openingFrequency: readFrequency("openingFrequency", isValidOpeningFrequency),
      animWeekendFrequency: readFrequency("animWeekendFrequency", isValidAnimFrequency),
      animWeekFrequency: readFrequency("animWeekFrequency", isValidAnimFrequency),
    },
  });

  function readSize(field: string): string | null {
    const raw = formData.get(field);
    const str = raw === null ? "" : String(raw);
    return str && isValidClothingSize(str) ? str : null;
  }
  function readCut(field: string): string | null {
    const raw = formData.get(field);
    const str = raw === null ? "" : String(raw);
    return str && isValidClothingCut(str) ? str : null;
  }

  await prisma.user.update({
    where: { id },
    data: {
      poloReceived: formData.get("poloReceived") === "on",
      poloSize: readSize("poloSize"),
      poloCut: readCut("poloCut"),
      pullReceived: formData.get("pullReceived") === "on",
      pullSize: readSize("pullSize"),
      pullCut: readCut("pullCut"),
    },
  });

  // Le bloc de disponibilités d'ouvertures n'est rendu (et donc soumis,
  // marqueur "availabilityFieldsRendered" présent — voir AvailabilityFields
  // dans benevoles/page.tsx) que si le/la bénévole n'était pas déjà
  // marqué·e "Pas d'ouvertures" au moment de l'affichage du formulaire. On
  // se base sur ce marqueur plutôt que sur la valeur venant d'être
  // soumise pour "unavailableForOpenings" : si le bloc n'était pas
  // affiché, on ne touche pas aux disponibilités déjà enregistrées, pour
  // ne pas les effacer via un champ "slots" absent du formulaire (ex. cas
  // où l'on décoche "Pas d'ouvertures" et enregistre en un seul clic, sans
  // avoir encore vu réapparaître les cases à cocher).
  if (formData.get("availabilityFieldsRendered") === null) {
    revalidatePath("/annuaire");
    revalidatePath("/organisation/benevoles");
    revalidatePath("/profil");
    return;
  }

  const validKeys = new Set(getAvailabilityOptions().map((o) => o.slotKey));
  const selectedSlots = formData.getAll("slots").map(String).filter((k) => validKeys.has(k));
  await prisma.$transaction([
    prisma.volunteerAvailability.deleteMany({ where: { userId: id } }),
    prisma.volunteerAvailability.createMany({
      data: selectedSlots.map((slotKey) => ({ userId: id, slotKey })),
    }),
  ]);

  revalidatePath("/annuaire");
  revalidatePath("/organisation/benevoles");
  revalidatePath("/profil");
}

export async function archiveVolunteer(formData: FormData) {
  const currentUser = await requireOrganisationUser();
  const id = String(formData.get("id"));

  if (id === currentUser.id) {
    throw new Error("Vous ne pouvez pas archiver votre propre compte");
  }

  await prisma.user.update({ where: { id }, data: { active: false } });

  revalidatePath("/annuaire");
  revalidatePath("/organisation/benevoles");
}

export async function unarchiveVolunteer(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));

  await prisma.user.update({ where: { id }, data: { active: true } });

  revalidatePath("/annuaire");
  revalidatePath("/organisation/benevoles");
}

export async function deleteVolunteer(formData: FormData) {
  const currentUser = await requireOrganisationUser();
  const id = String(formData.get("id"));

  if (id === currentUser.id) {
    throw new Error("Vous ne pouvez pas supprimer votre propre compte");
  }

  const target = await prisma.user.findUniqueOrThrow({ where: { id } });
  if (target.active) {
    throw new Error("Archivez d'abord ce compte avant de le supprimer");
  }

  await prisma.user.delete({ where: { id } });

  revalidatePath("/annuaire");
  revalidatePath("/organisation/benevoles");
}

const resetPasswordSchema = z.object({
  id: z.string().min(1),
  password: z.string().min(8, "8 caractères minimum"),
});

export async function resetVolunteerPassword(formData: FormData) {
  await requireOrganisationUser();

  const parsed = resetPasswordSchema.safeParse({
    id: formData.get("id"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await prisma.user.update({
    where: { id: parsed.data.id },
    data: { passwordHash },
  });

  revalidatePath("/organisation/benevoles");
}

export async function updateVolunteerPhoto(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Aucune image sélectionnée");
  }

  const current = await prisma.user.findUniqueOrThrow({
    where: { id },
    select: { photoPath: true },
  });

  const filename = await savePhoto(id, file);
  await prisma.user.update({ where: { id }, data: { photoPath: filename } });
  await deletePhoto(current.photoPath);

  revalidatePath("/annuaire");
  revalidatePath("/organisation/benevoles");
}

// Déclaration de vacances/indisponibilité pour un·e bénévole par un·e
// responsable/comité (ex. arrêt maladie prolongé, personne ne pouvant pas
// mettre à jour son propre compte) — mêmes dates que la déclaration en
// libre-service (voir addVacation dans actions/profile.ts), utilisées par
// les mêmes automatismes (répartition automatique, filtrage des
// disponibilités).
const vacationForUserSchema = z
  .object({
    userId: z.string().min(1),
    startDate: z.string().min(1, "Date de début requise"),
    endDate: z.string().min(1, "Date de fin requise"),
    note: z.string().trim().max(200).optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "La date de fin doit être après la date de début",
    path: ["endDate"],
  });

export async function addVacationForUser(formData: FormData) {
  await requireOrganisationUser();

  const parsed = vacationForUserSchema.safeParse({
    userId: formData.get("userId"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dates invalides");
  }

  await prisma.vacation.create({
    data: {
      userId: parsed.data.userId,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      note: parsed.data.note ?? null,
    },
  });

  revalidatePath("/profil");
  revalidatePath("/organisation/benevoles");
}

export async function deleteVacationForUser(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id") ?? "");

  await prisma.vacation.deleteMany({ where: { id } });

  revalidatePath("/profil");
  revalidatePath("/organisation/benevoles");
}

// ---------- Tâches ----------

const taskSchema = z.object({
  eventId: z.string().min(1),
  title: z.string().trim().min(1, "Le titre est requis").max(200),
  dueDate: z.string().min(1, "La date limite est requise"),
  assigneeIds: z.array(z.string().min(1)).min(1, "Choisissez au moins une personne"),
  reminderDaysBefore: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
});

export async function createTask(formData: FormData) {
  await requireOrganisationUser();

  const reminderRaw = formData.get("reminderDaysBefore");
  const parsed = taskSchema.safeParse({
    eventId: formData.get("eventId"),
    title: formData.get("title"),
    dueDate: formData.get("dueDate"),
    assigneeIds: formData.getAll("assigneeIds"),
    reminderDaysBefore: reminderRaw === null || reminderRaw === "" ? undefined : reminderRaw,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const dueDate = new Date(parsed.data.dueDate);
  if (Number.isNaN(dueDate.getTime())) {
    throw new Error("Date limite invalide");
  }

  await prisma.task.create({
    data: {
      eventId: parsed.data.eventId,
      title: parsed.data.title,
      dueDate,
      reminderDaysBefore:
        typeof parsed.data.reminderDaysBefore === "number" ? parsed.data.reminderDaysBefore : null,
      assignees: {
        create: parsed.data.assigneeIds.map((userId) => ({ userId })),
      },
    },
  });

  revalidatePath(`/organisation/evenements/${parsed.data.eventId}`);
  revalidatePath("/profil");
}

export async function deleteTask(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));
  const eventId = String(formData.get("eventId"));

  await prisma.task.delete({ where: { id } });

  revalidatePath(`/organisation/evenements/${eventId}`);
  revalidatePath("/profil");
}

const taskUpdateSchema = taskSchema
  .omit({ eventId: true, assigneeIds: true })
  .extend({ id: z.string().min(1) });

// Modifie titre/échéance/rappel d'une tâche existante — notamment pour
// ajuster la date d'une tâche générée depuis un modèle d'événement, quand
// la date calculée automatiquement (voir createEventFromTemplate) ne
// convient pas exactement une fois l'événement créé.
export async function updateTask(formData: FormData) {
  await requireOrganisationUser();
  const eventId = String(formData.get("eventId"));

  const reminderRaw = formData.get("reminderDaysBefore");
  const parsed = taskUpdateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    dueDate: formData.get("dueDate"),
    reminderDaysBefore: reminderRaw === null || reminderRaw === "" ? undefined : reminderRaw,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const dueDate = new Date(parsed.data.dueDate);
  if (Number.isNaN(dueDate.getTime())) {
    throw new Error("Date limite invalide");
  }

  await prisma.task.update({
    where: { id: parsed.data.id },
    data: {
      title: parsed.data.title,
      dueDate,
      reminderDaysBefore:
        typeof parsed.data.reminderDaysBefore === "number" ? parsed.data.reminderDaysBefore : null,
      // La date et/ou le rappel changent : on relance l'éligibilité au
      // rappel plutôt que de garder figé un envoi (ou une absence d'envoi)
      // qui correspondait à l'ancienne échéance.
      reminderSentAt: null,
    },
  });

  revalidatePath(`/organisation/evenements/${eventId}`);
  revalidatePath("/profil");
}

// Remplace la liste des assigné·e·s d'une tâche existante — nécessaire
// notamment pour répartir les tâches générées depuis un modèle d'événement
// (créées sans assigné·e à la création, voir createEventFromTemplate).
export async function updateTaskAssignees(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));
  const eventId = String(formData.get("eventId"));
  const assigneeIds = formData.getAll("assigneeIds").map(String).filter(Boolean);

  if (assigneeIds.length === 0) {
    throw new Error("Choisissez au moins une personne");
  }

  await prisma.$transaction([
    prisma.taskAssignee.deleteMany({ where: { taskId: id } }),
    prisma.taskAssignee.createMany({
      data: assigneeIds.map((userId) => ({ taskId: id, userId })),
    }),
  ]);

  revalidatePath(`/organisation/evenements/${eventId}`);
  revalidatePath("/profil");
}

export async function toggleTaskDone(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));

  const task = await prisma.task.findUniqueOrThrow({
    where: { id },
    include: { assignees: true },
  });
  const isAssignee = task.assignees.some((a) => a.userId === user.id);
  if (!isAssignee && !isOrganisationRole(user.role)) {
    throw new Error("Vous n'êtes pas autorisé·e à modifier cette tâche");
  }

  await prisma.task.update({
    where: { id },
    data: { done: !task.done },
  });

  revalidatePath(`/organisation/evenements/${task.eventId}`);
  revalidatePath("/profil");
}

// ---------- Groupes ----------

const groupSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(100),
});

export async function createGroup(formData: FormData) {
  await requireOrganisationUser();

  const parsed = groupSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const existing = await prisma.group.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    throw new Error("Un groupe porte déjà ce nom");
  }

  await prisma.group.create({ data: { name: parsed.data.name } });

  revalidatePath("/organisation/groupes");
  revalidatePath("/organisation/notifications");
}

export async function deleteGroup(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));

  await prisma.group.delete({ where: { id } });

  revalidatePath("/organisation/groupes");
  revalidatePath("/organisation/notifications");
}

export async function addGroupMember(formData: FormData) {
  await requireOrganisationUser();
  const groupId = String(formData.get("groupId"));
  const userId = String(formData.get("userId"));
  if (!groupId || !userId) {
    throw new Error("Champs invalides");
  }

  await prisma.groupMembership.upsert({
    where: { groupId_userId: { groupId, userId } },
    update: {},
    create: { groupId, userId },
  });

  revalidatePath("/organisation/groupes");
}

export async function removeGroupMember(formData: FormData) {
  await requireOrganisationUser();
  const id = String(formData.get("id"));

  await prisma.groupMembership.delete({ where: { id } });

  revalidatePath("/organisation/groupes");
}

// ---------- Notifications ----------

// target : "all" | "organisation" | "group:<id>".
const notificationSchema = z.object({
  title: z.string().trim().min(1, "Le titre est requis").max(100),
  body: z.string().trim().min(1, "Le message est requis").max(500),
  target: z.string().min(1),
});

export async function sendManualNotification(formData: FormData) {
  const currentUser = await requireOrganisationUser();

  const parsed = notificationSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    target: formData.get("target"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const isOrganisationOnly = parsed.data.target === "organisation";
  const groupId = parsed.data.target.startsWith("group:")
    ? parsed.data.target.slice("group:".length)
    : null;

  let users: { id: string; name: string }[];
  let groupName: string | null = null;

  if (groupId) {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: {
        name: true,
        members: {
          where: { user: { active: true } },
          select: { user: { select: { id: true, name: true } } },
        },
      },
    });
    groupName = group?.name ?? null;
    users = group?.members.map((m) => m.user) ?? [];
  } else {
    users = await prisma.user.findMany({
      where: {
        active: true,
        ...(isOrganisationOnly
          ? { role: { in: ["RESPONSABLE", "COMITE"] } }
          : {}),
      },
      select: { id: true, name: true },
    });
  }

  // La notification est aussi relayée dans les annonces, avec la même
  // audience : un·e bénévole ne doit jamais voir une annonce destinée
  // uniquement aux responsables/comité, ni à un groupe dont il/elle n'est
  // pas membre (voir le filtrage par groupId dans /annonces et l'accueil).
  await prisma.announcement.create({
    data: {
      title: parsed.data.title,
      body: parsed.data.body,
      audience: isOrganisationOnly ? "ORGANISATION" : groupId ? "GROUP" : "ALL",
      groupId,
      authorId: currentUser.id,
    },
  });
  revalidatePath("/annonces");
  revalidatePath("/organisation/annonces");
  revalidatePath("/");

  await sendPushToUsers(
    users.map((u) => u.id),
    { title: parsed.data.title, body: parsed.data.body, url: "/annonces" }
  );
  await prisma.pushNotificationLog.create({
    data: {
      category: "MANUAL",
      title: parsed.data.title,
      body: parsed.data.body,
      recipients: users.length,
      recipientNames: users.map((u) => u.name).join(", "),
      targetGroupName: groupName,
    },
  });

  revalidatePath("/organisation/notifications");
}

const groupNotificationSchema = z.object({
  groupId: z.string().min(1),
  title: z.string().trim().min(1, "Le titre est requis").max(100),
  body: z.string().trim().min(1, "Le message est requis").max(500),
});

// Permet à n'importe quel·le bénévole de notifier les autres membres d'un
// groupe auquel il/elle appartient (ex. rappeler une réunion Déco/Brico) —
// contrairement à sendManualNotification, réservée aux responsables/comité.
// L'appartenance au groupe est revérifiée ici, pas seulement masquée côté
// page (voir /profil, qui ne propose que les groupes de l'utilisateur·rice).
export async function sendGroupNotification(formData: FormData) {
  const currentUser = await requireUser();

  const parsed = groupNotificationSchema.safeParse({
    groupId: formData.get("groupId"),
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const group = await prisma.group.findUnique({
    where: { id: parsed.data.groupId },
    select: {
      name: true,
      members: {
        where: { user: { active: true } },
        select: { userId: true, user: { select: { id: true, name: true } } },
      },
    },
  });
  if (!group) {
    throw new Error("Groupe introuvable");
  }
  if (!group.members.some((m) => m.userId === currentUser.id)) {
    throw new Error("Vous ne faites pas partie de ce groupe");
  }

  const recipients = group.members.map((m) => m.user);

  await prisma.announcement.create({
    data: {
      title: parsed.data.title,
      body: parsed.data.body,
      audience: "GROUP",
      groupId: parsed.data.groupId,
      authorId: currentUser.id,
    },
  });

  await sendPushToUsers(
    recipients.map((u) => u.id),
    { title: parsed.data.title, body: parsed.data.body, url: "/annonces" }
  );
  await prisma.pushNotificationLog.create({
    data: {
      category: "GROUP_PEER",
      title: parsed.data.title,
      body: parsed.data.body,
      recipients: recipients.length,
      recipientNames: recipients.map((u) => u.name).join(", "),
      targetGroupName: group.name,
      authorName: currentUser.name,
    },
  });

  revalidatePath("/annonces");
  revalidatePath("/organisation/annonces");
  revalidatePath("/organisation/notifications");
  revalidatePath("/");
}

// ---------- Paramètres (mode d'emploi) ----------

export async function uploadGuide(formData: FormData) {
  await requireOrganisationUser();

  const file = formData.get("guide");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Aucun fichier sélectionné");
  }

  await saveGuide(file);
  revalidatePath("/organisation/parametres");
}

export async function removeGuide() {
  await requireOrganisationUser();
  await deleteGuide();
  revalidatePath("/organisation/parametres");
}

// ---------- Envoi de lancement ----------

// Liste affichée dans Espace organisation > Paramètres avant l'envoi
// (voir sendLaunchEmails) : qui va recevoir un nouveau mot de passe.
export async function getLaunchEmailRecipients() {
  await requireOrganisationUser();
  return prisma.user.findMany({
    where: { active: true, email: { not: null } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

async function sendLaunchEmail(
  name: string,
  email: string,
  password: string
): Promise<void> {
  const url = process.env.AUTH_URL;
  const attachments = (await guideExists())
    ? [{ filename: "mode-emploi.pdf", path: guideAttachmentPath() }]
    : undefined;

  const lines = [
    `Bonjour ${name},`,
    "",
    "La plateforme des bénévoles de la Ludothèque Nyon Région est en ligne ! Voici comment vous connecter et ce que vous pouvez y faire.",
    "",
    "VOS IDENTIFIANTS",
    ...(url ? [`Adresse : ${url}`] : []),
    `Identifiant : ${email}`,
    `Mot de passe provisoire : ${password}`,
    'Nous vous recommandons de le changer dès votre première connexion (menu "Mon profil").',
    "",
    "CE QUE VOUS POUVEZ Y FAIRE",
    "- Annuaire : coordonnées des autres bénévoles.",
    "- Annonces : les nouvelles de l'équipe.",
    "- Événements : vous inscrire/désinscrire aux permanences et animations à venir.",
    "- Planning des ouvertures : voir qui tient la ludothèque chaque semaine.",
    '- Mon profil : vos disponibilités, vacances, et activer les notifications.',
    "",
    "INSTALLER L'APPLICATION SUR VOTRE TÉLÉPHONE",
    "Ce n'est pas obligatoire (le site fonctionne aussi dans un navigateur classique), mais ça donne une icône comme une vraie application et permet de recevoir des notifications.",
    "",
    "Sur iPhone (obligatoire pour les notifications sur iOS) :",
    "1. Ouvrez l'adresse ci-dessus dans Safari (pas un autre navigateur).",
    '2. Appuyez sur l\'icône de partage (le carré avec une flèche vers le haut).',
    '3. Choisissez « Sur l\'écran d\'accueil ».',
    "",
    "Sur Android :",
    "1. Ouvrez l'adresse ci-dessus dans Chrome.",
    '2. Appuyez sur le menu (⋮) en haut à droite.',
    '3. Choisissez « Installer l\'application » ou « Ajouter à l\'écran d\'accueil ».',
    "",
    "Une fois installée (ou directement sur le site), pensez à activer les notifications depuis \"Mon profil\" si vous voulez être prévenu·e des événements à venir.",
    ...(attachments
      ? ["", "Vous trouverez en pièce jointe un mode d'emploi plus détaillé."]
      : []),
    "",
    "À bientôt,",
    "L'équipe de la Ludothèque Nyon Région",
  ];

  const html = lines
    .map((line) =>
      line === "VOS IDENTIFIANTS" ||
      line === "CE QUE VOUS POUVEZ Y FAIRE" ||
      line === "INSTALLER L'APPLICATION SUR VOTRE TÉLÉPHONE"
        ? `<h3>${line}</h3>`
        : line
          ? `<p>${line}</p>`
          : ""
    )
    .join("\n")
    .replace(
      `<p>Identifiant : ${email}</p>`,
      `<p>Identifiant : <strong>${email}</strong></p>`
    )
    .replace(
      `<p>Mot de passe provisoire : ${password}</p>`,
      `<p>Mot de passe provisoire : <strong>${password}</strong></p>`
    );

  await sendMail({
    to: email,
    subject: "La plateforme des bénévoles est en ligne — vos identifiants",
    text: lines.join("\n"),
    html,
    attachments,
  });
}

// Réinitialise le mot de passe de tous les comptes actifs ayant un email,
// puis envoie à chacun le nouveau mot de passe avec un résumé du
// fonctionnement et les instructions d'installation (voir
// sendLaunchEmail). Un mot de passe ne pouvant jamais être relu une fois
// haché, c'est la seule façon de "redonner" un accès à tout le monde d'un
// coup — y compris à qui aurait déjà personnalisé le sien depuis la
// création de son compte (confirmation explicite requise côté formulaire,
// voir ParametresPage).
export async function sendLaunchEmails(formData: FormData) {
  await requireOrganisationUser();

  if (formData.get("confirm") !== "1") {
    throw new Error("Confirmation manquante");
  }
  if (!mailConfigured()) {
    throw new Error("Aucun serveur d'envoi configuré (variables SMTP_* absentes)");
  }

  const recipients = await prisma.user.findMany({
    where: { active: true, email: { not: null } },
    select: { id: true, name: true, email: true },
  });

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const password = generateProvisionalPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: recipient.id }, data: { passwordHash } });
    try {
      await sendLaunchEmail(recipient.name, recipient.email!, password);
      sent++;
    } catch (err) {
      // Le mot de passe est déjà changé en base à ce stade : la personne
      // devra passer par "Réinitialiser le mot de passe" (Espace
      // organisation > Bénévoles) pour lui en communiquer un nouveau
      // manuellement si l'email n'est pas parti.
      console.error(`Échec de l'envoi de l'email de lancement à ${recipient.email} :`, err);
      failed++;
    }
  }

  revalidatePath("/organisation/parametres");
  redirect(`/organisation/parametres?lancement=${sent}&echecs=${failed}`);
}
