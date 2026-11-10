import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireComiteUser } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import { ludoAppSyncConfigured, mapLudoAppRole, normalizeNameForMatch } from "@/lib/ludoAppSync";
import {
  triggerLudoAppPull,
  linkLudoAppAccount,
  unlinkLudoAppAccount,
  createVolunteerFromLudoAppAccount,
} from "@/lib/actions/ludoAppSync";

const LUDOAPP_ROLE_LABELS: Record<string, string> = {
  retour: "Retours seuls",
  complet: "Location + retour",
  admin: "Administrateur",
};

export default async function LudoAppSyncPage() {
  await requireComiteUser();
  const configured = ludoAppSyncConfigured();

  const [sync, allAccounts, linkedUsers, unlinkedUsers] = await Promise.all([
    prisma.ludoAppSync.findUnique({ where: { id: 1 } }),
    prisma.ludoAppAccountCache.findMany({ orderBy: [{ actif: "desc" }, { nom: "asc" }] }),
    prisma.user.findMany({
      where: { ludoAppUserId: { not: null } },
      select: { id: true, name: true, role: true, active: true, ludoAppUserId: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { ludoAppUserId: null, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const linkedLudoAppIds = new Set(linkedUsers.map((u) => u.ludoAppUserId));
  const unlinkedAccounts = allAccounts.filter((c) => !linkedLudoAppIds.has(c.id));
  const accountsById = new Map(allAccounts.map((c) => [c.id, c]));

  const unlinkedUsersByNormalizedName = new Map<string, { id: string; name: string }>();
  for (const u of unlinkedUsers) {
    unlinkedUsersByNormalizedName.set(normalizeNameForMatch(u.name), u);
  }

  return (
    <div className="space-y-8">
      <Link href="/organisation/benevoles" className="text-sm text-brand-blue hover:underline">
        ← Retour aux bénévoles
      </Link>
      <div>
        <h1 className="text-lg font-medium text-stone-900">
          Synchro des comptes avec LudoApp
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          LudoApp (gestion de la ludothèque) reste la source des comptes et
          de leur niveau d&rsquo;accès. Cette page sert à relier un compte
          LudoApp à un·e bénévole déjà connu·e ici, ou à créer un nouveau
          compte bénévole à partir d&rsquo;un compte LudoApp inconnu — rien
          n&rsquo;est lié automatiquement.
        </p>
      </div>

      {!configured ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Synchro non configurée (<code>LUDOAPP_SYNC_URL</code> et/ou{" "}
          <code>SYNC_BENEVOLES_JETON</code> absentes du <code>.env</code>).
        </p>
      ) : (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-stone-600">
              {sync?.lastSuccessAt ? (
                <p>Dernière synchro réussie : {formatDateTime(sync.lastSuccessAt)}</p>
              ) : (
                <p className="text-stone-400">Aucune synchro réussie pour l&rsquo;instant.</p>
              )}
              {sync?.lastError && sync.lastAttemptAt && (
                <p className="mt-1 text-red-700">
                  Dernier échec le {formatDateTime(sync.lastAttemptAt)} : {sync.lastError}
                </p>
              )}
            </div>
            <form action={triggerLudoAppPull}>
              <button
                type="submit"
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
              >
                Synchroniser maintenant
              </button>
            </form>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium text-stone-900">
          Comptes LudoApp à rapprocher ({unlinkedAccounts.length})
        </h2>
        {unlinkedAccounts.length === 0 ? (
          <p className="mt-2 text-sm text-stone-400">
            Rien à rapprocher pour l&rsquo;instant.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {unlinkedAccounts.map((c) => {
              const suggestion = unlinkedUsersByNormalizedName.get(normalizeNameForMatch(c.nom));
              return (
                <li key={c.id} className="rounded-xl border border-stone-200 bg-white p-4">
                  <p className="font-medium text-stone-900">
                    {c.nom}{" "}
                    {!c.actif && (
                      <span className="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                        désactivé
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-stone-400">
                    {c.identifiant} · {c.email ?? "pas d'email"} ·{" "}
                    {LUDOAPP_ROLE_LABELS[c.role] ?? c.role} (deviendrait{" "}
                    {ROLE_LABELS[mapLudoAppRole(c.role)]} ici)
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <form action={linkLudoAppAccount} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="ludoAppId" value={c.id} />
                      <select
                        name="userId"
                        defaultValue={suggestion?.id ?? ""}
                        className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                      >
                        <option value="" disabled>
                          Choisir un·e bénévole…
                        </option>
                        {unlinkedUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                            {u.id === suggestion?.id ? " (suggestion)" : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100"
                      >
                        Lier
                      </button>
                    </form>

                    <form action={createVolunteerFromLudoAppAccount}>
                      <input type="hidden" name="ludoAppId" value={c.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100"
                      >
                        Créer un nouveau compte bénévole
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium text-stone-900">
          Comptes déjà liés ({linkedUsers.length})
        </h2>
        {linkedUsers.length === 0 ? (
          <p className="mt-2 text-sm text-stone-400">Aucun pour l&rsquo;instant.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {linkedUsers.map((u) => {
              const compte = u.ludoAppUserId ? accountsById.get(u.ludoAppUserId) : undefined;
              return (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>
                    {u.name} — {ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}
                    {!u.active && <span className="text-stone-400"> (désactivé)</span>}
                    {compte && <span className="text-stone-400"> · LudoApp : {compte.identifiant}</span>}
                  </span>
                  <form action={unlinkLudoAppAccount}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button type="submit" className="text-xs text-red-600 hover:underline">
                      Délier
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
