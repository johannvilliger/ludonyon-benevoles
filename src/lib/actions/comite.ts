"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireComiteUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import {
  isValidComiteItemType,
  isValidComitePriority,
  COMITE_ITEM_TYPE_LABELS,
} from "@/lib/comite";

const PATH = "/organisation/comite";

// ---------- Catégories (créées à la volée par le comité) ----------

const categorySchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(100),
});

export async function createComiteCategory(formData: FormData) {
  await requireComiteUser();

  const parsed = categorySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  const existing = await prisma.comiteItemCategory.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    throw new Error("Une catégorie porte déjà ce nom");
  }

  await prisma.comiteItemCategory.create({ data: { name: parsed.data.name } });
  revalidatePath(PATH);
}

export async function deleteComiteCategory(formData: FormData) {
  await requireComiteUser();
  const id = String(formData.get("id"));

  // Les items de cette catégorie ne sont pas supprimés, juste décatégorisés
  // (onDelete: SetNull côté schéma).
  await prisma.comiteItemCategory.delete({ where: { id } });
  revalidatePath(PATH);
}

// ---------- Items (notes et tâches) ----------

const itemSchema = z.object({
  type: z.string().refine(isValidComiteItemType, "Type invalide"),
  title: z.string().trim().min(1, "Le titre est requis").max(200),
  description: z.string().trim().max(5000).optional(),
  categoryId: z.string().trim().min(1).optional(),
  priority: z.string().optional(),
  dueDate: z.string().trim().min(1).optional(),
});

function parseItemForm(formData: FormData) {
  const raw = {
    type: String(formData.get("type") ?? "TACHE"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    categoryId: formData.get("categoryId") || undefined,
    priority: formData.get("priority") || undefined,
    dueDate: formData.get("dueDate") || undefined,
  };
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }
  // La priorité et l'échéance n'ont de sens que pour une tâche — ignorées
  // silencieusement si envoyées avec une note plutôt que rejetées, pour ne
  // pas bloquer sur un champ laissé par erreur dans un formulaire généré
  // côté client.
  const isTache = parsed.data.type === "TACHE";
  const priority = isTache && parsed.data.priority ? parsed.data.priority : null;
  if (priority && !isValidComitePriority(priority)) {
    throw new Error("Priorité invalide");
  }
  return {
    type: parsed.data.type,
    title: parsed.data.title,
    description: parsed.data.description || null,
    categoryId: parsed.data.categoryId ?? null,
    priority,
    dueDate: isTache && parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
  };
}

export async function createComiteItem(formData: FormData) {
  const user = await requireComiteUser();
  const data = parseItemForm(formData);

  await prisma.comiteItem.create({
    data: { ...data, authorId: user.id },
  });
  revalidatePath(PATH);
}

export async function updateComiteItem(formData: FormData) {
  await requireComiteUser();
  const id = String(formData.get("id"));
  const data = parseItemForm(formData);

  await prisma.comiteItem.update({ where: { id }, data });
  revalidatePath(PATH);
  redirect(PATH);
}

// Partagé entre tous les membres du comité : n'importe lequel peut
// supprimer un item (même esprit que la suppression d'un groupe ou d'une
// catégorie) — ce tableau est un outil commun, pas une liste de tâches
// personnelles avec un propriétaire exclusif.
export async function deleteComiteItem(formData: FormData) {
  await requireComiteUser();
  const id = String(formData.get("id"));

  await prisma.comiteItem.delete({ where: { id } });
  revalidatePath(PATH);
}

export async function toggleComiteItemDone(formData: FormData) {
  await requireComiteUser();
  const id = String(formData.get("id"));

  const item = await prisma.comiteItem.findUnique({ where: { id }, select: { done: true } });
  if (!item) throw new Error("Item introuvable");

  await prisma.comiteItem.update({ where: { id }, data: { done: !item.done } });
  revalidatePath(PATH);
}

// "C'est pas pour moi" : déclaration explicite et individuelle (pas un
// simple champ sur l'item), pour que plusieurs membres puissent décliner
// la même tâche sans effacer la déclaration des autres, et que chacun·e
// puisse revenir dessus (toggle) si la situation change.
export async function toggleComiteItemDecline(formData: FormData) {
  const user = await requireComiteUser();
  const itemId = String(formData.get("itemId"));

  const existing = await prisma.comiteItemDecline.findUnique({
    where: { itemId_userId: { itemId, userId: user.id } },
  });

  if (existing) {
    await prisma.comiteItemDecline.delete({ where: { id: existing.id } });
  } else {
    await prisma.comiteItemDecline.create({ data: { itemId, userId: user.id } });
  }
  revalidatePath(PATH);
}

// ---------- Fil de discussion (notes libres, demande/réponse de statut) ----------

const noteSchema = z.object({
  itemId: z.string().min(1),
  body: z.string().trim().min(1, "Le message est requis").max(2000),
});

export async function addComiteItemNote(formData: FormData) {
  const user = await requireComiteUser();

  const parsed = noteSchema.safeParse({
    itemId: formData.get("itemId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Champs invalides");
  }

  await prisma.comiteItemNote.create({
    data: { itemId: parsed.data.itemId, authorId: user.id, body: parsed.data.body },
  });
  revalidatePath(PATH);
}

// Suppression réservée à l'auteur·e du message, contrairement aux items
// eux-mêmes : un fil de discussion s'édite moins librement qu'un tableau de
// tâches partagé.
export async function deleteComiteItemNote(formData: FormData) {
  const user = await requireComiteUser();
  const id = String(formData.get("id"));

  const note = await prisma.comiteItemNote.findUnique({ where: { id }, select: { authorId: true } });
  if (!note) throw new Error("Message introuvable");
  if (note.authorId !== user.id) throw new Error("Tu ne peux supprimer que tes propres messages");

  await prisma.comiteItemNote.delete({ where: { id } });
  revalidatePath(PATH);
}

// ---------- Notification ----------

export async function notifyComiteAboutItem(formData: FormData) {
  const user = await requireComiteUser();
  const itemId = String(formData.get("itemId"));

  const item = await prisma.comiteItem.findUnique({ where: { id: itemId }, select: { title: true, type: true } });
  if (!item) throw new Error("Item introuvable");

  const comite = await prisma.user.findMany({
    where: { active: true, role: "COMITE" },
    select: { id: true, name: true },
  });

  const title = `${COMITE_ITEM_TYPE_LABELS[item.type as "NOTE" | "TACHE"]} du comité`;
  const body = `${user.name} attire l'attention sur « ${item.title} »`;

  await sendPushToUsers(
    comite.map((c) => c.id),
    { title, body, url: "/organisation/comite" },
  );
  await prisma.pushNotificationLog.create({
    data: {
      category: "COMITE_ITEM",
      title,
      body,
      recipients: comite.length,
      recipientNames: comite.map((c) => c.name).join(", "),
      authorName: user.name,
    },
  });
  revalidatePath(PATH);
}
