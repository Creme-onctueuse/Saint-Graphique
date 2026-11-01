/**
 * Barycentres pondérés : population, PCS de niveau 1, électorats.
 */
import type { Point } from './types.ts';

export interface WeightedPoint extends Point {
  weight: number;
}

/**
 * Barycentre Σ(w·p) / Σw. Les poids nuls, négatifs ou non numériques sont ignorés.
 * Renvoie null si aucun poids n'est strictement positif.
 */
export function weightedBarycenter(points: Iterable<WeightedPoint>): Point | null {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    if (!(p.weight > 0)) continue;
    sw += p.weight;
    sx += p.weight * p.x;
    sy += p.weight * p.y;
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : null;
}

/**
 * Coordonnées des PCS de niveau 1 : barycentre, pondéré par la population, des PCS de niveau 2
 * de chaque groupe.
 */
export function groupBarycenters(
  items: Iterable<WeightedPoint & { group: string }>,
): Map<string, Point> {
  const byGroup = new Map<string, WeightedPoint[]>();
  for (const it of items) {
    let list = byGroup.get(it.group);
    if (!list) {
      list = [];
      byGroup.set(it.group, list);
    }
    list.push(it);
  }
  const out = new Map<string, Point>();
  for (const [group, list] of byGroup) {
    const b = weightedBarycenter(list);
    if (b) out.set(group, b);
  }
  return out;
}

/**
 * Position d'un électorat : barycentre des coordonnées connues, pondéré par les parts de la
 * composition. Les clés sans coordonnées (ex. « 8 », autres inactifs) sont ignorées et les parts
 * restantes renormalisées.
 */
export function compositionBarycenter(
  shares: Readonly<Record<string, number>>,
  coords: ReadonlyMap<string, Point>,
): Point | null {
  const points: WeightedPoint[] = [];
  for (const [key, weight] of Object.entries(shares)) {
    const c = coords.get(key);
    if (c) points.push({ x: c.x, y: c.y, weight });
  }
  return weightedBarycenter(points);
}

/** Agrège une composition de niveau 2 (codes PCS) en niveau 1 (groupes). */
export function aggregateShares(
  shares: Readonly<Record<string, number>>,
  groupOf: ReadonlyMap<string, string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, share] of Object.entries(shares)) {
    const g = groupOf.get(code);
    if (g === undefined || !(share > 0)) continue;
    out[g] = (out[g] ?? 0) + share;
  }
  return out;
}
