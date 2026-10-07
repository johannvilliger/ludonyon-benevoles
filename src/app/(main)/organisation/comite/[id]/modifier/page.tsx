import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireComiteUser } from "@/lib/session";
import {
  COMITE_ITEM_TYPES,
  COMITE_ITEM_TYPE_LABELS,
  COMITE_PRIORITIES,
  COMITE_PRIORITY_LABELS,
} from "@/lib/comite";
import { updateComiteItem } from "@/lib/actions/comite";

const CHAMP =
  "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue";

// Format attendu par <input type="date"> pour une date @db.Date (minuit
// UTC, pas de composante horaire à décaler).
function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function ModifierComiteItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireComiteUser();
  const { id } = await params;

  const item = await prisma.comiteItem.findUnique({ where: { id } });
  if (!item) notFound();

  return (
    <div className="max-w-xl space-y-4">
      <Link href="/organisation/comite" className="text-sm text-brand-blue hover:underline">
        ← Retour au tableau du comité
      </Link>
      <h2 className="text-lg font-medium text-stone-900">Modifier l&rsquo;item</h2>

      <form action={updateComiteItem} className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-2">
        <input type="hidden" name="id" value={item.id} />
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">Type</label>
          <select name="type" defaultValue={item.type} className={CHAMP}>
            {COMITE_ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {COMITE_ITEM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">Catégorie</label>
          <select name="categoryId" defaultValue={item.categoryId ?? ""} className={CHAMP}>
            <option value="">Aucune</option>
            {(await prisma.comiteItemCategory.findMany({ orderBy: { name: "asc" } })).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-stone-700">Titre</label>
          <input type="text" name="title" required maxLength={200} defaultValue={item.title} className={CHAMP} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-stone-700">Description</label>
          <textarea name="description" rows={3} maxLength={5000} defaultValue={item.description ?? ""} className={CHAMP} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">
            Priorité <span className="font-normal text-stone-400">(tâche uniquement)</span>
          </label>
          <select name="priority" defaultValue={item.priority ?? "NORMALE"} className={CHAMP}>
            {COMITE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {COMITE_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">
            Échéance <span className="font-normal text-stone-400">(facultative, tâche uniquement)</span>
          </label>
          <input
            type="date"
            name="dueDate"
            defaultValue={item.dueDate ? toDateInputValue(item.dueDate) : ""}
            className={CHAMP}
          />
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg border-2 border-black bg-brand-yellow px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand-yellow-dark"
          >
            Enregistrer
          </button>
        </div>
      </form>
    </div>
  );
}
