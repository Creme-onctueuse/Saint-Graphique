/**
 * Scores bruts par PCS, avant placement sur les axes.
 *
 * - Score X (« Exploitation ») : patrimoine / niveau de vie × 100. Plus il est élevé, plus les
 *   revenus proviennent du capital plutôt que du travail.
 * - Score Y (« Domination ») : somme pondérée des parts de diplômes, Σ poids[k] · part[k].
 */
import { DIPLOMA_KEYS, type DiplomaShares, type DiplomaWeights, type RawPcsItem } from './types.ts';

/** Poids par défaut du score Y (config/methods.yaml). */
export const DEFAULT_Y_WEIGHTS: Readonly<DiplomaWeights> = Object.freeze({
  bac5: 5,
  bac3: 3,
  bac2: 2,
  bac: 1,
  cap: -1,
  brevet: -2,
  certif_aucun: -3,
});

/** Score Y imposé à une PCS (ex. retraités : -180, comme dans la méthode de référence). */
export interface ScoreOverride {
  code: string;
  score: number;
}

/** Scores bruts d'une PCS. */
export interface PcsScores {
  code: string;
  x: number;
  y: number;
}

/**
 * Score X = patrimoine (k€) / niveau de vie mensuel (€) × 100, mêmes opérations que le pipeline
 * (pipeline/methods/scores.py). Le facteur 100 ne change ni les rangs ni le placement continu.
 */
export function xScore(
  item: Pick<RawPcsItem, 'code' | 'patrimoine_keur' | 'niveau_vie_mensuel_eur'>,
): number {
  const nv = item.niveau_vie_mensuel_eur;
  if (!(nv > 0) || !Number.isFinite(nv)) {
    throw new RangeError(`Niveau de vie nul ou invalide pour la PCS ${item.code}`);
  }
  if (!Number.isFinite(item.patrimoine_keur)) {
    throw new RangeError(`Patrimoine invalide pour la PCS ${item.code}`);
  }
  return (item.patrimoine_keur / nv) * 100;
}

/**
 * Score Y = Σ poids[k] · part[k], sommé dans l'ordre de DIPLOMA_KEYS (même ordre d'opérations
 * que la formule de référence : 5·bac5 + 3·bac3 + 2·bac2 + bac − cap − 2·brevet − 3·certif).
 */
export function yScore(diplomes: DiplomaShares, weights: DiplomaWeights): number {
  let score = 0;
  for (const k of DIPLOMA_KEYS) score += weights[k] * diplomes[k];
  return score;
}

/** Scores X et Y de toutes les PCS, avec éventuel score Y imposé. */
export function computeScores(
  items: readonly RawPcsItem[],
  weights: DiplomaWeights,
  override: ScoreOverride | null = null,
): PcsScores[] {
  return items.map((it) => ({
    code: it.code,
    x: xScore(it),
    y:
      override !== null && it.code === override.code
        ? override.score
        : yScore(it.diplomes, weights),
  }));
}

/** Vrai si les deux jeux de poids sont identiques. */
export function sameWeights(a: DiplomaWeights, b: DiplomaWeights): boolean {
  return DIPLOMA_KEYS.every((k) => a[k] === b[k]);
}
