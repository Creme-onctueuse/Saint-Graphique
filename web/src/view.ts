/**
 * Passage de l'état de l'application au modèle affiché : choix de la méthode et de l'élection,
 * paramètres effectifs, coordonnées précalculées ou recalculées dans le navigateur.
 *
 * Règle : tant que les poids ne sont pas modifiés, on affiche les coordonnées précalculées (avec
 * leurs ellipses). Si l'utilisateur les modifie, ou si le fichier précalculé manque, on recalcule à
 * partir des données brutes quand elles sont disponibles.
 *
 * Module pur (sans DOM), testé dans view.test.ts.
 */
import type { ChartCandidate, ChartModel, ChartPcs } from './chart/chart.ts';
import {
  computeLayout,
  defaultParamsFor,
  getClientMethod,
  isClientComputable,
  normalizeParams,
  RETIRED_CODE,
  type Layout,
  type MethodParams,
} from './core/methods.ts';
import {
  countStatuses,
  findTies,
  parseStatus,
  READ_POSITIONS_METHOD,
  COMPUTED_RESERVE_SUMMARY,
  READ_POSITIONS_RESERVE,
  READ_POSITIONS_RESERVE_SUMMARY,
  X_DEFINITION_RESERVE,
  xAxisReserve,
  type Tie,
} from './core/reserves.ts';
import { computeScores, sameWeights } from './core/scores.ts';
import type { AppState } from './core/state.ts';
import {
  POPULATION_ID,
  type ComputedFile,
  type Point,
  type RawCandidate,
  type RawElection,
  type SourceRef,
} from './core/types.ts';
import { computedKey, type Dataset, type MethodInfo } from './data/dataset.ts';
import { applyCrossing, type CrossingInfo } from './viewCrossing.ts';

const NEUTRAL_COLOR = '#888888';

export interface ResolvedView {
  method: MethodInfo;
  electionId: string;
  electionLabel: string;
  isPopulation: boolean;
  model: ChartModel;
  source: 'precomputed' | 'client';
  /** Paramètres de la méthode, avant réglages de l'utilisateur. */
  defaults: MethodParams;
  /** Paramètres effectifs. */
  params: MethodParams;
  customized: boolean;
  /** Vrai si les poids peuvent être recalculés dans le navigateur pour cette vue. */
  canRecompute: boolean;
  /** Raison de l'indisponibilité du recalcul. */
  recomputeBlock: string | null;
  hasEllipses: boolean;
  rawElection: RawElection | null;
  /** Informations à montrer à l'utilisateur. */
  notes: string[];
  /** Réserves complètes, à une ouverture de clic. */
  reserves: string[];
  /** Réserve résumée en une ligne, visible en permanence. */
  reserveSummary: string;
  /** Sources lues dans les données brutes : sondage de l'élection, données sur les PCS. */
  sources: { poll: SourceRef[]; pcs: SourceRef[]; positions: SourceRef[] };
  /** Axes libres, carte de proximité, sélection : voir viewCrossing.ts. */
  crossing?: CrossingInfo;
}

/** Méthodes utilisables : avec fichiers précalculés, ou recalculables depuis les données brutes. */
export function availableMethods(ds: Dataset): MethodInfo[] {
  return ds.methods.filter(
    (m) =>
      m.elections.size > 0 ||
      (ds.rawPcs !== null &&
        isClientComputable(m.id, normalizeParams(m.params, defaultParamsFor(m.id)))),
  );
}

/** Élection par défaut : la dernière présidentielle, sinon la dernière élection, sinon la population. */
export function defaultElection(ds: Dataset): string {
  const list = ds.elections;
  const presidential = list.filter((e) => e.type === 'presidentielle');
  const pick = presidential.at(-1) ?? list.at(-1);
  return pick?.id ?? POPULATION_ID;
}

export function resolveMethod(ds: Dataset, state: AppState): MethodInfo | null {
  const methods = availableMethods(ds);
  return (
    methods.find((m) => m.id === state.method) ??
    methods.find((m) => m.id === ds.defaultMethod) ??
    methods[0] ??
    null
  );
}

