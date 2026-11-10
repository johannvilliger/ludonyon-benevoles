"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { mailConfigured } from "@/lib/mail";
import { generateProvisionalPassword } from "@/lib/password";
import bcrypt from "bcryptjs";
import { pullLudoAppAccounts, mapLudoAppRole } from "@/lib/ludoAppSync";
import { sendWelcomeEmail } from "@/lib/actions/organisation";

const PATH = "/organisation/benevoles/ludoapp";

export async function triggerLudoAppPull() {
  await requireOrganisationUser();
  await pullLudoAppAccounts();
  revalidatePath(PATH);
}

// Lie un compte LudoApp déjà existant (import du planning, compte créé
// avant que cette synchro existe...) à un·e bénévole déjà présent·e ici —
// rapprochement manuel, jamais automatique (voir normalizeNameForMatch,
// qui ne fait que suggérer). Le rôle et le statut actif sont alignés tout
// de suite sur LudoApp, sans attendre la prochaine synchro quotidienne.
export async function linkLudoAppAccount(formData: FormData) {
  await requireOrganisationUser();
  const ludoAppId = String(formData.get("ludoAppId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!ludoAppId || !userId) throw new Error("Champs invalides");

  const [compte, user] = await Promise.all([
    prisma.ludoAppAccountCache.findUnique({ where: { id: ludoAppId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);
  if (!compte) throw new Error("Compte LudoApp introuvable (resynchronisez ?)");
  if (!user) throw new Error("Bénévole introuvable");
  if (user.ludoAppUserId) throw new Error("Ce·tte bénévole est déjà lié·e à un autre compte LudoApp");

  await prisma.user.update({
    where: { id: userId },
    data: { ludoAppUserId: ludoAppId, role: mapLudoAppRole(compte.role), active: compte.actif },
  });

  revalidatePath(PATH);
  revalidatePath("/organisation/benevoles");
}

export async function unlinkLudoAppAccount(formData: FormData) {
  await requireOrganisationUser();
  const userId = String(formData.get("userId") ?? "");
  await prisma.user.update({ where: { id: userId }, data: { ludoAppUserId: null } });
  revalidatePath(PATH);
  revalidatePath("/organisation/benevoles");
}

// Crée un·e nouveau·elle bénévole directement à partir d'un compte
// LudoApp non rapproché (personne encore inconnue ici) — mot de passe
// provisoire généré et email de bienvenue envoyé comme pour une création
// normale (voir createVolunteer), si LudoApp a bien un email pour ce
// compte et que l'envoi est configuré.
export async function createVolunteerFromLudoAppAccount(formData: FormData) {
  await requireOrganisationUser();
  const ludoAppId = String(formData.get("ludoAppId") ?? "");

  const compte = await prisma.ludoAppAccountCache.findUnique({ where: { id: ludoAppId } });
  if (!compte) throw new Error("Compte LudoApp introuvable (resynchronisez ?)");

  const existingLink = await prisma.user.findUnique({ where: { ludoAppUserId: ludoAppId } });
  if (existingLink) throw new Error("Ce compte LudoApp est déjà lié à un·e bénévole");

  if (compte.email) {
    const existingEmail = await prisma.user.findUnique({ where: { email: compte.email } });
    if (existingEmail) throw new Error("Un compte existe déjà avec cet email — liez-le plutôt que d'en créer un nouveau");
  }

  const password = compte.email ? generateProvisionalPassword() : null;
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  await prisma.user.create({
    data: {
      name: compte.nom,
      email: compte.email,
      passwordHash,
      role: mapLudoAppRole(compte.role),
      active: compte.actif,
      ludoAppUserId: compte.id,
    },
  });

  if (compte.email && password && mailConfigured()) {
    try {
      await sendWelcomeEmail(compte.nom, compte.email, password);
    } catch (err) {
      console.error("Échec de l'envoi de l'email de bienvenue :", err);
    }
  }

  revalidatePath(PATH);
  revalidatePath("/organisation/benevoles");
}
