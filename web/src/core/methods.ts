/**
 * Méthodes de placement recalculables dans le navigateur (portage de pipeline/methods/).
 *
 * Une méthode client ne fait qu'une chose : projeter des scores bruts sur un axe (`placeAxis`).
 * computeLayout() s'occupe du reste : scores, parts de population, barycentre de la population,
 * coordonnées des PCS de niveau 1 et des électorats.
 *
 * Ajouter une méthode : appeler registerClientMethod({ id, label, ranked, placeAxis }) avec le même `id`
 * que dans config/methods.yaml, puis ajouter un cas de parité (pipeline/build.py, PARITY_METHODS).
 *
 * Origine de l'algorithme des rangs : voir les crédits du README.
 */
import {
  aggregateShares,
  compositionBarycenter,
  groupBarycenters,
  weightedBarycenter,
  type WeightedPoint,
} from './barycenter.ts';
import { DEFAULT_RANGE, rankCoords, type ScoredItem } from './ranks.ts';
import { computeScores, DEFAULT_Y_WEIGHTS, type ScoreOverride } from './scores.ts';
import {
  DIPLOMA_KEYS,
  type Composition,
  type DiplomaWeights,
  type Point,
  type Range,
  type RawPcsItem,
} from './types.ts';

/** Scores X reconnus côté client (config/methods.yaml, clé x_score). */
export const SUPPORTED_X_SCORES: readonly string[] = ['patrimoine_over_niveau_vie'];

/** Code PCS des retraités, à qui la méthode de référence impose un score Y. */
export const RETIRED_CODE = '7';

/** Paramètres d'une méthode, sous la forme de config/methods.yaml. */
export interface MethodParams {
  x_score: string;
  y_weights: DiplomaWeights;
  retired_y_override: ScoreOverride | null;
  /** Niveau PCS auquel les électorats sont placés (1 = groupes, 2 = PCS détaillées). */
  candidate_pcs_level: 1 | 2;
  /** Bornes des axes. */
  range: Range;
}

export interface ClientMethod {
  readonly id: string;
  readonly label: string;
  /** Vrai si le placement passe par des rangs : l'ordre des ex æquo y est alors arbitraire. */
  readonly ranked: boolean;
  /** Projette les scores bruts d'un axe sur l'intervalle `range`. */
  placeAxis(items: readonly ScoredItem[], range: Range): Map<string, number>;
}

const BASE_PARAMS: MethodParams = {
  x_score: 'patrimoine_over_niveau_vie',
  y_weights: { ...DEFAULT_Y_WEIGHTS },
  retired_y_override: null,
  candidate_pcs_level: 1,
  range: DEFAULT_RANGE,
};

/** Paramètres par défaut si les données n'en fournissent pas (miroir de config/methods.yaml). */
const DEFAULT_PARAMS: Record<string, MethodParams> = {
  ranks: { ...BASE_PARAMS, retired_y_override: { code: RETIRED_CODE, score: -180 } },
  continuous: { ...BASE_PARAMS },
};

export function cloneParams(p: MethodParams): MethodParams {
  return {
    ...p,
    y_weights: { ...p.y_weights },
    retired_y_override: p.retired_y_override ? { ...p.retired_y_override } : null,
  };
}

export function defaultParamsFor(methodId: string): MethodParams {
  return cloneParams(DEFAULT_PARAMS[methodId] ?? BASE_PARAMS);
}

/** Centre-réduit des valeurs (non pondéré, écart-type de population : ddof = 0). */
export function standardize(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((acc, v) => acc + v, 0) / n;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  return sd > 0 ? values.map((v) => (v - mean) / sd) : values.map(() => 0);
}

/**
 * Placement continu : z-scores puis mise à l'échelle min/max sur `range`. Le rapport est formé
 * d'abord, comme dans le pipeline : les extrêmes tombent exactement sur les bornes.
 */