export function resolveElection(ds: Dataset, state: AppState): string {
  const id = state.election;
  if (id === POPULATION_ID) return id;
  if (id && ds.elections.some((e) => e.id === id)) return id;
  return defaultElection(ds);
}

/** Un fichier quelconque de la méthode : seules ses PCS servent quand l'élection manque. */
function anyFileOf(ds: Dataset, methodId: string): ComputedFile | null {
  const population = ds.computed.get(computedKey(methodId, POPULATION_ID));
  if (population) return population;
  for (const file of ds.computed.values()) if (file.method === methodId) return file;
  return null;
}

/** Paramètres de référence : ceux du fichier affiché, sinon index.json ou la configuration. */
export function methodDefaults(method: MethodInfo, file: ComputedFile | null): MethodParams {
  const base = normalizeParams(method.params, defaultParamsFor(method.id));
  return file && Object.keys(file.params).length > 0 ? normalizeParams(file.params, base) : base;
}

/** Applique les réglages de l'utilisateur aux paramètres de référence. */
export function effectiveParams(
  defaults: MethodParams,
  state: Pick<AppState, 'weights' | 'retired'>,
): { params: MethodParams; customized: boolean } {
  const y_weights = state.weights ?? defaults.y_weights;
  let retired = defaults.retired_y_override;
  if (state.retired === 'off') retired = null;
  else if (typeof state.retired === 'number') {
    retired = { code: defaults.retired_y_override?.code ?? RETIRED_CODE, score: state.retired };
  }
  const base = defaults.retired_y_override;
  const retiredChanged =
    (base === null) !== (retired === null) ||
    (base !== null && retired !== null && base.score !== retired.score);
  return {
    params: { ...defaults, y_weights: { ...y_weights }, retired_y_override: retired },
    customized: !sameWeights(y_weights, defaults.y_weights) || retiredChanged,
  };
}

function groupLabel(ds: Dataset, code: string): string {
  return ds.groups.get(code)?.label ?? `Groupe ${code}`;
}

type PcsExtras = (code: string) => Pick<ChartPcs, 'status' | 'notes'>;

function nameList(names: readonly string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} et ${names.at(-1) ?? ''}`;
}

function axisName(ds: Dataset, tie: Tie): string {
  return tie.axis === 'x' ? ds.axes.xLabel : ds.axes.yLabel;
}

/** Ex æquo de la méthode affichée, calculés depuis les scores et les poids effectifs. */
function tiesOf(ds: Dataset, method: MethodInfo, params: MethodParams): Tie[] {
  if (!ds.rawPcs || !isClientComputable(method.id, params)) return [];
  try {
    return findTies(computeScores(ds.rawPcs.items, params.y_weights, params.retired_y_override));
  } catch {
    return [];
  }
}

function pcsName(ds: Dataset, code: string): string {
  return ds.pcsMeta.get(code)?.short ?? code;
}

function tieReserve(ds: Dataset, tie: Tie, ranked: boolean): string {
  const names = nameList(tie.codes.map((c) => pcsName(ds, c)));
  const consequence = ranked
    ? 'leur ordre est arbitraire (départage par code PCS)'
    : 'elles ont donc la même position sur cet axe';
  return `Ex æquo sur l'axe ${axisName(ds, tie)} : ${names} ont le même score ; ${consequence}.`;
}

function tieNote(ds: Dataset, tie: Tie, code: string, ranked: boolean): string {
  const others = nameList(tie.codes.filter((c) => c !== code).map((c) => pcsName(ds, c)));
  const consequence = ranked
    ? 'ordre arbitraire (départage par code PCS)'
    : 'même position sur cet axe';
  return `Ex æquo sur l'axe ${axisName(ds, tie)} avec ${others} : ${consequence}.`;
}

