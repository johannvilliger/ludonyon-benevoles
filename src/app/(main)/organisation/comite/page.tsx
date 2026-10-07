import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireComiteUser } from "@/lib/session";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import {
  COMITE_ITEM_TYPES,
  COMITE_ITEM_TYPE_LABELS,
  COMITE_PRIORITIES,
  COMITE_PRIORITY_LABELS,
  type ComitePriority,
} from "@/lib/comite";
import {
  createComiteCategory,
  deleteComiteCategory,
  createComiteItem,
  deleteComiteItem,
  toggleComiteItemDone,
  toggleComiteItemDecline,
  addComiteItemNote,
  deleteComiteItemNote,
  notifyComiteAboutItem,
} from "@/lib/actions/comite";

const PRIORITY_RANK: Record<ComitePriority, number> = {
  URGENTE: 0,
  HAUTE: 1,
  NORMALE: 2,
  BASSE: 3,
};

const PRIORITY_BADGE: Record<ComitePriority, string> = {
  URGENTE: "bg-red-100 text-red-800",
  HAUTE: "bg-orange-100 text-orange-800",
  NORMALE: "bg-stone-100 text-stone-700",
  BASSE: "bg-stone-100 text-stone-500",
};

const CHAMP =
  "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue";

export default async function ComitePage() {
  const user = await requireComiteUser();

  const [items, categories] = await Promise.all([
    prisma.comiteItem.findMany({
      include: {
        category: true,
        author: { select: { id: true, name: true } },
        declines: { include: { user: { select: { id: true, name: true } } } },
        notes: {
          include: { author: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.comiteItemCategory.findMany({ orderBy: { name: "asc" } }),
  ]);

  const sorted = [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ra = a.priority ? PRIORITY_RANK[a.priority as ComitePriority] : 4;
    const rb = b.priority ? PRIORITY_RANK[b.priority as ComitePriority] : 4;
    if (ra !== rb) return ra - rb;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-medium text-stone-900">
          Tableau du comité
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Notes et tâches partagées entre membres du comité. Sur une tâche,
          chacun·e peut dire explicitement « pas pour moi » pour éviter que
          tout le monde attende en pensant qu&rsquo;un·e autre va s&rsquo;en
          charger.
        </p>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-stone-900">Nouvel item</h3>
        <form action={createComiteItem} className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Type
            </label>
            <select name="type" defaultValue="TACHE" className={CHAMP}>
              {COMITE_ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COMITE_ITEM_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Catégorie
            </label>
            <select name="categoryId" defaultValue="" className={CHAMP}>
              <option value="">Aucune</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Titre
            </label>
            <input type="text" name="title" required maxLength={200} className={CHAMP} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Description
            </label>
            <textarea name="description" rows={2} maxLength={5000} className={CHAMP} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Priorité{" "}
              <span className="font-normal text-stone-400">(tâche uniquement)</span>
            </label>
            <select name="priority" defaultValue="NORMALE" className={CHAMP}>
              {COMITE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {COMITE_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Échéance{" "}
              <span className="font-normal text-stone-400">(facultative, tâche uniquement)</span>
            </label>
            <input type="date" name="dueDate" className={CHAMP} />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg border-2 border-black bg-brand-yellow px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand-yellow-dark"
            >
              Ajouter
            </button>
          </div>
        </form>
      </section>

      <section>
        <details className="rounded-xl border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-stone-900">
            Catégories ({categories.length})
          </summary>
          <form action={createComiteCategory} className="mt-3 flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-stone-700">
                Nouvelle catégorie
              </label>
              <input
                type="text"
                name="name"
                required
                maxLength={100}
                placeholder="ex. Finances, Local, Événements…"
                className={CHAMP}
              />
            </div>
            <button
              type="submit"
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
            >
              Créer
            </button>
          </form>
          {categories.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-1 rounded-full bg-stone-100 py-1 pl-3 pr-1 text-sm text-stone-700"
                >
                  {c.name}
                  <form action={deleteComiteCategory}>
                    <input type="hidden" name="id" value={c.id} />
                    <button
                      type="submit"
                      className="rounded-full px-1.5 text-xs text-stone-400 hover:text-red-600"
                      aria-label={`Supprimer la catégorie ${c.name}`}
                    >
                      ✕
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-stone-900">
          {sorted.length} item{sorted.length > 1 ? "s" : ""}
        </h3>
        {sorted.length === 0 ? (
          <p className="mt-2 text-sm text-stone-400">
            Rien pour l&rsquo;instant — ajoute la première note ou tâche
            ci-dessus.
          </p>
        ) : (
          <ul className="mt-3 space-y-4">
            {sorted.map((item) => {
              const isTache = item.type === "TACHE";
              const hasDeclined = item.declines.some((d) => d.userId === user.id);
              const overdue =
                isTache && !item.done && item.dueDate && item.dueDate < today;
              return (
                <li
                  key={item.id}
                  className={`rounded-xl border bg-white p-4 ${
                    item.done ? "border-stone-100 opacity-60" : "border-stone-200"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-full bg-stone-900 px-2 py-0.5 font-medium text-white">
                      {COMITE_ITEM_TYPE_LABELS[item.type as "NOTE" | "TACHE"]}
                    </span>
                    {item.category && (
                      <span className="rounded-full bg-brand-yellow-soft px-2 py-0.5 font-medium text-black">
                        {item.category.name}
                      </span>
                    )}
                    {isTache && item.priority && (
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${PRIORITY_BADGE[item.priority as ComitePriority]}`}
                      >
                        {COMITE_PRIORITY_LABELS[item.priority as ComitePriority]}
                      </span>
                    )}
                    {isTache && item.dueDate && (
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${
                          overdue ? "bg-red-100 text-red-800" : "bg-stone-100 text-stone-600"
                        }`}
                      >
                        Échéance {formatDateOnly(item.dueDate)}
                      </span>
                    )}
                    {item.done && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                        Fait
                      </span>
                    )}
                  </div>

                  <p
                    className={`mt-2 font-medium text-stone-900 ${item.done ? "line-through" : ""}`}
                  >
                    {item.title}
                  </p>
                  {item.description && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-stone-600">
                      {item.description}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-stone-400">
                    Ajouté par {item.author.name} le {formatDateTime(item.createdAt)}
                  </p>

                  {isTache && item.declines.length > 0 && (
                    <p className="mt-2 text-xs text-stone-500">
                      <span className="font-medium">Pas pour :</span>{" "}
                      {item.declines.map((d) => d.user.name).join(", ")}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {isTache && (
                      <form action={toggleComiteItemDone}>
                        <input type="hidden" name="id" value={item.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100"
                        >
                          {item.done ? "Rouvrir" : "Marquer fait"}
                        </button>
                      </form>
                    )}
                    {isTache && !item.done && (
                      <form action={toggleComiteItemDecline}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <button
                          type="submit"
                          className={`rounded-lg border px-3 py-1.5 text-xs ${
                            hasDeclined
                              ? "border-stone-300 text-stone-600 hover:bg-stone-100"
                              : "border-red-300 text-red-700 hover:bg-red-50"
                          }`}
                        >
                          {hasDeclined ? "Je reprends" : "Pas pour moi"}
                        </button>
                      </form>
                    )}
                    <form action={notifyComiteAboutItem}>
                      <input type="hidden" name="itemId" value={item.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100"
                      >
                        🔔 Notifier le comité
                      </button>
                    </form>
                    <Link
                      href={`/organisation/comite/${item.id}/modifier`}
                      className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100"
                    >
                      Modifier
                    </Link>
                    <form action={deleteComiteItem}>
                      <input type="hidden" name="id" value={item.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                      >
                        Supprimer
                      </button>
                    </form>
                  </div>

                  <div className="mt-4 border-t border-stone-100 pt-3">
                    {item.notes.length > 0 && (
                      <ul className="space-y-2">
                        {item.notes.map((note) => (
                          <li key={note.id} className="rounded-lg bg-stone-50 px-3 py-2 text-sm">
                            <p className="whitespace-pre-wrap text-stone-700">{note.body}</p>
                            <div className="mt-1 flex items-center justify-between text-xs text-stone-400">
                              <span>
                                {note.author.name} · {formatDateTime(note.createdAt)}
                              </span>
                              {note.authorId === user.id && (
                                <form action={deleteComiteItemNote}>
                                  <input type="hidden" name="id" value={note.id} />
                                  <button type="submit" className="hover:text-red-600">
                                    Supprimer
                                  </button>
                                </form>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form action={addComiteItemNote} className="mt-2 flex items-end gap-2">
                      <input type="hidden" name="itemId" value={item.id} />
                      <input
                        type="text"
                        name="body"
                        required
                        maxLength={2000}
                        placeholder="Ajouter une note, demander un statut…"
                        className={`flex-1 ${CHAMP}`}
                      />
                      <button
                        type="submit"
                        className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
                      >
                        Envoyer
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
