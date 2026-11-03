/**
 * Axes libres : place les catégories Insee selon deux variables au choix, et les électorats au
 * barycentre de leurs groupes. Chaque variable est ramenée linéairement de son minimum à son maximum
 * sur l'intervalle de la carte, sans rang : les écarts réels restent visibles.
 *
 * Module pur, testé dans freeAxes.test.ts.
 */
import { compositionBarycenter, weightedBarycenter, type WeightedPoint } from './barycenter.ts';
import { compositionByGroup } from './crossing.ts';
import type { Point, Range, RawElection, RawPcsItem } from './types.ts';
import type { Variable } from './variables.ts';

/** Nombre de classes de la couleur : au-delà, des classes voisines ne se distinguent plus. */
export const COLOR_CLASSES = 5;

export interface FreeAxis {
  variable: Variable;
  min: number;
  max: number;
  /** Position sur la carte → valeur réelle de la variable. */
  valueAt(position: number): number;
}

export interface FreePcs extends Point {
  code: string;
  group: string;
  /** Part de la population (%), parmi les catégories placées. */
  weight: number;
  /** Classe de couleur (1 à COLOR_CLASSES), ou null sans variable de couleur. */
  colorClass: number | null;
  /** Valeur imputée pour l'une des variables affichées. */
  imputed: boolean;
}

export interface FreeLayout {
  x: FreeAxis;
  y: FreeAxis;
  color: { variable: Variable; min: number; max: number } | null;
  pcs: FreePcs[];
  candidates: Map<string, Point>;
  barycenter: Point | null;
  /** Catégories écartées faute de valeur pour l'une des variables. */
  omitted: number;
}

function axisOf(variable: Variable, values: readonly number[], range: Range): FreeAxis {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const [lo, hi] = range;
  return {
    variable,
    min,
    max,
    valueAt: (position) => min + ((position - lo) / (hi - lo)) * (max - min),
  };
}

function place(value: number, axis: FreeAxis, range: Range): number {
  const [lo, hi] = range;
  if (axis.max === axis.min) return (lo + hi) / 2;
  return lo + ((value - axis.min) / (axis.max - axis.min)) * (hi - lo);
}

/** Classe de 1 à COLOR_CLASSES, sur des intervalles égaux entre le minimum et le maximum. */
export function colorClassOf(value: number, min: number, max: number): number {
  if (max <= min) return 1;
  const t = (value - min) / (max - min);
  return Math.min(COLOR_CLASSES, Math.floor(t * COLOR_CLASSES) + 1);
}

/**
 * Coordonnées de chaque clé des tableaux de sondage. La plupart des sondages n'isolent pas les
 * agriculteurs : si le groupe 1 manque au tableau, la clé « 2 » réunit les groupes 1 et 2.
 */
export function pollCoordinates(
  points: readonly (WeightedPoint & { group: string })[],
  election: RawElection,
  groupOf: (code: string) => string,
): Map<string, Point> {
  const keys = new Set<string>();
  for (const c of election.candidates) {
    for (const key of Object.keys(compositionByGroup(election, c.id, groupOf))) keys.add(key);
  }
  const mergeFarmers = keys.has('2') && !keys.has('1');
  const byKey = new Map<string, WeightedPoint[]>();
  for (const p of points) {
    const key = mergeFarmers && p.group === '1' ? '2' : p.group;
    const list = byKey.get(key);
    if (list) list.push(p);
    else byKey.set(key, [p]);
  }
  const out = new Map<string, Point>();
  for (const [key, list] of byKey) {
    const b = weightedBarycenter(list);
    if (b) out.set(key, b);
  }
  return out;
}

export interface FreeInput {
  items: readonly RawPcsItem[];
  election: RawElection | null;
  xVariable: Variable;
  yVariable: Variable;
  colorVariable: Variable | null;
  range: Range;
  groupOf?: (code: string) => string;
}

/** Calcule la carte ; null s'il reste moins de deux catégories avec les deux valeurs. */
export function computeFreeLayout(input: FreeInput): FreeLayout | null {
  const { items, election, xVariable, yVariable, colorVariable, range } = input;
  const groupOf = input.groupOf ?? ((code: string): string => code);
  const rows = items.flatMap((item) => {
    const vx = xVariable.read(item);
    const vy = yVariable.read(item);
    return vx === null || vy === null
      ? []
      : [{ item, vx, vy, vc: colorVariable?.read(item) ?? null }];
  });
  if (rows.length < 2) return null;

  const x = axisOf(
    xVariable,
    rows.map((r) => r.vx),
    range,
  );
  const y = axisOf(
    yVariable,
    rows.map((r) => r.vy),
    range,
  );
  const colorValues = rows.flatMap((r) => (r.vc === null ? [] : [r.vc]));
  const color =
    colorVariable && colorValues.length > 0
      ? {
          variable: colorVariable,
          min: Math.min(...colorValues),
          max: Math.max(...colorValues),
        }
      : null;

  const total = rows.reduce((acc, r) => acc + r.item.population, 0);
  const shown = [xVariable, yVariable, ...(colorVariable ? [colorVariable] : [])];
  const pcs: FreePcs[] = rows.map((r) => ({
    code: r.item.code,
    group: r.item.group,
    x: place(r.vx, x, range),
    y: place(r.vy, y, range),
    weight: total > 0 ? (100 * r.item.population) / total : 0,
    colorClass: color && r.vc !== null ? colorClassOf(r.vc, color.min, color.max) : null,
    imputed: shown.some((v) => v.imputed) && r.item.patrimoine_composition_status === 'imputed',
  }));

  const points = pcs.map((p, i) => ({
    x: p.x,
    y: p.y,
    group: p.group,
    weight: rows[i]?.item.population ?? 0,
  }));
  const candidates = new Map<string, Point>();
  if (election) {
    const coords = pollCoordinates(points, election, groupOf);
    for (const c of election.candidates) {
      const position = compositionBarycenter(compositionByGroup(election, c.id, groupOf), coords);
      if (position) candidates.set(c.id, position);
    }
  }
  return {
    x,
    y,
    color,
    pcs,
    candidates,
    barycenter: weightedBarycenter(points),
    omitted: items.length - rows.length,
  };
}