function pcsFromFile(ds: Dataset, file: ComputedFile, extras: PcsExtras): ChartPcs[] {
  return file.pcs.map((p) => {
    const meta = ds.pcsMeta.get(p.code);
    const extra = extras(p.code);
    return {
      code: p.code,
      group: p.group,
      label: p.label,
      short: p.short ?? meta?.short ?? p.label,
      groupLabel: groupLabel(ds, p.group),
      color: ds.groups.get(p.group)?.color ?? NEUTRAL_COLOR,
      x: p.x,
      y: p.y,
      weight: p.weight,
      ...extra,
      notes: p.note ? [...extra.notes, p.note] : extra.notes,
    };
  });
}

function pcsFromLayout(ds: Dataset, layout: Layout, extras: PcsExtras): ChartPcs[] {
  return layout.pcs.map((p) => {
    const meta = ds.pcsMeta.get(p.code);
    const label = meta?.label ?? p.code;
    return {
      code: p.code,
      group: p.group,
      label,
      short: meta?.short ?? label,
      groupLabel: groupLabel(ds, p.group),
      color: ds.groups.get(p.group)?.color ?? NEUTRAL_COLOR,
      x: p.x,
      y: p.y,
      weight: p.weight,
      ...extras(p.code),
    };
  });
}

/** Composition d'un électorat par groupe de niveau 1, des parts les plus fortes aux plus faibles. */
export function compositionOf(
  ds: Dataset,
  election: RawElection | null,
  candidateId: string,
): { label: string; share: number }[] | null {
  const shares = election?.composition[candidateId];
  if (!election || !shares) return null;
  const totals = new Map<string, number>();
  for (const [key, share] of Object.entries(shares)) {
    if (!(share > 0)) continue;
    const code = election.pcs_level === 2 ? (ds.pcsMeta.get(key)?.group ?? key) : key;
    totals.set(code, (totals.get(code) ?? 0) + share);
  }
  return [...totals.entries()]
    .map(([code, share]) => ({ label: groupLabel(ds, code), share }))
    .sort((a, b) => b.share - a.share);
}

function candidateFromRaw(
  ds: Dataset,
  election: RawElection,
  c: RawCandidate,
  x: number,
  y: number,
): ChartCandidate {
  return {
    id: c.id,
    label: c.label,
    color: c.color,
    x,
    y,
    share: c.national_share_pct ?? null,
    isAbstention: c.is_abstention === true,
    ellipse: null,
    composition: compositionOf(ds, election, c.id),
  };
}

