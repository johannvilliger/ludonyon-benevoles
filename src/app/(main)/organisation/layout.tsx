import Link from "next/link";
import { requireOrganisationUser } from "@/lib/session";

const links = [
  { href: "/organisation", label: "Vue d'ensemble" },
  { href: "/organisation/evenements", label: "Événements" },
  { href: "/organisation/annonces", label: "Annonces" },
  { href: "/organisation/benevoles", label: "Bénévoles" },
  { href: "/organisation/groupes", label: "Groupes" },
  { href: "/organisation/planning", label: "Planning" },
  { href: "/organisation/notifications", label: "Notifications" },
  { href: "/organisation/parametres", label: "Paramètres" },
];

// Réservé au rôle COMITE (pas aux responsables) — voir requireComiteUser.
const comiteLink = { href: "/organisation/comite", label: "Comité" };

export default async function OrganisationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireOrganisationUser();
  const visibleLinks = user.role === "COMITE" ? [...links, comiteLink] : links;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <h1 className="text-lg font-semibold text-stone-500">
          Espace organisation
        </h1>
      </div>
      <div className="flex flex-col gap-6 sm:flex-row">
        <nav className="flex shrink-0 flex-row flex-wrap gap-1 sm:w-44 sm:flex-col sm:flex-nowrap">
          {visibleLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
