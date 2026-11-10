import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireOrganisationUser } from "@/lib/session";
import { loadUpcomingShiftsOverview } from "@/lib/planningData";
import { SITE_LABELS, findSlotDef, formatDayLabel, formatHoursRange } from "@/lib/planning";

// Fenêtre du bloc planning du tableau de bord — volontairement courte
// (contrairement à l'alerte hebdomadaire des créneaux non pourvus, qui
// regarde plus loin) : ici c'est un coup d'œil, pas une liste à traiter.
const LOOKAHEAD_DAYS = 14;

export default async function OrganisationOverviewPage() {
  const user = await requireOrganisationUser();
  const isComite = user.role === "COMITE";

  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const [
    activeVolunteerCount,
    upcomingEventCount,
    announcementCount,
    pendingReplacementCount,
    overdueComiteTaskCount,
    upcomingShifts,
  ] = await Promise.all([
    prisma.user.count({ where: { active: true } }),
    prisma.event.count({ where: { startsAt: { gte: now } } }),
    prisma.announcement.count(),
    prisma.openingShiftAssignee.count({
      where: { seekingReplacement: true, shift: { date: { gte: todayUTC } } },
    }),
    isComite
      ? prisma.comiteItem.count({
          where: { type: "TACHE", done: false, dueDate: { lt: todayUTC } },
        })
      : Promise.resolve(0),
    loadUpcomingShiftsOverview(LOOKAHEAD_DAYS),
  ]);

  const cards = [
    {
      href: "/organisation/benevoles",
      label: "Bénévoles actifs",
      value: activeVolunteerCount,
    },
    {
      href: "/organisation/evenements",
      label: "Événements à venir",
      value: upcomingEventCount,
    },
    {
      href: "/organisation/annonces",
      label: "Annonces publiées",
      value: announcementCount,
    },
    {
      href: "/organisation/planning",
      label: "Remplacements en attente",
      value: pendingReplacementCount,
      alert: pendingReplacementCount > 0,
    },
    ...(isComite
      ? [
          {
            href: "/organisation/comite",
            label: "Tâches comité en retard",
            value: overdueComiteTaskCount,
            alert: overdueComiteTaskCount > 0,
          },
        ]
      : []),
  ];

  // Regroupé par jour pour l'affichage (un jour peut avoir 1 ou 2 créneaux
  // — Nyon/Gland le mercredi après-midi et le samedi).
  const shiftsByDay = new Map<string, typeof upcomingShifts>();
  for (const row of upcomingShifts) {
    const key = row.date.toISOString();
    const list = shiftsByDay.get(key);
    if (list) list.push(row);
    else shiftsByDay.set(key, [row]);
  }

  return (
    <div>
      <p className="text-stone-500">
        Gérez les événements, les annonces et les comptes des bénévoles.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href + card.label}
            href={card.href}
            className={`rounded-xl border bg-white p-4 transition hover:shadow-sm ${
              card.alert
                ? "border-red-200 hover:border-red-400"
                : "border-stone-200 hover:border-brand-blue"
            }`}
          >
            <p
              className={`text-3xl font-semibold ${card.alert ? "text-red-700" : "text-stone-900"}`}
            >
              {card.value}
            </p>
            <p className="mt-1 text-sm text-stone-500">{card.label}</p>
          </Link>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-medium text-stone-900">
          Planning des 2 prochaines semaines
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          En rouge : un créneau sans personne ou avec un remplacement en
          attente.
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-stone-200 bg-white">
          <ul className="divide-y divide-stone-100">
            {[...shiftsByDay.entries()].map(([key, rows]) => (
              <li key={key} className="p-3">
                <p className="text-sm font-medium text-stone-700">
                  {formatDayLabel(rows[0].date)}
                </p>
                <ul className="mt-1 space-y-1">
                  {rows.map((row) => {
                    const slot = findSlotDef(row.date, row.site, row.periode);
                    return (
                      <li
                        key={`${row.site}-${row.periode}`}
                        className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1 text-sm ${
                          row.closed
                            ? "text-stone-300"
                            : row.problem
                              ? "bg-red-50 text-red-800"
                              : "text-stone-600"
                        }`}
                      >
                        <span className="font-medium">{SITE_LABELS[row.site]}</span>
                        {slot && (
                          <span className="text-xs text-stone-400">
                            {formatHoursRange(slot.start, slot.end)}
                          </span>
                        )}
                        {row.closed ? (
                          <span>Fermé</span>
                        ) : row.assignees.length === 0 ? (
                          <span>Personne pour l&rsquo;instant</span>
                        ) : (
                          <span>
                            {row.assignees
                              .map((a) => `${a.name}${a.seekingReplacement ? " ⏳" : ""}`)
                              .join(", ")}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