export function continuousCoords(
  items: readonly ScoredItem[],
  range: Range = DEFAULT_RANGE,
): Map<string, number> {
  for (const it of items) {
    if (!Number.isFinite(it.score)) throw new RangeError(`Score non fini pour la PCS ${it.code}`);
  }
  const z = standardize(items.map((it) => it.score));
  const [lo, hi] = range;
  const mid = (lo + hi) / 2;
  const zmin = Math.min(...z);
  const zmax = Math.max(...z);
  const out = new Map<string, number>();
  items.forEach((it, i) => {
    const v = z[i] ?? 0;
    out.set(it.code, zmax > zmin ? lo + (hi - lo) * ((v - zmin) / (zmax - zmin)) : mid);
  });
  return out;
}

const registry = new Map<string, ClientMethod>();

/** Enregistre (ou remplace) une méthode calculable côté client. */
export function registerClientMethod(method: ClientMethod): void {
  registry.set(method.id, method);
}

export function getClientMethod(id: string): ClientMethod | undefined {
  return registry.get(id);
}

registerClientMethod({
  id: 'ranks',
  label: 'Rangs reconstruits',
  ranked: true,
  placeAxis: (items, range) => rankCoords(items, range),
});

registerClientMethod({
  id: 'continuous',
  label: 'Valeurs continues',
  ranked: false,
  placeAxis: (items, range) => continuousCoords(items, range),
});

