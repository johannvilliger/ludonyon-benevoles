import { prisma } from "@/lib/prisma";
import { requireOrganisationUser } from "@/lib/session";
import { mailConfigured } from "@/lib/mail";
import { guideExists } from "@/lib/guideStorage";
import { formatDateTime } from "@/lib/format";
import {
  uploadGuide,
  removeGuide,
  getLaunchEmailRecipients,
  sendLaunchEmails,
  triggerManualBackup,
} from "@/lib/actions/organisation";

export default async function OrganisationParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ lancement?: string; echecs?: string }>;
}) {
  const user = await requireOrganisationUser();
  const isComite = user.role === "COMITE";
  const hasGuide = await guideExists();
  const { lancement, echecs } = await searchParams;
  const [recipients, recentBackups] = await Promise.all([
    getLaunchEmailRecipients(),
    isComite
      ? prisma.databaseBackupLog.findMany({ orderBy: { startedAt: "desc" }, take: 10 })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-8">
      {lancement !== undefined && (
        <section
          className={`rounded-lg px-3 py-2 text-sm ${
            echecs && echecs !== "0"
              ? "bg-amber-50 text-amber-800"
              : "bg-green-50 text-green-700"
          }`}
        >
          Envoyé à {lancement} personne{lancement === "1" ? "" : "s"}.
          {!!echecs && echecs !== "0" && (
            <> {echecs} échec{echecs === "1" ? "" : "s"} d&rsquo;envoi (voir les logs du serveur) — mot de passe déjà changé pour ces comptes, à communiquer manuellement via &laquo;&nbsp;Réinitialiser le mot de passe&nbsp;&raquo; (Espace organisation &gt; Bénévoles).</>
          )}
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium text-stone-900">
          Email de bienvenue
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          À la création d&rsquo;un compte bénévole, un email avec
          l&rsquo;adresse du site, l&rsquo;identifiant et le mot de passe
          provisoire est envoyé automatiquement à la personne.
        </p>
        {mailConfigured() ? (
          <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            Serveur d&rsquo;envoi configuré : les emails partent
            automatiquement.
          </p>
        ) : (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Aucun serveur d&rsquo;envoi configuré (variables SMTP_* absentes
            du <code>.env</code>) : communiquez les identifiants
            manuellement pour l&rsquo;instant.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium text-stone-900">
          Mode d&rsquo;emploi
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          PDF joint automatiquement à l&rsquo;email de bienvenue, s&rsquo;il
          est présent.
        </p>
        <div className="mt-3 rounded-xl border border-stone-200 bg-white p-4">
          {hasGuide ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-stone-700">
                Un mode d&rsquo;emploi est actuellement en ligne.
              </p>
              <form action={removeGuide}>
                <button
                  type="submit"
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                >
                  Supprimer
                </button>
              </form>
            </div>
          ) : (
            <p className="text-sm text-stone-400">
              Aucun mode d&rsquo;emploi en ligne pour l&rsquo;instant.
            </p>
          )}
          <form
            action={uploadGuide}
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <input
              type="file"
              name="guide"
              accept="application/pdf"
              required
              className="text-sm"
            />
            <button
              type="submit"
              className="rounded-lg border-2 border-black bg-brand-yellow px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-brand-yellow-dark"
            >
              {hasGuide ? "Remplacer" : "Mettre en ligne"}
            </button>
          </form>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium text-stone-900">
          Envoi de lancement
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Réinitialise le mot de passe de tous les comptes actifs ayant un
          email, et envoie à chacun·e un nouveau mot de passe provisoire
          avec un résumé du fonctionnement et les instructions
          d&rsquo;installation sur téléphone.{" "}
          <strong>
            Écrase aussi le mot de passe de quiconque s&rsquo;est déjà
            connecté·e et l&rsquo;a changé
          </strong>{" "}
          — à n&rsquo;utiliser qu&rsquo;une fois, pour le vrai lancement.
        </p>

        {!mailConfigured() ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Aucun serveur d&rsquo;envoi configuré : impossible d&rsquo;envoyer
            tant que les variables SMTP_* ne sont pas renseignées.
          </p>
        ) : (
          <div className="mt-3 rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-700">
              {recipients.length} compte{recipients.length > 1 ? "s" : ""}{" "}
              recevront ce nouveau mot de passe :
            </p>
            {recipients.length === 0 ? (
              <p className="mt-2 text-sm text-stone-400">
                Aucun compte actif avec un email pour l&rsquo;instant.
              </p>
            ) : (
              <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-stone-50 p-2 text-sm text-stone-600">
                {recipients.map((r) => (
                  <li key={r.id}>
                    {r.name} — {r.email}
                  </li>
                ))}
              </ul>
            )}

            <form action={sendLaunchEmails} className="mt-4">
              <label className="flex items-start gap-2 text-sm text-stone-700">
                <input type="checkbox" name="confirm" value="1" required className="mt-0.5" />
                Je confirme avoir vérifié cette liste et je veux envoyer un
                nouveau mot de passe à tout le monde maintenant.
              </label>
              <button
                type="submit"
                disabled={recipients.length === 0}
                className="mt-3 rounded-lg border-2 border-black bg-brand-yellow px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand-yellow-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                Envoyer à {recipients.length} personne{recipients.length > 1 ? "s" : ""}
              </button>
            </form>
          </div>
        )}
      </section>

      {isComite && (
        <section>
          <h2 className="text-lg font-medium text-stone-900">Sauvegardes</h2>
          <p className="mt-1 text-sm text-stone-500">
            Export complet de la base chaque nuit à 3h, conservé 14 jours.
            Réservé au comité : contient les mots de passe (hachés) de tous
            les comptes.
          </p>
          <div className="mt-3 rounded-xl border border-stone-200 bg-white p-4">
            <form action={triggerManualBackup}>
              <button
                type="submit"
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
              >
                Lancer une sauvegarde maintenant
              </button>
            </form>
            {recentBackups.length === 0 ? (
              <p className="mt-3 text-sm text-stone-400">
                Aucune sauvegarde pour l&rsquo;instant.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-stone-100 text-sm">
                {recentBackups.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className={b.success ? "text-stone-700" : "text-red-700"}>
                      {formatDateTime(b.startedAt)}
                      {b.success
                        ? ` — ${((b.fileSizeBytes ?? 0) / 1024).toFixed(0)} Ko`
                        : ` — échec (${b.errorMessage ?? "erreur inconnue"})`}
                    </span>
                    {b.success && b.fileName && (
                      <a
                        href={`/api/organisation/sauvegardes/${b.fileName}`}
                        className="text-brand-blue hover:underline"
                      >
                        Télécharger
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
