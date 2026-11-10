// Postes de bénévole pour le planning des ouvertures — fixés uniquement
// par un responsable/comité (jamais en libre-service), utilisés pour
// filtrer qui est notifié lors d'une recherche de remplaçant.
export const POSTES = ["ACCUEIL", "RETOUR", "SORTIE"] as const;
export type Poste = (typeof POSTES)[number];

export const POSTE_LABELS: Record<Poste, string> = {
  ACCUEIL: "Accueil",
  RETOUR: "Poste retour",
  SORTIE: "Poste sortie",
};

// Libellé affiché pour un poste non renseigné (bénévole pas encore formé
// aux ouvertures).
export const POSTE_UNSET_LABEL = "En formation";

// Hiérarchie croissante : un poste peut couvrir tous les postes de
// niveau inférieur ou égal (ex. Sortie remplace Accueil, Retour ou
// Sortie ; Accueil ne remplace qu'Accueil).
const POSTE_LEVEL: Record<Poste, number> = {
  ACCUEIL: 1,
  RETOUR: 2,
  SORTIE: 3,
};

export function isValidPoste(value: string): value is Poste {
  return (POSTES as readonly string[]).includes(value);
}

export function canCoverPoste(candidatePoste: Poste, requiredPoste: Poste): boolean {
  return POSTE_LEVEL[candidatePoste] >= POSTE_LEVEL[requiredPoste];
}

// Qui peut remplacer qui sur le planning des ouvertures (bouton "Je
// remplace" côté affichage, et revérifié dans fulfillShiftReplacement
// côté serveur) — même filtre que celui utilisé pour choisir qui notifier
// lors d'une demande de remplacement (voir requestReplacement) : un·e
// bénévole n'est remplacé·e que par un·e autre bénévole dont le poste
// couvre le sien (ou par n'importe quel·le bénévole si son poste n'est pas
// encore fixé) ; un·e responsable/comité n'est remplacé·e que par
// quelqu'un·e du même rôle, sans notion de poste.
export function canReplaceAssignee(
  target: { role: string; poste: string | null },
  viewer: { role: string; poste: string | null }
): boolean {
  if (target.role !== "BENEVOLE") {
    return viewer.role === target.role;
  }
  if (viewer.role !== "BENEVOLE") return false;
  if (!target.poste || !isValidPoste(target.poste)) return true;
  if (!viewer.poste || !isValidPoste(viewer.poste)) return false;
  return canCoverPoste(viewer.poste, target.poste);
}
