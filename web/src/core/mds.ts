/**
 * Positionnement multidimensionnel classique : place des points dans le plan pour que leurs distances
 * ressemblent à une matrice d'écarts donnée. Double centrage, puis les deux premiers vecteurs propres
 * par la méthode de la puissance, déterministe (même entrée, même carte).
 *
 * Module pur, testé dans mds.test.ts.
 */
import type { Point } from './types.ts';

export interface MdsResult {
  points: Point[];
  /** Part de l'information conservée par les deux dimensions (0 à 1). */
  explained: number;
}

type Matrix = number[][];

const MAX_ITERATIONS = 500;
const TOLERANCE = 1e-10;

function multiply(m: Matrix, v: readonly number[]): number[] {
  return m.map((row) => row.reduce((sum, value, j) => sum + value * (v[j] ?? 0), 0));
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0);
}

/** Vecteur de départ fixe, non orthogonal en pratique aux vecteurs propres utiles. */
function startVector(n: number, seed: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.sin(1 + (i + 1) * (seed + 1.37)));
}

/** Plus grande valeur propre (en valeur absolue) et son vecteur unitaire. */
function powerIteration(m: Matrix, seed: number): { value: number; vector: number[] } {
  const n = m.length;
  let v = startVector(n, seed);
  let norm = Math.sqrt(dot(v, v));
  v = v.map((x) => x / norm);
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const next = multiply(m, v);
    norm = Math.sqrt(dot(next, next));
    if (norm < TOLERANCE) return { value: 0, vector: v };
    const unit = next.map((x) => x / norm);
    const change = unit.reduce((sum, x, i) => sum + Math.abs(x - (v[i] ?? 0)), 0);
    v = unit;
    if (change < TOLERANCE) break;
  }
  return { value: dot(v, multiply(m, v)), vector: v };
}

/** Matrice des produits scalaires : −½ J D² J. */
function doubleCentered(distances: Matrix): Matrix {
  const n = distances.length;
  const squared = distances.map((row) => row.map((d) => d * d));
  const rowMeans = squared.map((row) => row.reduce((a, b) => a + b, 0) / n);
  const grand = rowMeans.reduce((a, b) => a + b, 0) / n;
  return squared.map((row, i) =>
    row.map((value, j) => -0.5 * (value - (rowMeans[i] ?? 0) - (rowMeans[j] ?? 0) + grand)),
  );
}

export function classicalMds(distances: Matrix): MdsResult {
  const n = distances.length;
  if (n === 0) return { points: [], explained: 1 };
  if (n === 1) return { points: [{ x: 0, y: 0 }], explained: 1 };

  const b = doubleCentered(distances);
  const trace = b.reduce((sum, row, i) => sum + (row[i] ?? 0), 0);

  const first = powerIteration(b, 0);
  const deflated = b.map((row, i) =>
    row.map((value, j) => value - first.value * (first.vector[i] ?? 0) * (first.vector[j] ?? 0)),
  );
  const second = powerIteration(deflated, 1);

  const scale1 = Math.sqrt(Math.max(0, first.value));
  const scale2 = Math.sqrt(Math.max(0, second.value));
  const points = Array.from({ length: n }, (_, i) => ({
    x: (first.vector[i] ?? 0) * scale1,
    y: (second.vector[i] ?? 0) * scale2,
  }));
  const kept = Math.max(0, first.value) + Math.max(0, second.value);
  return { points, explained: trace > 0 ? Math.min(1, kept / trace) : 1 };
}

function covariance(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n === 0) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  return a.reduce((s, v, i) => s + (v - ma) * ((b[i] ?? 0) - mb), 0);
}

/**
 * Oriente la carte, dont le sens des axes est arbitraire : chaque dimension va dans le sens d'une
 * référence. La carte ne se retourne donc pas d'une élection à l'autre.
 */
export function orient(
  points: readonly Point[],
  refX: readonly number[],
  refY: readonly number[],
): Point[] {
  const sx =
    covariance(
      points.map((p) => p.x),
      refX,
    ) < 0
      ? -1
      : 1;
  const sy =
    covariance(
      points.map((p) => p.y),
      refY,
    ) < 0
      ? -1
      : 1;
  return points.map((p) => ({ x: sx * p.x, y: sy * p.y }));
}

/** Même facteur sur les deux axes : les distances restent comparables. */
export function fitToRange(points: readonly Point[], limit: number): Point[] {
  const extent = Math.max(0, ...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  if (extent === 0) return points.map((p) => ({ ...p }));
  const k = limit / extent;
  return points.map((p) => ({ x: p.x * k, y: p.y * k }));
}

/** Matrice symétrique d'écarts entre éléments. */
export function distanceMatrix<T>(items: readonly T[], gap: (a: T, b: T) => number): Matrix {
  const n = items.length;
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = items[i];
      const c = items[j];
      if (a === undefined || c === undefined) continue;
      const d = gap(a, c);
      const row = out[i];
      const other = out[j];
      if (row) row[j] = d;
      if (other) other[i] = d;
    }
  }
  return out;
}
