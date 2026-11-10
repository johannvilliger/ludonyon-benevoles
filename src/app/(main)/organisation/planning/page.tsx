import Link from "next/link";
import { requireOrganisationUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { loadPlanningWeeksAndShifts } from "@/lib/planningData";
import { formatDayLabel } from "@/lib/planning";
import { createPlanningClosure, deletePlanningClosure } from "@/lib/actions/planning";
import PlanningMonthNav from "@/components/PlanningMonthNav";
import PlanningTable from "@/components/PlanningTable";
import PlanningExcelImportForm from "@/components/PlanningExcelImportForm";

export default async function OrganisationPlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const currentUser = await requireOrganisationUser();

  const { y, m } = await searchParams;
  const now = new Date();
  const year = Number(y) || now.getFullYear();
  const month = Number(m) || now.getMonth() + 1;

  const [{ weeks, shiftsByKey, closures }, activeUsers, upcomingClosures, currentUserRow] = await Promise.all([
    loadPlanningWeeksAndShifts(year, month),
    prisma.user.findMany({
      where: { active: true, unavailableForOpenings: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, poste: true },
    }),
    prisma.planningClosure.findMany({
      where: { endDate: { gte: new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) } },
      orderBy: { startDate: "asc" },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: currentUser.id }, select: { poste: true } }),
  ]);

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-stone-900">
            Planning des ouvertures
          </h2>
          <PlanningMonthNav basePath="/organisation/planning" year={year} month={month} />
        </div>
        <p className="mt-1 text-sm text-stone-500">
          Choisissez un·e bénévole dans la liste déroulante de chaque case
          pour l&rsquo;assigner ; cliquez sur le × pour le retirer.
        </p>
        <Link
          href="/organisation/planning/auto"
          className="mt-2 inline-block text-sm text-brand-blue hover:underline"
        >
          🧪 Tester la répartition automatique
        </Link>

        <div className="mt-4">
          <PlanningTable
            weeks={weeks}
            shiftsByKey={shiftsByKey}
            closures={closures}
            editable
            activeUsers={activeUsers}
            currentUserId={currentUser.id}
            currentUserRole={currentUser.role}
            currentUserPoste={currentUserRow.poste}
            isOrg
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium text-stone-900">
          Import depuis un fichier Excel
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Générez un modèle vierge pour une période donnée, complétez-le
          (un onglet « Bénévoles » liste les prénoms à utiliser), puis
          réimportez-le : le site reconnaît les bénévoles actif·ve·s et met
          à jour le planning pour toute la période couverte par le fichier
          (une case laissée vide efface l&rsquo;assignation existante).
        </p>

        <form
          action="/api/organisation/planning/excel-template"
          method="GET"
          className="mt-3 grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-4"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Début
            </label>
            <input
              type="date"
              name="start"
              required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Fin
            </label>
            <input
              type="date"
              name="end"
              required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div className="sm:col-span-2 sm:self-end">
            <button
              type="submit"
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              📥 Générer le modèle
            </button>
          </div>
        </form>

        <PlanningExcelImportForm />
      </section>

      <section>
        <h2 className="text-lg font-medium text-stone-900">
          Vacances globales (fermeture de la ludothèque)
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          S&rsquo;affichent comme jours fermés sur le planning, pour tout le
          monde.
        </p>
        <form
          action={createPlanningClosure}
          className="mt-3 grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-4"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Début
            </label>
            <input
              type="date"
              name="startDate"
              required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Fin
            </label>
            <input
              type="date"
              name="endDate"
              required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Libellé
            </label>
            <input
              type="text"
              name="label"
              required
              maxLength={191}
              placeholder="Ex. Vacances de Noël"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div className="sm:col-span-4">
            <button
              type="submit"
              className="rounded-lg border-2 border-black bg-brand-yellow px-4 py-2 text-sm font-semibold text-black hover:bg-brand-yellow-dark"
            >
              Ajouter la fermeture
            </button>
          </div>
        </form>

        {upcomingClosures.length > 0 && (
          <ul className="mt-3 space-y-2">
            {upcomingClosures.map((closure) => (
              <li
                key={closure.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm"
              >
                <span>
                  <span className="font-medium text-stone-800">{closure.label}</span>{" "}
                  <span className="text-stone-500">
                    ({formatDayLabel(closure.startDate)} – {formatDayLabel(closure.endDate)})
                  </span>
                </span>
                <form action={deletePlanningClosure}>
                  <input type="hidden" name="id" value={closure.id} />
                  <button
                    type="submit"
                    className="text-xs text-stone-400 underline hover:text-red-600"
                  >
                    Supprimer
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
