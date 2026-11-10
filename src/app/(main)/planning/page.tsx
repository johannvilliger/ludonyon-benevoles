import Link from "next/link";
import { requireUser } from "@/lib/session";
import { isOrganisationRole } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { loadPlanningWeeksAndShifts } from "@/lib/planningData";
import PlanningMonthNav from "@/components/PlanningMonthNav";
import PlanningTable from "@/components/PlanningTable";

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const user = await requireUser();
  const isOrg = isOrganisationRole(user.role);

  const { y, m } = await searchParams;
  const now = new Date();
  const year = Number(y) || now.getFullYear();
  const month = Number(m) || now.getMonth() + 1;

  const [{ weeks, shiftsByKey, closures }, currentUserRow] = await Promise.all([
    loadPlanningWeeksAndShifts(year, month),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { poste: true } }),
  ]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-stone-900">
          Planning des ouvertures
        </h1>
        <PlanningMonthNav basePath="/planning" year={year} month={month} />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-500">
          Qui tient la ludothèque, jour par jour. Géré par les
          responsables/comité.
        </p>
        <div className="flex items-center gap-3 text-sm">
          <a
            href={`/api/planning/ics?y=${year}&m=${month}`}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-stone-600 hover:bg-stone-100"
          >
            📅 Copier mes ouvertures sur mon calendrier
          </a>
          {isOrg && (
            <Link
              href={`/organisation/planning?y=${year}&m=${month}`}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-stone-600 hover:bg-stone-100"
            >
              Gérer les assignations →
            </Link>
          )}
        </div>
      </div>

      <div className="mt-6">
        <PlanningTable
          weeks={weeks}
          shiftsByKey={shiftsByKey}
          closures={closures}
          editable={false}
          activeUsers={[]}
          currentUserId={user.id}
          currentUserRole={user.role}
          currentUserPoste={currentUserRow.poste}
          isOrg={isOrg}
        />
      </div>
    </div>
  );
}