/** Vrai si la méthode peut être recalculée dans le navigateur avec ces paramètres. */
export function isClientComputable(methodId: string, params: MethodParams): boolean {
  return registry.has(methodId) && SUPPORTED_X_SCORES.includes(params.x_score);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Lit un jeu de 7 poids ; null si une clé manque ou n'est pas un nombre fini. */
export function parseWeights(raw: unknown): DiplomaWeights | null {
  if (!isRecord(raw)) return null;
  const out = {} as DiplomaWeights;
  for (const k of DIPLOMA_KEYS) {
    const v = raw[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out;
}

function parseRange(raw: unknown): Range | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [lo, hi] = raw as unknown[];
  return typeof lo === 'number' && typeof hi === 'number' && hi > lo ? [lo, hi] : null;
}

function parseOverride(raw: unknown): ScoreOverride | null {
  if (!isRecord(raw)) return null;
  const { code, score } = raw;
  if ((typeof code !== 'string' && typeof code !== 'number') || typeof score !== 'number') {
    return null;
  }
  return Number.isFinite(score) ? { code: String(code), score } : null;
}

/**
 * Normalise des paramètres lus dans les données (champ `params` d'un fichier calculé, index.json
 * ou config/methods.yaml). Les clés absentes ou invalides reprennent la valeur de `fallback`.
 */
export function normalizeParams(raw: unknown, fallback: MethodParams = BASE_PARAMS): MethodParams {
  const r = isRecord(raw) ? raw : {};
  const level = r['candidate_pcs_level'];
  return {
    x_score: typeof r['x_score'] === 'string' ? r['x_score'] : fallback.x_score,
    y_weights: parseWeights(r['y_weights']) ?? { ...fallback.y_weights },
    retired_y_override:
      'retired_y_override' in r
        ? parseOverride(r['retired_y_override'])
        : fallback.retired_y_override
          ? { ...fallback.retired_y_override }
          : null,
    candidate_pcs_level: level === 1 || level === 2 ? level : fallback.candidate_pcs_level,
    range: parseRange(r['range']) ?? fallback.range,
  };
}

/** Électorats à placer : seuls les identifiants des candidats et la composition comptent. */
export interface LayoutElection {
  candidates: readonly { id: string }[];
  composition: Composition;
  /** Niveau PCS des clés de composition ; déduit des clés s'il est absent. */
  pcs_level?: 1 | 2;
}

export interface LayoutInput {
  pcs: readonly RawPcsItem[];
  election?: LayoutElection | null;
}

export interface LayoutPcs extends Point {
  code: string;
  group: string;
  /** Part de la population (%). */
  weight: number;
}

export interface LayoutCandidate extends Point {
  id: string;
}

export interface Layout {
  pcs: LayoutPcs[];
  candidates: LayoutCandidate[];
  population_barycenter: Point;
  /** Coordonnées des PCS de niveau 1. */
  groups: Map<string, Point>;
}

/**
 * Niveau des clés d'une composition : 2 dès qu'une clé est un code PCS détaillé qui n'est pas
 * aussi un code de groupe (« 7 », retraités, est les deux à la fois).
 */
export function detectCompositionLevel(
  composition: Composition,
  items: readonly { code: string; group: string }[],
): 1 | 2 {
  const groups = new Set(items.map((i) => i.group));
  const codes = new Set(items.map((i) => i.code));
  for (const shares of Object.values(composition)) {
    for (const key of Object.keys(shares)) {
      if (codes.has(key) && !groups.has(key)) return 2;
    }
  }
  return 1;
}

type PcsPoint = WeightedPoint & { code: string; group: string };

/**
 * Barycentre de chaque électorat : sur les PCS détaillées si la méthode ET la composition sont de
 * niveau 2, sinon sur les groupes (une composition de niveau 2 est alors sommée par groupe). Un
 * candidat de poids total nul est omis.
 */
function placeCandidates(
  election: LayoutElection,
  pcs: readonly PcsPoint[],
  groups: ReadonlyMap<string, Point>,
  params: MethodParams,
): LayoutCandidate[] {
  const byCode = new Map<string, Point>(pcs.map((p) => [p.code, { x: p.x, y: p.y }]));
  const groupOf = new Map<string, string>(pcs.map((p) => [p.code, p.group]));
  const keyLevel = election.pcs_level ?? detectCompositionLevel(election.composition, pcs);
  const useCodes = params.candidate_pcs_level === 2 && keyLevel === 2;
  const out: LayoutCandidate[] = [];
  for (const c of election.candidates) {
    const shares = election.composition[c.id];
    if (!shares) continue;
    const pos = useCodes
      ? compositionBarycenter(shares, byCode)
      : compositionBarycenter(keyLevel === 2 ? aggregateShares(shares, groupOf) : shares, groups);
    if (pos) out.push({ id: c.id, x: pos.x, y: pos.y });
  }
  return out;
}

/** Calcule toutes les coordonnées d'une méthode client à partir des données brutes. */
export function computeLayout(methodId: string, params: MethodParams, input: LayoutInput): Layout {
  const method = registry.get(methodId);
  if (!method) throw new Error(`Méthode non recalculable dans le navigateur : ${methodId}`);
  if (!SUPPORTED_X_SCORES.includes(params.x_score)) {
    throw new Error(`Score X non pris en charge côté client : ${params.x_score}`);
  }
  if (input.pcs.length === 0) throw new Error('Aucune PCS dans les données brutes');

  const range = params.range;
  const scores = computeScores(input.pcs, params.y_weights, params.retired_y_override);
  const xs = method.placeAxis(
    scores.map((s) => ({ code: s.code, score: s.x })),
    range,
  );
  const ys = method.placeAxis(
    scores.map((s) => ({ code: s.code, score: s.y })),
    range,
  );

  const total = input.pcs.reduce((acc, it) => acc + it.population, 0);
  const points: PcsPoint[] = input.pcs.map((it) => ({
    code: it.code,
    group: it.group,
    x: xs.get(it.code) ?? Number.NaN,
    y: ys.get(it.code) ?? Number.NaN,
    weight: it.population,
  }));
  const pcs: LayoutPcs[] = points.map((p) => ({
    code: p.code,
    group: p.group,
    x: p.x,
    y: p.y,
    weight: total > 0 ? (100 * p.weight) / total : 0,
  }));

  const mid = (range[0] + range[1]) / 2;
  const population_barycenter = weightedBarycenter(points) ?? { x: mid, y: mid };
  const groups = groupBarycenters(points);
  const candidates = input.election ? placeCandidates(input.election, points, groups, params) : [];
  return { pcs, candidates, population_barycenter, groups };
}
