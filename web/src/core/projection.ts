/**
 * Projection 2027 : lecture des fichiers de scripts/analyze/projection.py et textes à afficher.
 * Deux scénarios, « rien ne bouge » et « la tendance continue », et le résultat du test sur le passé,
 * toujours montré avec eux. La page ne calcule rien ici : elle lit le fichier.
 *
 * Module pur, testé dans projection.test.ts.
 */
import { formatNumber } from './format.ts';
import type { Scenario } from './state.ts';
import type { Point } from './types.ts';

export interface BacktestRow {
  phi: number;
  n: number;
  position_mean: number;
  position_worst: number;
  score_mean: number;
  score_worst: number;
}

export type ScenarioErrors = Omit<BacktestRow, 'phi'>;

export interface ProjectedPoint {
  id: string;
  label: string;
  last_election: string;
  points: number;
  still: Point;
  trend: Point;
  error: Record<Scenario, ScenarioErrors>;
}

export interface ProjectedFamily extends ProjectedPoint {
  color: string;
}

export interface ProjectedBloc extends ProjectedPoint {
  /** Faux pour l'abstention, projetée mais hors du tableau du test. */
  tested: boolean;
  score_range: Record<Scenario, [number, number]>;
}

export interface ProjectionFile {
  method: string;
  target: { label: string; date: number };
  /** Dernier scrutin couvert, au format AAAA-MM. */
  data_end: string;
  min_history: number;
  backtest: {
    parties: BacktestRow[];
    blocs: BacktestRow[];
    verdict: { trend_worse_position: boolean; trend_worse_score: boolean };
  };
  families: ProjectedFamily[];
  blocs: ProjectedBloc[];
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';

function isPoint(v: unknown): v is Point {
  return isRec(v) && isNum(v['x']) && isNum(v['y']);
}

function isErrors(v: unknown): boolean {
  return (
    isRec(v) &&
    isNum(v['n']) &&
    isNum(v['position_mean']) &&
    isNum(v['position_worst']) &&
    isNum(v['score_mean']) &&
    isNum(v['score_worst'])
  );
}

function isRange(v: unknown): boolean {
  return Array.isArray(v) && v.length === 2 && v.every(isNum);
}

function isProjected(v: unknown): v is Rec {
  return (
    isRec(v) &&
    isStr(v['id']) &&
    isStr(v['label']) &&
    isPoint(v['still']) &&
    isPoint(v['trend']) &&
    isRec(v['error']) &&
    isErrors(v['error']['still']) &&
    isErrors(v['error']['trend'])
  );
}

function isRow(v: unknown): boolean {
  return isErrors(v) && isNum((v as Rec)['phi']);
}

/** Valide un fichier de projection ; un fichier incomplet est écarté en entier. */
export function asProjectionFile(v: unknown): ProjectionFile | null {
  if (!isRec(v) || !isStr(v['method']) || !isStr(v['data_end'])) return null;
  const target = v['target'];
  const backtest = v['backtest'];
  if (!isRec(target) || !isStr(target['label']) || !isNum(target['date'])) return null;
  if (!isRec(backtest) || !isRec(backtest['verdict'])) return null;
  const { parties, blocs: blocRows } = backtest;
  if (!Array.isArray(parties) || !parties.every(isRow)) return null;
  if (!Array.isArray(blocRows) || !blocRows.every(isRow)) return null;
  const families = v['families'];
  const blocs = v['blocs'];
  if (!Array.isArray(families) || !Array.isArray(blocs)) return null;
  if (!families.every((f) => isProjected(f) && isStr(f['color']))) return null;
  const blocOk = (b: unknown): boolean =>
    isProjected(b) &&
    isRec(b['score_range']) &&
    isRange(b['score_range']['still']) &&
    isRange(b['score_range']['trend']);
  if (!blocs.every(blocOk)) return null;
  return v as unknown as ProjectionFile;
}

export function scenarioPoint(p: ProjectedPoint, scenario: Scenario): Point {
  return p[scenario];
}

export function scenarioError(p: ProjectedPoint, scenario: Scenario): ScenarioErrors {
  return p.error[scenario];
}

/** Ligne du tableau pour une dose de tendance. */
export function backtestRow(rows: readonly BacktestRow[], phi: number): BacktestRow | null {
  return rows.find((r) => r.phi === phi) ?? null;
}

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** « 2024-07 » devient « juillet 2024 ». */
export function formatDataEnd(value: string): string {
  const [year, month] = value.split('-');
  const name = MONTHS[Number(month) - 1];
  return name && year ? `${name} ${year}` : value;
}

/** Noms des deux scénarios, partout où ils sont affichés. */
export const SCENARIO_LABELS: Readonly<Record<Scenario, string>> = {
  still: 'Rien ne bouge',
  trend: 'La tendance continue',
};

/** Ce que disent la flèche et le cercle sur la carte : le nombre de prédictions vient du fichier. */
export function projectionMarks(file: Pick<ProjectionFile, 'families'>): string {
  const counts = file.families.map((f) => f.error.still.n);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const span = min === max ? `${min}` : `${min} à ${max}`;
  return (
    'Flèche : de « rien ne bouge » à « la tendance continue ». Cercle en pointillés : erreur moyenne ' +
    `de ce parti sur le passé, sur ${span} prédictions.`
  );
}

export interface VerdictText {
  headline: string;
  /** Ce que comparent les deux lignes suivantes. */
  comparison: string;
  position: string;
  score: string;
  dataEnd: string;
}

function headlineOf(file: ProjectionFile): string {
  const { trend_worse_position: position, trend_worse_score: score } = file.backtest.verdict;
  if (position && score) {
    return 'Testé sur le passé : la tendance prédit moins bien que « rien ne bouge »';
  }
  if (position) {
    return 'Testé sur le passé : la tendance place moins bien les électorats que « rien ne bouge »';
  }
  if (score) {
    return 'Testé sur le passé : la tendance prédit moins bien les scores que « rien ne bouge »';
  }
  return 'Testé sur le passé : la tendance ne fait pas moins bien que « rien ne bouge »';
}

/** Compare la tendance entière et « rien ne bouge » : « 0,81 contre 0,62 (partis) ». */
function compared(
  file: ProjectionFile,
  key: 'position_mean' | 'score_mean',
  digits: number,
): string {
  const line = (rows: readonly BacktestRow[], scope: string): string => {
    const trend = backtestRow(rows, 1);
    const still = backtestRow(rows, 0);
    if (!trend || !still) return '';
    return `${formatNumber(trend[key], digits)} contre ${formatNumber(still[key], digits)} (${scope})`;
  };
  return [line(file.backtest.parties, 'partis'), line(file.backtest.blocs, 'blocs')]
    .filter(Boolean)
    .join(', ');
}

/** Textes du résultat du test : tous les chiffres viennent du fichier. */
export function verdictText(file: ProjectionFile): VerdictText {
  return {
    headline: headlineOf(file),
    comparison: 'Erreur moyenne, tendance contre « rien ne bouge » :',
    position: compared(file, 'position_mean', 2),
    score: compared(file, 'score_mean', 1),
    dataEnd: `Données arrêtées en ${formatDataEnd(file.data_end)}.`,
  };
}

/** Le résultat du test en une ligne, pour le détail des réserves et les exports. */
export function verdictSentence(file: ProjectionFile): string {
  const t = verdictText(file);
  return `${t.headline}. ${t.comparison} position ${t.position} ; score ${t.score}. ${t.dataEnd}`;
}
