// Module interne au comité (Espace organisation > Comité) : constantes
// partagées serveur/client pour les items du tableau (notes et tâches).

export const COMITE_ITEM_TYPES = ["NOTE", "TACHE"] as const;
export type ComiteItemType = (typeof COMITE_ITEM_TYPES)[number];

export const COMITE_ITEM_TYPE_LABELS: Record<ComiteItemType, string> = {
  NOTE: "Note",
  TACHE: "Tâche",
};

export function isValidComiteItemType(value: string): value is ComiteItemType {
  return (COMITE_ITEM_TYPES as readonly string[]).includes(value);
}

// Pertinent seulement pour une tâche (toujours null sur une note).
export const COMITE_PRIORITIES = ["BASSE", "NORMALE", "HAUTE", "URGENTE"] as const;
export type ComitePriority = (typeof COMITE_PRIORITIES)[number];

export const COMITE_PRIORITY_LABELS: Record<ComitePriority, string> = {
  BASSE: "Basse",
  NORMALE: "Normale",
  HAUTE: "Haute",
  URGENTE: "Urgente",
};

export function isValidComitePriority(value: string): value is ComitePriority {
  return (COMITE_PRIORITIES as readonly string[]).includes(value);
}
