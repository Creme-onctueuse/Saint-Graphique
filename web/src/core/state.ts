/**
 * État de l'application, sérialisé dans le fragment de l'URL (#e=…&m=…) pour pouvoir partager
 * une vue. Le fragment fonctionne aussi en file:// et sur GitHub Pages, sans rechargement.
 *
 * Clés : e = élection, m = méthode, h = candidat masqué (répétable), g = groupe PCS masqué
 * (répétable), w = poids des diplômes (7 nombres séparés par « _ », ordre DIPLOMA_KEYS),
 * r = score Y imposé aux retraités (nombre ou « off »), t = thème (light|dark),
 * lbl=0 = libellés masqués, ci=0 = ellipses masquées.
 */
import { DIPLOMA_KEYS, type DiplomaWeights } from './types.ts';

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Score Y imposé aux retraités : valeur de la méthode, désactivé, ou valeur choisie. */
export type RetiredSetting = 'default' | 'off' | number;

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
    showEllipses: true,
  };
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
  if (!s.showEllipses) add('ci', '0');
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
  s.showEllipses = params.get('ci') !== '0';
  return normalizeState(s);
}
