/**
 * Comparer des électorats : voisins, duel, et le cas où la carte trompe. Sur la carte, un électorat
 * est un barycentre : deux compositions très différentes peuvent tomber au même endroit.
 *
 * Module pur, testé dans compare.test.ts.
 */
import { compositionByGroup, compositionGap } from './crossing.ts';
import type { Point, RawElection } from './types.ts';

/** En dessous de cet écart (unités de la carte), deux électorats paraissent voisins. */
const NEAR_ON_MAP = 0.5;
/** Au-dessus de cet écart (points), leur composition diffère nettement. */
const FAR_IN_COMPOSITION = 15;

export interface Neighbor {
  id: string;
  /** Écart de composition (points). */
  gap: number;
  /** Distance sur la carte (unités du graphique). */
  distance: number;
}

/** Les autres électorats, du plus ressemblant au moins ressemblant. */
export function neighbors(
  election: RawElection,
  id: string,
  positions: ReadonlyMap<string, Point>,
  groupOf?: (code: string) => string,
): Neighbor[] {
  const self = positions.get(id);
  if (!self) return [];
  const shares = compositionByGroup(election, id, groupOf);
  const out: Neighbor[] = [];
  for (const c of election.candidates) {
    const at = positions.get(c.id);
    if (c.id === id || !at) continue;
    out.push({
      id: c.id,
      gap: compositionGap(shares, compositionByGroup(election, c.id, groupOf)),
      distance: Math.hypot(at.x - self.x, at.y - self.y),
    });
  }
  return out.sort((a, b) => a.gap - b.gap);
}

/** Vrai si deux électorats sont voisins sur la carte sans se ressembler. */
export function misleadinglyClose(distance: number, gap: number): boolean {
  return distance < NEAR_ON_MAP && gap >= FAR_IN_COMPOSITION;
}

export interface DuelRow {
  key: string;
  a: number;
  b: number;
}

/** Lignes d'un duel, des plus grands écarts aux plus petits. */
export function duelRows(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): DuelRow[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .map((key) => ({ key, a: a[key] ?? 0, b: b[key] ?? 0 }))
    .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b));
}
