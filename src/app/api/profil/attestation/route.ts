import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { renderAttestationPdf } from "@/lib/attestationPdf";

export const dynamic = "force-dynamic";

const GENERE_LE_FORMATTER = new Intl.DateTimeFormat("fr-CH", {
  timeZone: "Europe/Zurich",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Génère un vrai PDF (pas une impression de la page web) pour l'attestation
// de bénévolat — toujours la propre attestation de la personne connectée,
// jamais celle de quelqu'un d'autre (pas de paramètre utilisateur).
export async function GET(request: Request) {
  const authUser = await requireUser();
  const annee = new URL(request.url).searchParams.get("annee");
  if (!annee || !/^\d{4}$/.test(annee)) {
    return NextResponse.json({ error: "Paramètre annee invalide" }, { status: 400 });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: authUser.id } });
  const hours = user.ludoAppUserId
    ? await prisma.ludoAppHoursCache.findUnique({ where: { userId: authUser.id } })
    : null;
  const anneeData = (
    hours?.parAnnee as
      | Record<string, { totalMinutes: number; parActivite: { nom: string; minutes: number }[] }>
      | null
  )?.[annee];

  if (!anneeData) {
    return NextResponse.json({ error: "Aucune heure enregistrée pour cette année" }, { status: 404 });
  }

  const pdf = await renderAttestationPdf({
    nom: user.name,
    annee,
    totalMinutes: anneeData.totalMinutes,
    parActivite: anneeData.parActivite,
    genereLe: GENERE_LE_FORMATTER.format(new Date()),
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="attestation-benevolat-${annee}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
