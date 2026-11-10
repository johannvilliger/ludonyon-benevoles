import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDuration } from "@/lib/format";

export default async function AttestationPage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string }>;
}) {
  const authUser = await requireUser();
  const { annee } = await searchParams;
  const year = annee && /^\d{4}$/.test(annee) ? annee : String(new Date().getFullYear());

  const user = await prisma.user.findUniqueOrThrow({ where: { id: authUser.id } });
  const hours = user.ludoAppUserId
    ? await prisma.ludoAppHoursCache.findUnique({ where: { userId: authUser.id } })
    : null;
  const anneeData = (
    hours?.parAnnee as
      | Record<string, { totalMinutes: number; parActivite: { nom: string; minutes: number }[] }>
      | null
  )?.[year];

  if (!hours || !anneeData) {
    const autresAnnees = Object.keys(
      (hours?.parAnnee as Record<string, unknown> | undefined) ?? {}
    ).sort((a, b) => Number(b) - Number(a));
    return (
      <div className="max-w-md">
        <Link href="/profil" className="text-sm text-brand-blue hover:underline">
          ← Retour à mon profil
        </Link>
        <p className="mt-4 text-sm text-stone-500">
          Aucune heure enregistrée dans LudoApp pour {year}
          {!user.ludoAppUserId && " (compte non lié à LudoApp)"}.
        </p>
        {autresAnnees.length > 0 && (
          <p className="mt-2 text-sm text-stone-500">
            Années disponibles :{" "}
            {autresAnnees.map((a, i) => (
              <span key={a}>
                {i > 0 && ", "}
                <Link href={`/profil/attestation?annee=${a}`} className="text-brand-blue hover:underline">
                  {a}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/profil" className="text-sm text-brand-blue hover:underline">
          ← Retour à mon profil
        </Link>
        <a
          href={`/api/profil/attestation?annee=${year}`}
          className="rounded-lg border-2 border-black bg-brand-yellow px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand-yellow-dark"
        >
          📄 Télécharger l&rsquo;attestation (PDF)
        </a>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-8">
        <div className="border-b border-stone-200 pb-4">
          {/* Logo = bandeau large (icône + texte intégré), pas une icône
              carrée : le forcer dans une case carrée l'écrasait. */}
          <Image
            src="/logo-ludotheque.png"
            alt="Ludothèque Nyon Région"
            width={240}
            height={67}
            className="h-auto w-48"
          />
          <p className="mt-2 text-sm text-stone-500">Attestation de bénévolat {year}</p>
        </div>

        <p className="mt-6 text-stone-700">
          Aperçu — <strong>{user.name}</strong> a consacré{" "}
          <strong>{formatDuration(anneeData.totalMinutes)}</strong> de son temps comme
          bénévole à la Ludothèque Nyon Région durant l&rsquo;année {year}. Le bouton ci-dessus
          génère le vrai document PDF (lettre datée, à remettre tel quel).
        </p>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className="py-1.5 font-medium">Activité</th>
              <th className="py-1.5 text-right font-medium">Heures</th>
            </tr>
          </thead>
          <tbody>
            {anneeData.parActivite.map((a) => (
              <tr key={a.nom} className="border-b border-stone-100">
                <td className="py-1.5 text-stone-700">{a.nom}</td>
                <td className="py-1.5 text-right text-stone-700">{formatDuration(a.minutes)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-2 font-medium text-stone-900">Total</td>
              <td className="pt-2 text-right font-medium text-stone-900">
                {formatDuration(anneeData.totalMinutes)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
