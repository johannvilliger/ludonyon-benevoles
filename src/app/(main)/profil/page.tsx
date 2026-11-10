import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { formatEventDate, formatDateOnly, formatDuration } from "@/lib/format";
import Avatar from "@/components/Avatar";
import { toggleOpeningReminders, updateMyAvailability, updateMyFrequencies } from "@/lib/actions/profile";
import {
  OPENING_FREQUENCIES,
  OPENING_FREQUENCY_LABELS,
  ANIM_FREQUENCIES,
  ANIM_FREQUENCY_LABELS,
  type OpeningFrequency,
  type AnimFrequency,
} from "@/lib/frequencies";
import { toggleTaskDone, sendGroupNotification } from "@/lib/actions/organisation";
import ChangePasswordForm from "./ChangePasswordForm";
import PhotoForm from "./PhotoForm";
import VacationsForm from "./VacationsForm";
import CalendarSubscribeLink from "./CalendarSubscribeLink";
import PushNotificationsToggle from "./PushNotificationsToggle";
import AvailabilityForm from "@/components/AvailabilityForm";
import SaveButton from "@/components/SaveButton";

export default async function ProfilPage() {
  const authUser = await requireUser();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: authUser.id },
  });
  const ludoAppHours = user.ludoAppUserId
    ? await prisma.ludoAppHoursCache.findUnique({ where: { userId: authUser.id } })
    : null;
  const currentYear = String(new Date().getFullYear());
  const currentYearMinutes =
    (ludoAppHours?.parAnnee as Record<string, { totalMinutes: number }> | null)?.[currentYear]
      ?.totalMinutes ?? 0;

  const vacations = await prisma.vacation.findMany({
    where: { userId: authUser.id },
    orderBy: { startDate: "asc" },
  });
  const upcomingSignups = await prisma.eventSignup.findMany({
    where: { userId: authUser.id, event: { startsAt: { gte: new Date() } } },
    include: { event: true },
    orderBy: { event: { startsAt: "asc" } },
  });
  const myTasks = await prisma.taskAssignee.findMany({
    where: { userId: authUser.id },
    include: { task: { include: { event: { select: { title: true } } } } },
    orderBy: { task: { dueDate: "asc" } },
  });
  const myAvailability = await prisma.volunteerAvailability.findMany({
    where: { userId: authUser.id },
    select: { slotKey: true },
  });
  const myGroups = await prisma.groupMembership.findMany({
    where: { userId: authUser.id },
    include: { group: { select: { id: true, name: true } } },
    orderBy: { group: { name: "asc" } },
  });

  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const calendarUrl = `${protocol}://${host}/api/calendrier/${user.calendarToken}`;

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold text-stone-900">Mon profil</h1>

      <div className="mt-6 flex items-center gap-4 rounded-xl border border-stone-200 bg-white p-4">
        <Avatar name={user.name} photoPath={user.photoPath} size={56} />
        <div>
          <p className="font-medium text-stone-900">{user.name}</p>
          <p className="text-sm text-stone-600">{user.email}</p>
          <p className="mt-1 text-xs text-stone-400">
            Rôle : {ROLE_LABELS[user.role as Role] ?? user.role}
          </p>
        </div>
      </div>

      {ludoAppHours && (
        <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-500">Heures de bénévolat {currentYear}</p>
          <p className="mt-1 text-2xl font-semibold text-stone-900">
            {formatDuration(currentYearMinutes)}
          </p>
          <p className="mt-1 text-xs text-stone-400">
            Enregistrées dans LudoApp (permanences, animations, entretien
            des jeux...).
          </p>
          <Link
            href={`/profil/attestation?annee=${currentYear}`}
            className="mt-2 inline-block text-sm text-brand-blue hover:underline"
          >
            Voir mon attestation {currentYear} →
          </Link>
        </div>
      )}

      <h2 className="mt-8 text-lg font-medium text-stone-900">
        Mes prochains événements
      </h2>
      {upcomingSignups.length === 0 ? (
        <p className="mt-2 text-sm text-stone-400">
          Aucune inscription à venir.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {upcomingSignups.map(({ event }) => (
            <li
              key={event.id}
              className="rounded-xl border border-stone-200 bg-white p-3 text-sm"
            >
              <p className="font-medium text-stone-900">{event.title}</p>
              <p className="text-stone-500">
                {formatEventDate(event.startsAt, event.endsAt)}
                {event.location ? ` · ${event.location}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-lg font-medium text-stone-900">Mes tâches</h2>
      {myTasks.length === 0 ? (
        <p className="mt-2 text-sm text-stone-400">
          Aucune tâche assignée pour l’instant.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {myTasks.map(({ task }) => (
            <li
              key={task.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm"
            >
              <div>
                <p
                  className={
                    task.done
                      ? "font-medium text-stone-400 line-through"
                      : "font-medium text-stone-900"
                  }
                >
                  {task.title}
                </p>
                <p className="text-xs text-stone-500">
                  {task.event.title} · échéance {formatDateOnly(task.dueDate)}
                </p>
              </div>
              <form action={toggleTaskDone}>
                <input type="hidden" name="id" value={task.id} />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
                >
                  {task.done ? "À faire" : "Fait"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-lg font-medium text-stone-900">Ma photo</h2>
      <PhotoForm hasPhoto={!!user.photoPath} />

      <h2 className="mt-8 text-lg font-medium text-stone-900">
        Mon calendrier
      </h2>
      <CalendarSubscribeLink url={calendarUrl} />

      <h2 className="mt-8 text-lg font-medium text-stone-900">
        Notifications
      </h2>
      <PushNotificationsToggle />

      {myGroups.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-medium text-stone-900">
            Notifier mon groupe ({myGroups.map((m) => m.group.name).join(", ")})
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Envoie une notification et une annonce visibles uniquement par
            les membres du groupe choisi.
          </p>
          <form
            action={sendGroupNotification}
            className="mt-3 space-y-3 rounded-xl border border-stone-200 bg-white p-4"
          >
            {myGroups.length > 1 && (
              <div>
                <label className="mb-1 block text-sm font-medium text-stone-700">
                  Groupe
                </label>
                <select
                  name="groupId"
                  required
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                >
                  {myGroups.map((m) => (
                    <option key={m.group.id} value={m.group.id}>
                      {m.group.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {myGroups.length === 1 && (
              <input type="hidden" name="groupId" value={myGroups[0].group.id} />
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">
                Titre
              </label>
              <input
                type="text"
                name="title"
                required
                maxLength={100}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">
                Message
              </label>
              <textarea
                name="body"
                required
                rows={3}
                maxLength={500}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              />
            </div>
            <SaveButton className="rounded-lg border-2 border-black bg-brand-yellow px-4 py-2 text-sm font-semibold text-black hover:bg-brand-yellow-dark disabled:opacity-60">
              Envoyer
            </SaveButton>
          </form>
        </>
      )}

      <h2 className="mt-8 text-lg font-medium text-stone-900">
        Rappels pour les ouvertures
      </h2>
      <form
        action={toggleOpeningReminders}
        className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4"
      >
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            key={String(user.wantsOpeningReminders)}
            type="checkbox"
            name="wantsOpeningReminders"
            defaultChecked={user.wantsOpeningReminders}
            className="h-4 w-4 rounded border-stone-300 text-brand-blue focus:ring-brand-blue"
          />
          Je veux être notifié·e avant mes créneaux d’ouverture
        </label>
        <SaveButton className="shrink-0 rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-60" />
      </form>

      {user.unavailableForOpenings ? (
        <>
          <h2 className="mt-8 text-lg font-medium text-stone-900">
            Disponibilités pour le planning des ouvertures
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Vous êtes actuellement marqué·e « Pas d&rsquo;ouvertures » par un·e
            responsable : vous n&rsquo;apparaissez pas dans le planning des
            ouvertures. Seule votre disponibilité aux animations ci-dessous
            reste pertinente.
          </p>
        </>
      ) : (
        <>
          <h2 className="mt-8 text-lg font-medium text-stone-900">
            Mes disponibilités pour le planning des ouvertures
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Utilisées pour vous proposer comme remplaçant·e quand un·e autre
            bénévole signale un empêchement sur l&rsquo;un de ces créneaux.
          </p>
          <div className="mt-3 rounded-xl border border-stone-200 bg-white p-4">
            <AvailabilityForm
              action={updateMyAvailability}
              selectedKeys={myAvailability.map((a) => a.slotKey)}
            />
          </div>

          <h3 className="mt-4 text-sm font-medium text-stone-700">
            Ma fréquence de disponibilité
          </h3>
          <form
            key={user.openingFrequency ?? "none"}
            action={updateMyFrequencies}
            className="mt-2 flex items-center gap-2"
          >
            <input type="hidden" name="animWeekendFrequency" value={user.animWeekendFrequency ?? ""} />
            <input type="hidden" name="animWeekFrequency" value={user.animWeekFrequency ?? ""} />
            <select
              name="openingFrequency"
              defaultValue={user.openingFrequency ?? ""}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            >
              <option value="">Non renseignée</option>
              {OPENING_FREQUENCIES.map((freq) => (
                <option key={freq} value={freq}>
                  {OPENING_FREQUENCY_LABELS[freq as OpeningFrequency]}
                </option>
              ))}
            </select>
            <SaveButton className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-60" />
          </form>
        </>
      )}

      <h2 className="mt-8 text-lg font-medium text-stone-900">
        Ma disponibilité pour les animations
      </h2>
      <p className="mt-1 text-sm text-stone-500">
        Purement indicatif, pour aider à l&rsquo;organisation des animations.
      </p>
      <form
        key={`${user.animWeekendFrequency ?? "none"}-${user.animWeekFrequency ?? "none"}`}
        action={updateMyFrequencies}
        className="mt-2 space-y-2"
      >
        <input type="hidden" name="openingFrequency" value={user.openingFrequency ?? ""} />
        <div className="flex items-center gap-2">
          <label htmlFor="animWeekendFrequency" className="w-32 text-sm text-stone-700">
            Weekend
          </label>
          <select
            id="animWeekendFrequency"
            name="animWeekendFrequency"
            defaultValue={user.animWeekendFrequency ?? ""}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          >
            <option value="">Non renseignée</option>
            {ANIM_FREQUENCIES.map((freq) => (
              <option key={freq} value={freq}>
                {ANIM_FREQUENCY_LABELS[freq as AnimFrequency]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="animWeekFrequency" className="w-32 text-sm text-stone-700">
            Semaine
          </label>
          <select
            id="animWeekFrequency"
            name="animWeekFrequency"
            defaultValue={user.animWeekFrequency ?? ""}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          >
            <option value="">Non renseignée</option>
            {ANIM_FREQUENCIES.map((freq) => (
              <option key={freq} value={freq}>
                {ANIM_FREQUENCY_LABELS[freq as AnimFrequency]}
              </option>
            ))}
          </select>
        </div>
        <SaveButton className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-60" />
      </form>

      <h2 className="mt-8 text-lg font-medium text-stone-900">
        Mes indisponibilités / vacances
      </h2>
      <p className="mt-1 text-sm text-stone-500">
        Visibles par les responsables et le comité.
      </p>
      <VacationsForm vacations={vacations} />

      <h2 className="mt-8 text-lg font-medium text-stone-900">
        Changer mon mot de passe
      </h2>
      <ChangePasswordForm />
    </div>
  );
}
