/**
 * Échelle d'un axe libre : comment une valeur devient une position sur la carte.
 *
 * Une variable très inégale, comme le patrimoine, tasse presque toutes les catégories dans un coin
 * dès qu'une seule s'en écarte. Le logarithme rend comparables des rapports, le rang ne garde que
 * l'ordre. Dans les deux cas, les graduations restent des valeurs réelles.
 *
 * Module pur, testé dans axisScale.test.ts.
 */
import type { Range } from './types.ts';

export const AXIS_SCALES = ['linear', 'log', 'rank'] as const;
export type AxisScale = (typeof AXIS_SCALES)[number];

/** Une échelle établie sur les valeurs d'une variable. */
export interface ScaleMapping {
  scale: AxisScale;
  toPosition(value: number): number;
  toValue(position: number): number;
}

/** Le logarithme ne montre ni zéro ni valeur négative : on le refuse plutôt que de les déplacer. */
export function logIsPossible(values: readonly number[]): boolean {
  return values.length > 0 && values.every((v) => v > 0);
}

/** Interpolation par morceaux, bornée aux extrémités. `xs` est croissant. */
function interpolate(xs: readonly number[], ys: readonly number[], x: number): number {
  const last = xs.length - 1;
  if (x <= (xs[0] ?? 0)) return ys[0] ?? 0;
  if (x >= (xs[last] ?? 0)) return ys[last] ?? 0;
  let i = 1;
  while (i < last && (xs[i] ?? 0) < x) i++;
  const x0 = xs[i - 1] ?? 0;
  const x1 = xs[i] ?? 0;
  const y0 = ys[i - 1] ?? 0;
  const y1 = ys[i] ?? 0;
  return x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

/** Échelle qui passe par une fonction monotone (identité ou logarithme). */
function monotone(
  scale: AxisScale,
  min: number,
  max: number,
  [lo, hi]: Range,
  forward: (v: number) => number,
  backward: (t: number) => number,
): ScaleMapping {
  const from = forward(min);
  const span = forward(max) - from;
  return {
    scale,
    toPosition: (value) =>
      span === 0 ? (lo + hi) / 2 : lo + ((forward(value) - from) / span) * (hi - lo),
    toValue: (position) => backward(from + ((position - lo) / (hi - lo)) * span),
  };
}

/** Rang parmi les valeurs : des valeurs égales partagent le même rang, moyen. */
function rankMapping(values: readonly number[], [lo, hi]: Range): ScaleMapping {
  const sorted = [...values].sort((a, b) => a - b);
  const knotValues: number[] = [];
  const knotRanks: number[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[i]) j++;
    knotValues.push(sorted[i] ?? 0);
    knotRanks.push((i + j) / 2);
    i = j + 1;
  }
  const first = knotRanks[0] ?? 0;
  const span = (knotRanks[knotRanks.length - 1] ?? 0) - first;
  return {
    scale: 'rank',
    toPosition: (value) =>
      span === 0
        ? (lo + hi) / 2
        : lo + ((interpolate(knotValues, knotRanks, value) - first) / span) * (hi - lo),
    toValue: (position) =>
      interpolate(knotRanks, knotValues, first + ((position - lo) / (hi - lo)) * span),
  };
}

/** Établit l'échelle sur les valeurs. Le logarithme suppose `logIsPossible(values)`. */
export function scaleMapping(
  scale: AxisScale,
  values: readonly number[],
  range: Range,
): ScaleMapping {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (scale === 'rank') return rankMapping(values, range);
  if (scale === 'log') return monotone('log', min, max, range, Math.log, Math.exp);
  return monotone(
    'linear',
    min,
    max,
    range,
    (v) => v,
    (t) => t,
  );
}

const BOUND_TOLERANCE = 1e-9;

/** Du plus espacé au plus serré : on prend le premier qui donne assez de graduations. */
const LOG_STEPS: readonly (readonly number[])[] = [
  [1],
  [1, 2, 5],
  [1, 2, 3, 5, 7],
  [1, 2, 3, 4, 5, 6, 7, 8, 9],
];

/**
 * Valeurs rondes à graduer entre `lo` et `hi` sur une échelle logarithmique. Null si aucune série n'en
 * donne au moins trois : à fort zoom, l'appelant gradue à intervalles réguliers.
 */
export function logTickValues(lo: number, hi: number, count: number): number[] | null {
  if (!(lo > 0) || hi <= lo) return null;
  const first = Math.floor(Math.log10(lo));
  const last = Math.ceil(Math.log10(hi));
  for (const steps of LOG_STEPS) {
    const values: number[] = [];
    for (let e = first; e <= last; e++) {
      for (const m of steps) {
        const v = Number((m * 10 ** e).toPrecision(6));
        // Tolérance : exp(log(1000)) tombe juste sous 1000, et la graduation du bord se perdrait.
        if (v >= lo * (1 - BOUND_TOLERANCE) && v <= hi * (1 + BOUND_TOLERANCE)) values.push(v);
      }
    }
    if (values.length >= 3 && values.length <= count * 2) return values;
  }
  return null;
}
