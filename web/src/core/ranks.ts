/**
 * Placement par rangs : les N PCS sont classées par score décroissant (rang 1 = score le plus
 * élevé), puis le rang est projeté linéairement sur l'axe.
 *
 *   X = −10 + (20 / (N − 1)) · (N − rang)        pour l'intervalle [−10, 10]
 *
 * Le rang 1 tombe donc sur +10 et le rang N sur −10.
 */
import type { Range } from './types.ts';

export interface ScoredItem {
  code: string;
  score: number;
}

export const DEFAULT_RANGE: Range = [-10, 10];

/**
 * Compare deux codes comme Python compare deux chaînes (par points de code), sans tenir compte
 * de la locale : "10" < "7". Sert à départager les ex æquo de façon déterministe.
 */
export function compareCodes(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Rangs 1..N par score décroissant ; les ex æquo sont départagés par code croissant. */
export function rankDescending(items: readonly ScoredItem[]): Map<string, number> {
  const seen = new Set<string>();
  for (const it of items) {
    if (!Number.isFinite(it.score)) {
      throw new RangeError(`Score non fini pour la PCS ${it.code}`);
    }
    if (seen.has(it.code)) throw new Error(`Code PCS en double : ${it.code}`);
    seen.add(it.code);
  }
  const sorted = [...items].sort((a, b) => {
    if (a.score > b.score) return -1;
    if (a.score < b.score) return 1;
    return compareCodes(a.code, b.code);
  });
  const ranks = new Map<string, number>();
  sorted.forEach((it, i) => ranks.set(it.code, i + 1));
  return ranks;
}

/** Projette un rang (1..n) sur l'intervalle : lo + ((hi − lo)/(n − 1))·(n − rang). */
export function rankToCoord(rank: number, n: number, range: Range = DEFAULT_RANGE): number {
  const [lo, hi] = range;
  if (n <= 1) return (lo + hi) / 2;
  return lo + ((hi - lo) / (n - 1)) * (n - rank);
}

/** Coordonnée de chaque code sur un axe placé par rangs. */
export function rankCoords(
  items: readonly ScoredItem[],
  range: Range = DEFAULT_RANGE,
): Map<string, number> {
  const ranks = rankDescending(items);
  const coords = new Map<string, number>();
  for (const [code, rank] of ranks) coords.set(code, rankToCoord(rank, items.length, range));
  return coords;
}
