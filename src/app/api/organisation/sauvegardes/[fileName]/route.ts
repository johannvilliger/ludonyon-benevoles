import { NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { prisma } from "@/lib/prisma";
import { requireComiteUser } from "@/lib/session";
import { backupFilePath } from "@/lib/backup";

// Réservé au comité (pas juste responsable/comité comme le reste de
// l'Espace organisation) : contient un export complet des tables, hash de
// mots de passe compris. Le nom de fichier doit correspondre à une
// sauvegarde réellement journalisée en base, pas juste un chemin bien
// formé — évite qu'une requête forgée atteigne un autre fichier du
// dossier.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileName: string }> }
) {
  await requireComiteUser();
  const { fileName } = await params;

  const log = await prisma.databaseBackupLog.findFirst({
    where: { fileName, success: true },
  });
  if (!log || !log.fileName) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const filePath = backupFilePath(log.fileName);
  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    return NextResponse.json({ error: "Fichier introuvable (déjà purgé ?)" }, { status: 404 });
  }

  const stream = createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Length": String(stats.size),
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${log.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
