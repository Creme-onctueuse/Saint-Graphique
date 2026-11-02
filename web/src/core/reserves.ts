/**
 * Réserves que la page doit porter elle-même : statut des valeurs de patrimoine et de niveau de vie
 * (publiées, calculées ou imputées), et ex æquo entre PCS. Tout est compté à partir des données et
 * des scores : rien n'est codé en dur, les données pouvant changer.
 */
import { compareCodes } from './ranks.ts';
import type { PcsScores } from './scores.ts';

/** Valeurs de schemas/pcs.schema.json, plus « unknown » quand le champ manque ou est invalide. */
export type ValueStatus = 'published' | 'imputed' | 'calculated' | 'unknown';

export const STATUS_LABELS: Readonly<Record<ValueStatus, string>> = {
  published: 'publié',
  imputed: 'imputé',
  calculated: 'calculé',
  unknown: 'statut inconnu',
};

/** Marqueur discret d'une valeur imputée. */
export const IMPUTED_MARK = '≈';

export function parseStatus(raw: unknown): ValueStatus {
  return raw === 'published' || raw === 'imputed' || raw === 'calculated' ? raw : 'unknown';
}

/** Statut en toutes lettres ; une valeur imputée porte le marqueur. */
export function formatStatus(status: ValueStatus): string {
  const label = STATUS_LABELS[status];
  return status === 'imputed' ? `${IMPUTED_MARK} ${label}` : label;
}

export interface StatusTally {
  published: number;
  imputed: number;
  calculated: number;
  unknown: number;
  total: number;
}

export interface StatusCounts {
  patrimoine: StatusTally;
  niveauVie: StatusTally;
  /** Somme des deux : une PCS compte pour deux valeurs. */
  all: StatusTally;
}

function emptyTally(): StatusTally {
  return { published: 0, imputed: 0, calculated: 0, unknown: 0, total: 0 };
}

/** Compte les statuts des valeurs de patrimoine et de niveau de vie. */
export function countStatuses(
  items: readonly { patrimoine_status?: unknown; niveau_vie_status?: unknown }[],
): StatusCounts {
  const counts: StatusCounts = {
    patrimoine: emptyTally(),
    niveauVie: emptyTally(),
    all: emptyTally(),
  };
  for (const item of items) {
    const entries: [StatusTally, ValueStatus][] = [
      [counts.patrimoine, parseStatus(item.patrimoine_status)],
      [counts.niveauVie, parseStatus(item.niveau_vie_status)],
    ];
    for (const [tally, status] of entries) {
      tally[status]++;
      tally.total++;
      counts.all[status]++;
      counts.all.total++;
    }
  }
  return counts;
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n > 1 ? plural : singular}`;
}

function tallyDetail(t: StatusTally): string {
  return `${count(t.imputed, 'imputée', 'imputées')}, ${count(t.calculated, 'calculée', 'calculées')}`;
}

/**
 * Rappel permanent : aucune méthode de la page n'utilise la définition de l'axe X donnée par Chris.
 * Il dépend du choix de méthode, pas des données : il reste affiché quelles que soient les valeurs.
 */
export const X_DEFINITION_RESERVE =
  "Définition de l'axe X : cette page classe les PCS d'après leur patrimoine et leur niveau de vie. " +
  'Chris définit cet axe par la composition du patrimoine de chaque ' +
  'PCS, une donnée introuvable à ce niveau dans les sources consultées : les positions peuvent ' +
  'différer de son graphique.';

/** Résumés d'une ligne, toujours visibles ; le texte complet s'ouvre d'un clic. */
export const COMPUTED_RESERVE_SUMMARY =
  'Méthode calculée : axe Exploitation reconstruit, peut différer du graphique de Chris';
export const READ_POSITIONS_RESERVE_SUMMARY =
  'Positions lues sur les vidéos de Chris, formule non publiée, 2 à 3 unités de la matrice v11';

/** Projection 2027 : ce que la carte montre à cette étape, et ce qu'elle ne montre pas. */
export const PROJECTION_RESERVE =
  'Projection 2027 : cette carte prolonge les électorats de 2017 à 2024 selon deux scénarios. Elle ne ' +
  'prévoit pas le résultat. Les données s’arrêtent en juillet 2024. Les familles suivent un ' +
  'classement propre à ce projet, et les candidats de 2027 n’y figurent pas.';
export const PROJECTION_RESERVE_SUMMARY =
  'Projection 2027 : prolonge 2017-2024, ne prévoit pas le résultat, données arrêtées en juillet 2024';

/** Réserve d'une méthode dont les axes ne sont pas ceux du graphique de Chris. */
export interface MethodReserve {
  text: string;
  summary: string;
  /** Vrai si la méthode utilise le patrimoine et le niveau de vie : leur statut compte alors. */
  usesWealth: boolean;
}

/** Chiffres mesurés et raisonnement : voir docs/methodologie.md. */
export const METHOD_RESERVES: Readonly<Record<string, MethodReserve>> = {
  espace_social: {
    text:
      'Espace social : cette carte suit Bourdieu (La Distinction, 1979), pas le graphique de Chris, ' +
      'et ses axes ne sont ni l’exploitation ni la domination. Le capital culturel n’y est mesuré ' +
      'que par les diplômes, le capital économique que par le patrimoine et le niveau de vie. Les ' +
      'deux vont de pair : le volume porte l’essentiel des écarts, et la mise à l’échelle étire la ' +
      'structure sur toute la largeur. En bas de la carte, être à gauche dit surtout un patrimoine ' +
      'très faible, pas un capital culturel élevé. Les retraités gardent leurs propres diplômes, qui ' +
      'reflètent leur génération : leur point, et avec lui les électorats âgés, est tiré vers la ' +
      'droite et vers le bas.',
    summary:
      'Espace social d’après Bourdieu, pas le graphique de Chris ; retraités biaisés par leur génération',
    usesWealth: true,
  },
};

/** Méthode dont les PCS sont lues sur le graphique de Chris au lieu d'être calculées. */
export const READ_POSITIONS_METHOD = 'read_positions';

/** Chiffres mesurés et sources détaillées : voir docs/methodologie.md. */
export const READ_POSITIONS_RESERVE =
  'Positions lues : les catégories sont placées là où le tableau de Chris les affiche (février 2026), ' +
  "sur sa grille de 0,5. La formule de ses axes n'est pas publiée : cette page ne la recalcule pas. " +
  'Les électorats sont des barycentres calculés ici à partir de sondages : ils retrouvent les ' +
  'candidats lus dans son tableau de 2025 à environ 0,2 unité près, hors la lecture de janvier 2025 ' +
  "pour 2022. Ils s'écartent de 2 à 3 unités de la matrice v11, un autre modèle montré en septembre 2026.";

/**
 * Réserve sur l'axe X, ou null s'il n'y a rien à signaler : toutes les valeurs publiées et tous les
 * statuts connus. Sans statuts dans les données (`counts` null ou champs absents), elle le dit sans
 * rien supposer sur la nature des valeurs.
 */
export function xAxisReserve(counts: StatusCounts | null, axisLabel: string): string | null {
  return wealthReserve(counts, `Réserve sur l'axe ${axisLabel} :`);
}

