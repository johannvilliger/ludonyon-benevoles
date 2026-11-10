const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const REPLACEMENT_ALERT_HOUR = 19;
const OPENING_REMINDER_HOUR = 19;
const TASK_REMINDER_HOUR = 8;
// Heure creuse, hors des horaires d'ouverture et des rappels du soir.
const BACKUP_HOUR = 3;

// Millisecondes jusqu'à la prochaine occurrence de `hour`:00 heure serveur
// (TZ=Europe/Zurich en production) — aujourd'hui si l'heure n'est pas
// encore passée, sinon demain.
function msUntilNextHour(hour: number): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

// Millisecondes jusqu'au prochain dimanche REPLACEMENT_ALERT_HOUR:00 heure
// serveur (TZ=Europe/Zurich en production) — une seule alerte groupée par
// semaine, pour la semaine suivante.
function msUntilNextSundayAlertHour(): number {
  const now = new Date();
  const daysUntilSunday = (7 - now.getDay()) % 7; // getDay() : dimanche = 0
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + daysUntilSunday,
    REPLACEMENT_ALERT_HOUR,
    0,
    0,
    0
  );
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 7);
  }
  return next.getTime() - now.getTime();
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const globalForReminders = globalThis as unknown as {
    remindersIntervalStarted?: boolean;
  };
  if (globalForReminders.remindersIntervalStarted) return;
  globalForReminders.remindersIntervalStarted = true;

  const {
    checkAndSendEventReminders,
    checkAndSendReplacementProblemAlerts,
    checkAndSendUnfilledShiftAlerts,
    checkAndSendOpeningShiftReminders,
    checkAndSendTaskReminders,
  } = await import("@/lib/reminders");
  const { runDatabaseBackup } = await import("@/lib/backup");

  // Rappels d'événements : vérification fréquente, la fenêtre de rappel
  // (1h avant l'événement) est courte.
  const EVENT_REMINDER_INTERVAL_MS = 5 * 60 * 1000;
  setInterval(() => {
    checkAndSendEventReminders().catch((err) => {
      console.error("Erreur lors de l'envoi des rappels d'événements :", err);
    });
  }, EVENT_REMINDER_INTERVAL_MS);

  // Alerte créneaux à risque + créneaux non pourvus : une seule
  // vérification groupée par semaine, le dimanche à 19h, pour la semaine
  // suivante — pas de notification à chaque créneau signalé.
  setTimeout(() => {
    checkAndSendReplacementProblemAlerts().catch((err) => {
      console.error("Erreur lors de l'envoi des alertes créneaux à risque :", err);
    });
    checkAndSendUnfilledShiftAlerts().catch((err) => {
      console.error("Erreur lors de l'envoi des alertes créneaux non pourvus :", err);
    });
    setInterval(() => {
      checkAndSendReplacementProblemAlerts().catch((err) => {
        console.error("Erreur lors de l'envoi des alertes créneaux à risque :", err);
      });
      checkAndSendUnfilledShiftAlerts().catch((err) => {
        console.error("Erreur lors de l'envoi des alertes créneaux non pourvus :", err);
      });
    }, WEEK_MS);
  }, msUntilNextSundayAlertHour());

  // Rappel individuel d'ouverture : une vérification par jour, à 19h, pour
  // les créneaux du lendemain.
  setTimeout(() => {
    checkAndSendOpeningShiftReminders().catch((err) => {
      console.error("Erreur lors de l'envoi des rappels d'ouverture :", err);
    });
    setInterval(() => {
      checkAndSendOpeningShiftReminders().catch((err) => {
        console.error("Erreur lors de l'envoi des rappels d'ouverture :", err);
      });
    }, DAY_MS);
  }, msUntilNextHour(OPENING_REMINDER_HOUR));

  // Rappel individuel de tâche : une vérification par jour, à 8h, pour les
  // tâches dont le rappel (jours avant échéance) est atteint.
  setTimeout(() => {
    checkAndSendTaskReminders().catch((err) => {
      console.error("Erreur lors de l'envoi des rappels de tâches :", err);
    });
    setInterval(() => {
      checkAndSendTaskReminders().catch((err) => {
        console.error("Erreur lors de l'envoi des rappels de tâches :", err);
      });
    }, DAY_MS);
  }, msUntilNextHour(TASK_REMINDER_HOUR));

  // Sauvegarde de la base : une fois par jour, à 3h du matin — voir
  // src/lib/backup.ts (journalisée dans DatabaseBackupLog, consultable
  // dans Espace organisation > Paramètres).
  setTimeout(() => {
    runDatabaseBackup().catch((err) => {
      console.error("Erreur lors de la sauvegarde de la base :", err);
    });
    setInterval(() => {
      runDatabaseBackup().catch((err) => {
        console.error("Erreur lors de la sauvegarde de la base :", err);
      });
    }, DAY_MS);
  }, msUntilNextHour(BACKUP_HOUR));
}
