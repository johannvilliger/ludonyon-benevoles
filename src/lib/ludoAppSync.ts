import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/roles";

// Synchro des comptes avec LudoApp (gestion de la ludothèque, repo séparé
// johannvilliger/ludoapp) : LudoApp reste la source de vérité pour la
// création d'un compte et son niveau d'accès ; cette app vient y lire
// périodiquement la liste (GET /api/sync/comptes, jeton partagé) et la
// garde en cache localement (LudoAppAccountCache) — jamais vidée en cas
// d'échec, pour continuer à fonctionner si LudoApp est temporairement
// injoignable. LUDOAPP_SYNC_URL et SYNC_BENEVOLES_JETON dans .env (voir
// .env.example) ; tant qu'elles sont absentes, la synchro est simplement
// désactivée.

// Groupes de droits LudoApp (groupes_utilisateurs, configurables côté
// LudoApp — voir db/migrations/0057_groupes_permissions.sql) mappés sur
// les rôles Ludonyon. Basé sur les 5 groupes de départ ; un groupe renommé
// ou un nouveau groupe créé côté LudoApp qui ne figure pas ici retombe sur
// BENEVOLE par défaut (jamais une élévation silencieuse).
const GROUPE_MAP: Record<string, Role> = {
  "Bénévole accueil": "BENEVOLE",
  "Bénévole poste retour": "BENEVOLE",
  Responsable: "RESPONSABLE",
  Comité: "COMITE",
  Administrateur: "COMITE",
};

export function mapLudoAppGroupe(groupe: string): Role {
  return GROUPE_MAP[groupe] ?? "BENEVOLE";
}

export function ludoAppSyncConfigured(): boolean {
  return !!(process.env.LUDOAPP_SYNC_URL && process.env.SYNC_BENEVOLES_JETON);
}

type LudoAppCompte = {
  id: string;
  identifiant: string;
  nom: string;
  email: string | null;
  groupe: string;
  actif: boolean;
};

function syncUrl(path: string): string {
  return `${(process.env.LUDOAPP_SYNC_URL ?? "").replace(/\/+$/, "")}${path}`;
}

function syncHeaders(): HeadersInit {
  return { "X-Jeton": process.env.SYNC_BENEVOLES_JETON ?? "" };
}

// Appelée une seule fois par l'app bénévoles, à la création d'un·e
// bénévole "fantôme" (sans email, juste pour le planning) — crée côté
// LudoApp un compte technique désactivé, pour avoir un id stable à relier
// dès maintenant (voir createVolunteer dans actions/organisation.ts).
// Best-effort : un échec n'empêche jamais la création du/de la bénévole
// ici, juste pas de lien LudoApp pour l'instant.
export async function createLudoAppTechnicalAccount(nom: string): Promise<string | null> {
  if (!ludoAppSyncConfigured()) return null;
  try {
    const res = await fetch(syncUrl("/api/sync/comptes-techniques"), {
      method: "POST",
      headers: { ...syncHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ nom }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch (err) {
    console.error("Échec de la création du compte technique LudoApp :", err);
    return null;
  }
}

// Tirée une fois par jour (voir instrumentation.ts) et déclenchable à la
// main depuis Espace organisation > Bénévoles > LudoApp. Met à jour le
// cache local, puis resynchronise rôle et statut actif de chaque compte
// déjà lié (voir User.ludoAppUserId) — jamais le nom ni l'email d'un
// compte déjà lié, pour ne pas écraser silencieusement une correction
// faite ici (voir updateVolunteerContactInfo).
export async function pullLudoAppAccounts(): Promise<void> {
  if (!ludoAppSyncConfigured()) return;
  const now = new Date();

  let comptes: LudoAppCompte[];
  try {
    const res = await fetch(syncUrl("/api/sync/comptes"), {
      headers: syncHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Réponse ${res.status} de LudoApp`);
    const data = (await res.json()) as { comptes: LudoAppCompte[] };
    comptes = data.comptes;
  } catch (err) {
    await prisma.ludoAppSync.upsert({
      where: { id: 1 },
      create: { id: 1, lastAttemptAt: now, lastError: String(err) },
      update: { lastAttemptAt: now, lastError: String(err) },
    });
    return;
  }

  await Promise.all(
    comptes.map((c) =>
      prisma.ludoAppAccountCache.upsert({
        where: { id: c.id },
        create: { ...c, fetchedAt: now },
        update: { ...c, fetchedAt: now },
      })
    )
  );

  const linkedUsers = await prisma.user.findMany({
    where: { ludoAppUserId: { not: null } },
    select: { id: true, ludoAppUserId: true, role: true, active: true },
  });
  const comptesById = new Map(comptes.map((c) => [c.id, c]));
  await Promise.all(
    linkedUsers.map((u) => {
      const compte = u.ludoAppUserId ? comptesById.get(u.ludoAppUserId) : undefined;
      if (!compte) return Promise.resolve();
      const mappedRole = mapLudoAppGroupe(compte.groupe);
      if (mappedRole === u.role && compte.actif === u.active) return Promise.resolve();
      return prisma.user.update({
        where: { id: u.id },
        data: { role: mappedRole, active: compte.actif },
      });
    })
  );

  await pullLudoAppHours(linkedUsers.map((u) => u.id));

  await prisma.ludoAppSync.upsert({
    where: { id: 1 },
    create: { id: 1, lastSuccessAt: now, lastAttemptAt: now, lastError: null },
    update: { lastSuccessAt: now, lastAttemptAt: now, lastError: null },
  });
}

type LudoAppHeures = {
  totalMinutes: number;
  parAnnee: Record<string, { totalMinutes: number; parActivite: { nom: string; minutes: number }[] }>;
};

// Une requête par bénévole lié — sans conséquence à l'échelle d'une
// association (quelques dizaines de comptes), appelée une fois par jour.
// Un échec sur une personne ne bloque pas les autres ; le cache garde
// simplement sa dernière valeur connue pour celle-ci.
export async function pullLudoAppHours(userIds: string[]): Promise<void> {
  const linkedUsers = await prisma.user.findMany({
    where: { id: { in: userIds }, ludoAppUserId: { not: null } },
    select: { id: true, ludoAppUserId: true },
  });

  await Promise.all(
    linkedUsers.map(async (u) => {
      try {
        const res = await fetch(
          syncUrl(`/api/sync/heures?utilisateurId=${encodeURIComponent(u.ludoAppUserId!)}`),
          { headers: syncHeaders(), cache: "no-store", signal: AbortSignal.timeout(10000) }
        );
        if (!res.ok) return;
        const heures = (await res.json()) as LudoAppHeures;
        // Number() explicite : LudoApp a déjà renvoyé des totaux en
        // chaîne par le passé (SUM() mysql2), ce qui fait planter l'écriture
        // Prisma (colonne Int) sans ce filet.
        const totalMinutes = Number(heures.totalMinutes) || 0;
        await prisma.ludoAppHoursCache.upsert({
          where: { userId: u.id },
          create: { userId: u.id, totalMinutes, parAnnee: heures.parAnnee },
          update: { totalMinutes, parAnnee: heures.parAnnee, fetchedAt: new Date() },
        });
      } catch (err) {
        console.error(`Échec de la récupération des heures LudoApp pour ${u.id} :`, err);
      }
    })
  );
}

// "Marie-Line Dupont" -> "marielinedupont", pour une suggestion de
// rapprochement approximative (voir la page LudoApp d'Espace organisation
// > Bénévoles) — jamais utilisée pour lier automatiquement, juste pour
// présélectionner une suggestion qu'un humain valide.
export function normalizeNameForMatch(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "");
}
