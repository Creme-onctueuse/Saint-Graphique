/**
 * Recherche « Où suis-je ? » : retrouver sur la carte un métier, une catégorie ou un électorat. Les
 * métiers courants renvoient à leur catégorie de la nomenclature PCS, dont les libellés officiels ne
 * disent pas toujours grand-chose. Rien n'est conservé : la recherche reste dans la page.
 *
 * Module pur, testé dans search.test.ts.
 */
import type { ChartModel } from '../chart/types.ts';

/** Métiers courants, par code PCS. Un code absent de la méthode affichée est simplement ignoré. */
const JOB_TERMS: Readonly<Record<string, readonly string[]>> = {
  '11': ['agriculteur', 'agricultrice', 'paysan', 'éleveur', 'viticulteur'],
  '21': ['artisan', 'boulanger', 'boucher'],
  '22': ['commerçant', 'commerçante', 'restaurateur', 'buraliste'],
  '23': ['patron', 'dirigeant', 'chef d’entreprise'],
  '31': ['médecin', 'avocat', 'notaire', 'pharmacien', 'architecte', 'dentiste'],
  '33': ['haut fonctionnaire', 'magistrat', 'commissaire'],
  '34': ['professeur', 'enseignant', 'prof', 'chercheur'],
  '35': ['journaliste', 'artiste', 'musicien', 'comédien', 'graphiste'],
  '37': ['manager', 'consultant', 'cadre', 'commercial', 'directeur'],
  '38': ['ingénieur', 'développeur', 'informaticien', 'data scientist'],
  '42': ['instituteur', 'institutrice', 'maître d’école', 'professeur des écoles'],
  '43': ['infirmier', 'infirmière', 'éducateur', 'kinésithérapeute', 'sage-femme'],
  '44': ['prêtre', 'religieux', 'religieuse'],
  '46': ['chargé de clientèle', 'responsable commercial', 'comptable'],
  '47': ['technicien', 'technicienne', 'dessinateur'],
  '48': ['contremaître', 'chef de chantier', 'agent de maîtrise'],
  '52': ['aide-soignant', 'aide-soignante', 'agent administratif', 'atsem'],
  '53': ['policier', 'gendarme', 'militaire', 'pompier', 'soldat'],
  '54': ['secrétaire', 'employé de banque', 'employé de bureau', 'standardiste'],
  '55': ['caissier', 'caissière', 'vendeur', 'vendeuse'],
  '56': ['aide à domicile', 'assistante maternelle', 'nounou', 'coiffeur', 'coiffeuse', 'serveur'],
  '62': ['soudeur', 'opérateur', 'ouvrier d’usine', 'ouvrier qualifié'],
  '63': ['maçon', 'plombier', 'électricien', 'menuisier', 'cuisinier', 'mécanicien'],
  '64': ['chauffeur', 'routier', 'livreur', 'taxi', 'conducteur'],
  '65': ['cariste', 'magasinier', 'docker'],
  '67': ['manutentionnaire', 'ouvrier à la chaîne', 'ouvrier non qualifié'],
  '68': ['agent d’entretien', 'femme de ménage', 'homme de ménage', 'plongeur'],
  '69': ['ouvrier agricole', 'saisonnier', 'vendangeur'],
  '7': ['retraité', 'retraitée'],
  '81': ['chômeur', 'chômeuse', 'demandeur d’emploi'],
  '84': ['étudiant', 'étudiante', 'lycéen', 'lycéenne', 'élève'],
};

export interface SearchItem {
  /** Clé de sélection : `p:<code>` ou `c:<id>`. */
  key: string;
  kind: 'pcs' | 'candidate';
  label: string;
  /** Précision affichée : le groupe de la catégorie. */
  detail: string;
  terms: readonly string[];
  x: number;
  y: number;
}

export interface SearchResult extends SearchItem {
  /** Métier qui a mené à ce résultat, s'il n'apparaît pas dans le libellé. */
  matched: string | null;
}

/** Minuscules, sans accents ni ponctuation : « Aide-soignante » et « aide soignante » se valent. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tout ce que l'on peut chercher sur la carte affichée. */
export function searchItemsOf(model: ChartModel): SearchItem[] {
  return [
    ...model.candidates.map((c): SearchItem => ({
      key: `c:${c.id}`,
      kind: 'candidate',
      label: c.label,
      detail: 'Électorat',
      terms: c.trackLabel ? [c.trackLabel] : [],
      x: c.x,
      y: c.y,
    })),
    ...model.pcs.map((p): SearchItem => ({
      key: `p:${p.code}`,
      kind: 'pcs',
      label: p.label,
      detail: p.groupLabel,
      terms: [p.short, ...(JOB_TERMS[p.code] ?? [])],
      x: p.x,
      y: p.y,
    })),
  ];
}

/** Rang d'une correspondance : plus petit, meilleur ; null si le texte ne correspond pas. */
function rankOf(text: string, query: string): number | null {
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  if (text.split(' ').some((word) => word.startsWith(query))) return 2;
  return text.includes(query) ? 3 : null;
}

/** Résultats d'une recherche, les meilleures correspondances d'abord. */
export function searchItems(
  items: readonly SearchItem[],
  query: string,
  limit = 8,
): SearchResult[] {
  const q = normalize(query);
  if (q === '') return [];
  const found: { result: SearchResult; rank: number }[] = [];
  for (const item of items) {
    const onLabel = rankOf(normalize(item.label), q);
    let best = onLabel;
    let matched: string | null = null;
    for (const term of item.terms) {
      const rank = rankOf(normalize(term), q);
      if (rank !== null && (best === null || rank < best)) {
        best = rank;
        matched = term;
      }
    }
    if (best !== null) found.push({ result: { ...item, matched }, rank: best });
  }
  return found
    .sort((a, b) => a.rank - b.rank || a.result.label.localeCompare(b.result.label, 'fr'))
    .slice(0, limit)
    .map((f) => f.result);
}
