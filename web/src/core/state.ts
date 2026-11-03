/**
 * État de l'application, sérialisé dans le fragment de l'URL (#e=…&m=…) pour pouvoir partager
 * une vue. Le fragment fonctionne aussi en file:// et sur GitHub Pages, sans rechargement.
 *
 * Clés : e = élection, m = méthode, h = candidat masqué (répétable), g = groupe PCS masqué
 * (répétable), w = poids des diplômes (7 nombres séparés par « _ », ordre DIPLOMA_KEYS),
 * r = score Y imposé aux retraités (nombre ou « off »), t = thème (light|dark),
 * lbl=0 = libellés masqués, ci=1 = ellipses de confiance affichées, bs = mesure de l'aire des bulles,
 * s = repère sélectionné (p:… ou c:…), c2 = repère comparé, p = panneau ouvert, sq=1 = proportions
 * d'origine, tr=0 = trajectoires masquées, rg=1 = anneaux de vote, ty = type d'élection du filtre,
 * sc=trend = scénario de la projection (à cette étape seulement), ax, ay, ac = variables libres des axes et de la couleur,
 * vue=prox = carte de proximité.
 */
import { DIPLOMA_KEYS, PROJECTION_ID, type DiplomaWeights } from './types.ts';

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Score Y imposé aux retraités : valeur de la méthode, désactivé, ou valeur choisie. */
export type RetiredSetting = 'default' | 'off' | number;

export const PANELS = ['electorates', 'categories', 'cross', 'game', 'method', 'data'] as const;
export type PanelId = (typeof PANELS)[number];

export const TYPE_FILTERS = ['all', 'presidentielle', 'legislatives', 'europeennes'] as const;
export type TypeFilter = (typeof TYPE_FILTERS)[number];

export type Scenario = 'still' | 'trend';
export type MapLayout = 'map' | 'proximity';

export interface AppState {
  /** null = élection par défaut. */
  election: string | null;
  /** null = méthode par défaut. */
  method: string | null;
  hiddenCandidates: string[];
  hiddenGroups: string[];
  /** null = poids de la méthode. */
  weights: DiplomaWeights | null;
  retired: RetiredSetting;
  theme: ThemeChoice;
  showLabels: boolean;
  showEllipses: boolean;
  /** Ce que mesure l'aire des bulles (core/bubbleSize.ts) ; null = part des inscrits. */
  bubbleSize: string | null;
  /** Repère sélectionné : `p:<code>` ou `c:<id>`. */
  selected: string | null;
  /** Second repère, pour un duel. */
  compared: string | null;
  panel: PanelId | null;
  /** Proportions d'origine : zone de tracé carrée. */
  square: boolean;
  showTrails: boolean;
  showRings: boolean;
  typeFilter: TypeFilter;
  scenario: Scenario;
  /** Variables libres : null = axes du Saint-Graphique. */
  axisX: string | null;
  axisY: string | null;
  colorBy: string | null;
  layout: MapLayout;
}

export function defaultState(): AppState {
  return {
    election: null,
    method: null,
    hiddenCandidates: [],
    hiddenGroups: [],
    weights: null,
    retired: 'default',
    theme: 'system',
    showLabels: true,
    showEllipses: false,
    bubbleSize: null,
    selected: null,
    compared: null,
    panel: null,
    square: false,
    showTrails: true,
    showRings: false,
    typeFilter: 'all',
    scenario: 'still',
    axisX: null,
    axisY: null,
    colorBy: null,
    layout: 'map',
  };
}

/** Axes libres ou carte de proximité : la carte ne suit plus les axes de la méthode. */
export function hasCustomLayout(s: Pick<AppState, 'axisX' | 'axisY' | 'layout'>): boolean {
  return s.layout === 'proximity' || s.axisX !== null || s.axisY !== null;
}

function uniqSorted(list: readonly string[]): string[] {
  return [...new Set(list.filter((s) => s !== ''))].sort();
}

/** -0 devient 0 pour que l'aller-retour texte soit exact. */
function clean(n: number): number {
  return n === 0 ? 0 : n;
}

function cleanWeights(w: DiplomaWeights | null): DiplomaWeights | null {
  if (!w) return null;
  const out = {} as DiplomaWeights;
  for (const k of DIPLOMA_KEYS) {
    const v = w[k];
    if (!Number.isFinite(v)) return null;
    out[k] = clean(v);
  }
  return out;
}

