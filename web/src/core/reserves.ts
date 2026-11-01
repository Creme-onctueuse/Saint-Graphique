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
 * Réserve sur l'axe X, ou null s'il n'y a rien à signaler : aucune valeur imputée et tous les
 * statuts connus. Sans statuts dans les données (`counts` null ou champs absents), elle le dit sans
 * rien supposer sur la nature des valeurs.
 */
export function xAxisReserve(counts: StatusCounts | null, axisLabel: string): string | null {
  const prefix = `Réserve sur l'axe ${axisLabel} :`;
  if (!counts || counts.all.total === 0 || counts.all.unknown === counts.all.total) {
    return (
      `${prefix} statut inconnu des valeurs de patrimoine et de niveau de vie ` +
      '(publiées, calculées ou imputées : non renseigné dans les données chargées).'
    );
  }
  const { all, patrimoine, niveauVie } = counts;
  const unknownNote =
    all.unknown > 0 ? ` ${count(all.unknown, 'valeur', 'valeurs')} de statut inconnu.` : '';
  if (all.imputed > 0) {
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
