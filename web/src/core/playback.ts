/**
 * Lecture de la frise : où se trouve chaque électorat à un instant donné entre deux scrutins.
 * Un parti garde son identité d'une élection à l'autre (`trackKey`) : son repère glisse au lieu de
 * s'effacer. Un électorat sans équivalent grandit ou fond sur place.
 *
 * Module pur, testé dans playback.test.ts.
 */
import type { ChartCandidate } from '../chart/types.ts';

function keyOf(c: ChartCandidate): string {
  return c.trackKey ?? c.id;
}

/** Aire de la bulle, en points ; 0 pour un électorat sans taille connue. */
export function sizeOf(c: ChartCandidate): number {
  return c.sizeShare ?? c.registeredShare ?? c.share ?? 0;
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** Électorats à l'instant `u` (0 : scrutin de départ ; 1 : scrutin d'arrivée). */
export function interpolateMarks(
  from: readonly ChartCandidate[],
  to: readonly ChartCandidate[],
  u: number,
): ChartCandidate[] {
  const t = Math.max(0, Math.min(1, u));
  const before = new Map(from.map((c) => [keyOf(c), c]));
  const after = new Map(to.map((c) => [keyOf(c), c]));
  const out: ChartCandidate[] = [];
  for (const b of to) {
    const a = before.get(keyOf(b));
    if (a) {
      const base = t < 0.5 ? a : b;
      out.push({
        ...base,
        label: b.trackLabel ?? base.label,
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        sizeShare: lerp(sizeOf(a), sizeOf(b), t),
        alpha: 1,
      });
    } else {
      out.push({
        ...b,
        label: b.trackLabel ?? b.label,
        sizeShare: lerp(0, sizeOf(b), t),
        alpha: t,
      });
    }
  }
  for (const a of from) {
    if (after.has(keyOf(a))) continue;
    out.push({
      ...a,
      label: a.trackLabel ?? a.label,
      sizeShare: lerp(sizeOf(a), 0, t),
      alpha: 1 - t,
    });
  }
  return out;
}