/** Forme canonique : listes triées sans doublon, nombres finis. */
export function normalizeState(s: AppState): AppState {
  let retired: RetiredSetting = s.retired;
  if (typeof retired === 'number') retired = Number.isFinite(retired) ? clean(retired) : 'default';
  return {
    election: s.election || null,
    method: s.method || null,
    hiddenCandidates: uniqSorted(s.hiddenCandidates),
    hiddenGroups: uniqSorted(s.hiddenGroups),
    weights: cleanWeights(s.weights),
    retired,
    theme: s.theme,
    showLabels: s.showLabels,
    showEllipses: s.showEllipses,
    bubbleSize: s.bubbleSize || null,
    selected: s.selected || null,
    compared: s.selected ? s.compared || null : null,
    panel: s.panel,
    square: s.square,
    showTrails: s.showTrails,
    showRings: s.showRings,
    typeFilter: s.typeFilter,
    scenario: s.scenario,
    axisX: s.axisX || null,
    axisY: s.axisY || null,
    colorBy: s.colorBy || null,
    layout: s.layout,
  };
}

/** Sérialise l'état en chaîne de requête (sans « # »). Les valeurs par défaut sont omises. */
export function serializeState(state: AppState): string {
  const s = normalizeState(state);
  const parts: string[] = [];
  const add = (key: string, value: string): void => {
    parts.push(`${key}=${encodeURIComponent(value)}`);
  };
  if (s.election) add('e', s.election);
  if (s.method) add('m', s.method);
  for (const id of s.hiddenCandidates) add('h', id);
  for (const g of s.hiddenGroups) add('g', g);
  const w = s.weights;
  if (w) add('w', DIPLOMA_KEYS.map((k) => String(w[k])).join('_'));
  if (s.retired !== 'default') add('r', s.retired === 'off' ? 'off' : String(s.retired));
  if (s.theme !== 'system') add('t', s.theme);
  if (!s.showLabels) add('lbl', '0');
  if (s.showEllipses) add('ci', '1');
  if (s.bubbleSize) add('bs', s.bubbleSize);
  if (s.selected) add('s', s.selected);
  if (s.compared) add('c2', s.compared);
  if (s.panel) add('p', s.panel);
  if (s.square) add('sq', '1');
  if (!s.showTrails) add('tr', '0');
  if (s.showRings) add('rg', '1');
  if (s.typeFilter !== 'all') add('ty', s.typeFilter);
  if (s.scenario !== 'still' && s.election === PROJECTION_ID) add('sc', s.scenario);
  if (s.axisX) add('ax', s.axisX);
  if (s.axisY) add('ay', s.axisY);
  if (s.colorBy) add('ac', s.colorBy);
  if (s.layout === 'proximity') add('vue', 'prox');
  return parts.join('&');
}

function parseNumber(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function parseWeightList(text: string): DiplomaWeights | null {
  const parts = text.split('_');
  if (parts.length !== DIPLOMA_KEYS.length) return null;
  const out = {} as DiplomaWeights;
  for (let i = 0; i < DIPLOMA_KEYS.length; i++) {
    const n = parseNumber(parts[i] ?? '');
    const key = DIPLOMA_KEYS[i];
    if (n === null || key === undefined) return null;
    out[key] = n;
  }
  return out;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.find((a) => a === value) ?? null;
}

/** Lit l'état depuis un fragment (« #… ») ou une chaîne de requête (« ?… »). Tolérant. */
export function parseState(input: string): AppState {
  const params = new URLSearchParams(input.replace(/^[#?]/, ''));
  const s = defaultState();
  s.election = params.get('e') || null;
  s.method = params.get('m') || null;
  s.hiddenCandidates = params.getAll('h');
  s.hiddenGroups = params.getAll('g');
  const w = params.get('w');
  if (w) s.weights = parseWeightList(w);
  const r = params.get('r');
  if (r === 'off') s.retired = 'off';
  else if (r !== null) s.retired = parseNumber(r) ?? 'default';
  const t = params.get('t');
  if (t === 'light' || t === 'dark') s.theme = t;
  s.showLabels = params.get('lbl') !== '0';
  s.showEllipses = params.get('ci') === '1';
  s.bubbleSize = params.get('bs') || null;
  s.selected = params.get('s') || null;
  s.compared = params.get('c2') || null;
  s.panel = oneOf(params.get('p'), PANELS);
  s.square = params.get('sq') === '1';
  s.showTrails = params.get('tr') !== '0';
  s.showRings = params.get('rg') === '1';
  s.typeFilter = oneOf(params.get('ty'), TYPE_FILTERS) ?? 'all';
  s.scenario = params.get('sc') === 'trend' ? 'trend' : 'still';
  s.axisX = params.get('ax') || null;
  s.axisY = params.get('ay') || null;
  s.colorBy = params.get('ac') || null;
  s.layout = params.get('vue') === 'prox' ? 'proximity' : 'map';
  return normalizeState(s);
}