/** Même réserve, pour une méthode où ces valeurs entrent dans les deux axes. */
export function wealthReserve(counts: StatusCounts | null, prefix: string): string | null {
  if (!counts || counts.all.total === 0 || counts.all.unknown === counts.all.total) {
    return (
      `${prefix} statut inconnu des valeurs de patrimoine et de niveau de vie ` +
      '(publiées, calculées ou imputées : non renseigné dans les données chargées).'
    );
  }
  const { all, patrimoine, niveauVie } = counts;
  const unknownNote =
    all.unknown > 0 ? ` ${count(all.unknown, 'valeur', 'valeurs')} de statut inconnu.` : '';
  if (all.imputed > 0 || all.calculated > 0) {
    return (
      `${prefix} ${count(all.imputed, 'valeur imputée', 'valeurs imputées')} et ` +
      `${count(all.calculated, 'calculée', 'calculées')} sur ${all.total} ` +
      `(patrimoine : ${tallyDetail(patrimoine)} ; niveau de vie : ${tallyDetail(niveauVie)}).` +
      unknownNote
    );
  }
  return all.unknown > 0 ? `${prefix}${unknownNote}` : null;
}

/** Groupe de PCS ayant le même score sur un axe. */
export interface Tie {
  axis: 'x' | 'y';
  score: number;
  /** Codes triés, au moins deux. */
  codes: string[];
}

/** Écart sous lequel deux scores sont égaux : au-delà de l'arrondi des calculs, sans plus. */
const TIE_TOLERANCE = 1e-9;

function tiesOnAxis(scores: readonly PcsScores[], axis: 'x' | 'y', tolerance: number): Tie[] {
  const sorted = scores
    .map((s) => ({ code: s.code, score: s[axis] }))
    .sort((a, b) => a.score - b.score);
  const ties: Tie[] = [];
  let group: { code: string; score: number }[] = [];
  const flush = (): void => {
    const first = group[0];
    if (first && group.length > 1) {
      ties.push({
        axis,
        score: first.score,
        codes: group.map((g) => g.code).sort(compareCodes),
      });
    }
  };
  for (const item of sorted) {
    const last = group.at(-1);
    if (last && item.score - last.score > tolerance) {
      flush();
      group = [];
    }
    group.push(item);
  }
  flush();
  return ties;
}

/** Ex æquo sur les deux axes, calculés depuis les scores bruts. */
export function findTies(scores: readonly PcsScores[], tolerance = TIE_TOLERANCE): Tie[] {
  return [...tiesOnAxis(scores, 'x', tolerance), ...tiesOnAxis(scores, 'y', tolerance)];
}
