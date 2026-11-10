import { mkdir, readdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

// Hors dépôt Git et hors public/ (comme les enregistrements de séance) :
// un export complet des tables contient les hash de mots de passe, jamais
// atteignable par une URL statique — voir api/organisation/sauvegardes,
// qui vérifie le rôle comité avant de streamer un fichier.
const STORAGE_DIR = path.join(process.cwd(), "storage", "backups");

// Conservées 14 jours (une sauvegarde par jour, voir instrumentation.ts) :
// assez pour revenir en arrière sur un problème découvert tardivement,
// sans accumuler indéfiniment sur un hébergement à l'espace disque limité.
const RETENTION_DAYS = 14;

// Liste explicite plutôt qu'une introspection dynamique du client Prisma :
// moins "magique", et surtout volontairement visible — à compléter à la
// main si un nouveau modèle est ajouté au schéma (voir prisma/schema.prisma).
async function dumpAllTables() {
  const [
    users,
    groups,
    groupMemberships,
    volunteerAvailabilities,
    pushNotificationLogs,
    pushSubscriptions,
    vacations,
    announcements,
    events,
    eventTemplates,
    eventTaskTemplates,
    eventSignups,
    tasks,
    taskAssignees,
    openingShifts,
    autoScheduleOverrides,
    planningClosures,
    openingShiftAssignees,
    attendanceSessions,
    comiteItemCategories,
    comiteItems,
    comiteItemDeclines,
    comiteItemNotes,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.group.findMany(),
    prisma.groupMembership.findMany(),
    prisma.volunteerAvailability.findMany(),
    prisma.pushNotificationLog.findMany(),
    prisma.pushSubscription.findMany(),
    prisma.vacation.findMany(),
    prisma.announcement.findMany(),
    prisma.event.findMany(),
    prisma.eventTemplate.findMany(),
    prisma.eventTaskTemplate.findMany(),
    prisma.eventSignup.findMany(),
    prisma.task.findMany(),
    prisma.taskAssignee.findMany(),
    prisma.openingShift.findMany(),
    prisma.autoScheduleOverride.findMany(),
    prisma.planningClosure.findMany(),
    prisma.openingShiftAssignee.findMany(),
    prisma.attendanceSession.findMany(),
    prisma.comiteItemCategory.findMany(),
    prisma.comiteItem.findMany(),
    prisma.comiteItemDecline.findMany(),
    prisma.comiteItemNote.findMany(),
  ]);

  return {
    User: users,
    Group: groups,
    GroupMembership: groupMemberships,
    VolunteerAvailability: volunteerAvailabilities,
    PushNotificationLog: pushNotificationLogs,
    PushSubscription: pushSubscriptions,
    Vacation: vacations,
    Announcement: announcements,
    Event: events,
    EventTemplate: eventTemplates,
    EventTaskTemplate: eventTaskTemplates,
    EventSignup: eventSignups,
    Task: tasks,
    TaskAssignee: taskAssignees,
    OpeningShift: openingShifts,
    AutoScheduleOverride: autoScheduleOverrides,
    PlanningClosure: planningClosures,
    OpeningShiftAssignee: openingShiftAssignees,
    AttendanceSession: attendanceSessions,
    ComiteItemCategory: comiteItemCategories,
    ComiteItem: comiteItems,
    ComiteItemDecline: comiteItemDeclines,
    ComiteItemNote: comiteItemNotes,
  };
}

async function pruneOldBackups(): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let files: string[];
  try {
    files = await readdir(STORAGE_DIR);
  } catch {
    return;
  }
  for (const file of files) {
    const filePath = path.join(STORAGE_DIR, file);
    const info = await stat(filePath).catch(() => null);
    if (info && info.mtimeMs < cutoff) {
      await unlink(filePath).catch(() => {});
    }
  }
}

// Exécutée une fois par jour (voir instrumentation.ts) et déclenchable à
// la main depuis Espace organisation > Paramètres. N'échoue jamais bruyamment
// : la tentative (réussie ou non) est toujours journalisée dans
// DatabaseBackupLog, consultable sur cette même page.
export async function runDatabaseBackup(): Promise<void> {
  const startedAt = new Date();

  try {
    const tables = await dumpAllTables();
    const fileName = `sauvegarde-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`;

    await mkdir(STORAGE_DIR, { recursive: true });
    const content = JSON.stringify({ exportedAt: startedAt.toISOString(), tables }, null, 0);
    await writeFile(path.join(STORAGE_DIR, fileName), content, "utf-8");

    await prisma.databaseBackupLog.create({
      data: {
        startedAt,
        finishedAt: new Date(),
        success: true,
        fileName,
        fileSizeBytes: Buffer.byteLength(content, "utf-8"),
      },
    });

    await pruneOldBackups();
  } catch (err) {
    await prisma.databaseBackupLog
      .create({
        data: {
          startedAt,
          finishedAt: new Date(),
          success: false,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => {
        // La base elle-même est peut-être injoignable : rien de plus à
        // faire ici, l'erreur reste dans les logs serveur.
      });
  }
}

export function backupFilePath(fileName: string): string {
  return path.join(STORAGE_DIR, fileName);
}