/** Construit la vue affichée ; null si aucune donnée n'est utilisable. */
export function buildView(ds: Dataset, state: AppState): ResolvedView | null {
  const method = resolveMethod(ds, state);
  if (!method) return null;
  const electionId = resolveElection(ds, state);
  const isPopulation = electionId === POPULATION_ID;
  const notes: string[] = [];

  const exact = ds.computed.get(computedKey(method.id, electionId)) ?? null;
  const fallbackFile = exact ?? anyFileOf(ds, method.id);
  const defaults = methodDefaults(method, fallbackFile);
  const { params, customized } = effectiveParams(defaults, state);
  const rawElection = isPopulation ? null : (ds.rawElections.get(electionId) ?? null);

  let recomputeBlock: string | null = null;
  if (!isClientComputable(method.id, defaults)) {
    recomputeBlock = 'Cette méthode n’est pas recalculable dans le navigateur.';
  } else if (!ds.rawPcs) {
    recomputeBlock =
      'Données brutes absentes : seules les coordonnées précalculées sont affichées.';
  } else if (!isPopulation && !rawElection) {
    recomputeBlock = 'Composition brute de cette élection absente : recalcul impossible.';
  }
  const canRecompute = recomputeBlock === null;

  let layout: Layout | null = null;
  if (canRecompute && ds.rawPcs && (customized || !exact)) {
    try {
      layout = computeLayout(method.id, params, { pcs: ds.rawPcs.items, election: rawElection });
    } catch (err) {
      notes.push(`Recalcul impossible : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (customized && !canRecompute && recomputeBlock) notes.push(recomputeBlock);

  const electionLabel = isPopulation
    ? ds.populationLabel
    : (ds.elections.find((e) => e.id === electionId)?.label ?? electionId);

  // Réserves : statuts comptés dans les données brutes, ex æquo calculés depuis les scores.
  const rawItems = new Map((ds.rawPcs?.items ?? []).map((it) => [it.code, it]));
  const ties = tiesOf(ds, method, params);
  const ranked = getClientMethod(method.id)?.ranked ?? false;
  const isRead = method.id === READ_POSITIONS_METHOD;
  const extras: PcsExtras = (code) => {
    if (isRead) return { status: null, notes: [] };
    const raw = rawItems.get(code);
    return {
      status: {
        patrimoine: parseStatus(raw?.patrimoine_status),
        niveauVie: parseStatus(raw?.niveau_vie_status),
      },
      notes: ties.filter((t) => t.codes.includes(code)).map((t) => tieNote(ds, t, code, ranked)),
    };
  };
  const axisReserve = xAxisReserve(
    ds.rawPcs ? countStatuses(ds.rawPcs.items) : null,
    ds.axes.xLabel,
  );
  const reserves = isRead
    ? [READ_POSITIONS_RESERVE]
    : [
        X_DEFINITION_RESERVE,
        ...(axisReserve ? [axisReserve] : []),
        ...ties.map((t) => tieReserve(ds, t, ranked)),
      ];

  let pcs: ChartPcs[];
  let candidates: ChartCandidate[] = [];
  let barycenter: Point | null;
  let range: [number, number];
  if (layout) {
    pcs = pcsFromLayout(ds, layout, extras);
    barycenter = layout.population_barycenter;
    range = [params.range[0], params.range[1]];
    if (rawElection) {
      for (const lc of layout.candidates) {
        const raw = rawElection.candidates.find((c) => c.id === lc.id);
        if (raw) candidates.push(candidateFromRaw(ds, rawElection, raw, lc.x, lc.y));
      }
    }
    if (customized) notes.push('Coordonnées recalculées dans le navigateur avec vos poids.');
    if (customized && !isPopulation) {
      notes.push('Ellipses de confiance masquées : elles ne valent que pour les poids d’origine.');
    }
  } else if (fallbackFile) {
    pcs = pcsFromFile(ds, fallbackFile, extras);
    barycenter = fallbackFile.population_barycenter;
    range = fallbackFile.axes.range;
    if (exact) {
      candidates = exact.candidates.map((c) => ({
        id: c.id,
        label: c.label,
        color: c.color,
        x: c.x,
        y: c.y,
        share: c.national_share_pct ?? null,
        isAbstention: c.is_abstention === true,
        ellipse: c.ellipse ?? null,
        composition: compositionOf(ds, rawElection, c.id),
      }));
    } else if (!isPopulation) {
      notes.push('Cette méthode ne couvre pas cette élection : seules les PCS sont affichées.');
    }
  } else {
    return null;
  }

  const model: ChartModel = {
    title: `${electionLabel}, méthode ${method.label}`,
    description:
      `Nuage de ${pcs.length} catégories socioprofessionnelles` +
      (candidates.length > 0 ? ` et de ${candidates.length} électorats` : '') +
      ` sur deux axes : ${ds.axes.xLabel} en abscisse, ${ds.axes.yLabel} en ordonnée.`,
    xLabel: ds.axes.xLabel,
    yLabel: ds.axes.yLabel,
    range,
    pcs,
    candidates,
    barycenter,
  };

  return applyCrossing(ds, state, {
    method,
    electionId,
    electionLabel,
    isPopulation,
    model,
    source: layout ? 'client' : 'precomputed',
    defaults,
    params,
    customized,
    canRecompute,
    recomputeBlock,
    hasEllipses: candidates.some((c) => c.ellipse !== null),
    rawElection,
    notes,
    reserves,
    reserveSummary: isRead ? READ_POSITIONS_RESERVE_SUMMARY : COMPUTED_RESERVE_SUMMARY,
    sources: {
      poll: rawElection?.sources ?? [],
      pcs: ds.rawPcs?.sources ?? [],
      positions: fallbackFile?.sources ?? [],
    },
  });
}
