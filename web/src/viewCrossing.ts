/**
 * Ce que le croisement des données change à la vue : axes libres, carte de proximité, vue depuis un
 * groupe, repères sélectionnés et estompage. S'applique à la fin de buildView (view.ts).
 *
 * Module pur (sans DOM), testé dans viewCrossing.test.ts.
 */
import type { ChartCandidate, ChartModel, ChartPcs } from './chart/types.ts';
import { bubbleSizeLabel, bubbleSizes, parseBubbleSize } from './core/bubbleSize.ts';
import { compositionByGroup, compositionGap, pollGroupOf, voteByGroup } from './core/crossing.ts';
import { computeFreeLayout, type FreeLayout } from './core/freeAxes.ts';
import { classicalMds, distanceMatrix, fitToRange, orient } from './core/mds.ts';
import { hasCustomLayout, type AppState } from './core/state.ts';
import { availableVariables, type Variable } from './core/variables.ts';
import type { Dataset } from './data/dataset.ts';
import type { ResolvedView } from './view.ts';

export type CrossingMode = 'map' | 'free' | 'proximity';

export type SelectedItem =
  | { kind: 'candidate'; key: string; candidate: ChartCandidate }
  | { kind: 'pcs'; key: string; pcs: ChartPcs };

export interface GroupVoteRow {
  id: string;
  label: string;
  color: string;
  share: number;
  isAbstention: boolean;
}

/** Vue depuis un groupe : le vote du groupe de la catégorie sélectionnée. */
export interface LensInfo {
  /** Groupe du sondage, ou null si le sondage ne couvre pas ce groupe. */
  pollGroup: string | null;
  /** Vrai si le groupe du sondage réunit agriculteurs et indépendants. */
  merged: boolean;
  rows: GroupVoteRow[];
}

export interface CrossingInfo {
  /** Ce que mesure l'aire des bulles, en toutes lettres. */
  sizeLabel: string;
  mode: CrossingMode;
  selected: SelectedItem | null;
  compared: SelectedItem | null;
  /** Clés des repères sélectionnés, pour la carte. */
  keys: string[];
  /** Repères mis en avant, les autres s'estompent ; null : rien n'est estompé. */
  focus: ReadonlySet<string> | null;
  lens: LensInfo | null;
  /** Nom de la famille sélectionnée quand elle n'a pas d'électorat à cette élection. */
  absent: string | null;
  free: FreeLayout | null;
  /** Part de l'information conservée par la carte de proximité (0 à 1). */
  explained: number | null;
  /** Axes libres ou proximité demandés, en attente : la projection garde les axes de sa méthode. */
  suspended: boolean;
  groupOf: (code: string) => string;
}

const DEFAULT_AXIS_X = 'patrimoine';
const DEFAULT_AXIS_Y = 'bac5';
/** Coordonnée la plus éloignée sur la carte de proximité : laisse de la place aux libellés. */
const PROXIMITY_EXTENT = 9;
/** Groupes de référence qui orientent la carte de proximité : retraités à droite, cadres en haut. */
const ORIENT_X_GROUP = '7';
const ORIENT_Y_GROUP = '3';

const PROXIMITY_RESERVE_SUMMARY =
  'Carte de proximité : distance = écart de composition, sans axes, sur six groupes de sondage';

function freeReserve(items: number, imputed: number, shown: readonly Variable[]): string {
  const flagged = shown.filter((v) => v.imputed);
  return (
    `Axes libres : ces ${items} catégories et leurs valeurs viennent de l'Insee, sans les positions ` +
    'lues sur les vidéos de Chris. Chaque axe va linéairement du minimum au maximum de sa variable. ' +
    'Les électorats sont des barycentres de groupes : une proximité entre groupes ne dit rien des ' +
    'personnes.' +
    (flagged.length > 0
      ? ` Variable à prendre avec prudence : ${flagged.map((v) => v.label.toLowerCase()).join(', ')}. ` +
        `Les parts du patrimoine sont imputées pour ${imputed} catégories sur ${items}.`
      : '')
  );
}

function proximityReserve(explained: number): string {
  const pct = Math.round(explained * 100);
  return (
    'Carte de proximité : les électorats sont placés pour que leur éloignement reflète leur écart ' +
    'de composition, sur les six groupes des sondages (positionnement multidimensionnel classique). ' +
    `Le plan conserve ${pct} % de cette information : deux électorats peuvent donc être plus différents ` +
    "qu'ils n'en ont l'air. Ces directions n'ont pas de nom : il n'y a ni axe ni graduation. Le sens " +
    'de la carte est seulement choisi pour rester stable : plus de retraités à droite, plus de cadres ' +
    'en haut.'
  );
}

function groupOfFn(ds: Dataset): (code: string) => string {
  return (code) => ds.pcsMeta.get(code)?.group ?? code;
}

function withMethod(
  view: ResolvedView,
  label: string,
  description: string,
): ResolvedView['method'] {
  return { ...view.method, label, description };
}

function applyFree(
  ds: Dataset,
  state: AppState,
  view: ResolvedView,
): { view: ResolvedView; layout: FreeLayout } | null {
  const items = ds.rawPcs?.items;
  if (!items) return null;
  const available = availableVariables(items);
  const pick = (id: string | null, fallback: string): Variable | undefined =>
    available.find((v) => v.id === id) ?? available.find((v) => v.id === fallback) ?? available[0];
  const xVariable = pick(state.axisX, DEFAULT_AXIS_X);
  const yVariable = pick(state.axisY, DEFAULT_AXIS_Y);
  if (!xVariable || !yVariable) return null;
  const color = available.find((v) => v.id === state.colorBy) ?? null;
  const groupOf = groupOfFn(ds);
  const layout = computeFreeLayout({
    items,
    election: view.rawElection,
    xVariable,
    yVariable,
    colorVariable: color,
    range: view.model.range,
    groupOf,
  });
  if (!layout) return null;

  const pcs: ChartPcs[] = layout.pcs.map((p) => {
    const meta = ds.pcsMeta.get(p.code);
    const label = meta?.label ?? p.code;
    const group = ds.groups.get(p.group);
    return {
      code: p.code,
      group: p.group,
      label,
      short: meta?.short ?? label,
      groupLabel: group?.label ?? `Groupe ${p.group}`,
      color: group?.color ?? '#888888',
      x: p.x,
      y: p.y,
      weight: p.weight,
      status: null,
      notes: p.imputed ? ['Valeur imputée pour la composition du patrimoine.'] : [],
      ...(p.colorClass === null ? {} : { fill: `var(--sg-seq-${p.colorClass})` }),
    };
  });
  const candidates: ChartCandidate[] = view.model.candidates.flatMap((c) => {
    const at = layout.candidates.get(c.id);
    return at ? [{ ...c, x: at.x, y: at.y, ellipse: null }] : [];
  });
  const axisLabel = (v: Variable): string => (v.imputed ? `${v.label} (≈ imputé)` : v.label);
  const model: ChartModel = {
    ...view.model,
    title: `${view.electionLabel}, axes libres`,
    description:
      `Nuage de ${pcs.length} catégories socioprofessionnelles` +
      (candidates.length > 0 ? ` et de ${candidates.length} électorats` : '') +
      ` : ${xVariable.label} en abscisse, ${yVariable.label} en ordonnée.`,
    xLabel: axisLabel(xVariable),
    yLabel: axisLabel(yVariable),
    pcs,
    candidates,
    barycenter: layout.barycenter,
    axes: {
      plain: true,
      ends: {
        xLow: xVariable.format(layout.x.min),
        xHigh: xVariable.format(layout.x.max),
        yLow: yVariable.format(layout.y.min),
        yHigh: yVariable.format(layout.y.max),
      },
      text: {
        x: (position) => xVariable.format(layout.x.valueAt(position)),
        y: (position) => yVariable.format(layout.y.valueAt(position)),
      },
    },
  };
  const imputed = items.filter((it) => it.patrimoine_composition_status === 'imputed').length;
  const shown = [xVariable, yVariable, ...(color ? [color] : [])];
  return {
    layout,
    view: {
      ...view,
      method: withMethod(
        view,
        'Axes libres',
        'Axes libres : la méthode de placement ne joue pas ici, les valeurs viennent directement de l’Insee.',
      ),
      model,
      canRecompute: false,
      recomputeBlock: 'Ces réglages ne s’appliquent pas aux axes libres.',
      customized: false,
      hasEllipses: false,
      reserves: [freeReserve(items.length, imputed, shown)],
      reserveSummary: `Axes libres : ${pcs.length} catégories Insee, à lire à l’échelle des groupes`,
      sources: { ...view.sources, positions: [] },
    },
  };
}

function applyProximity(
  ds: Dataset,
  view: ResolvedView,
): { view: ResolvedView; explained: number } | null {
  const election = view.rawElection;
  if (!election || view.model.candidates.length < 3) return null;
  const groupOf = groupOfFn(ds);
  const candidates = view.model.candidates;
  const shares = candidates.map((c) => compositionByGroup(election, c.id, groupOf));
  const { points, explained } = classicalMds(distanceMatrix(shares, compositionGap));
  const placed = fitToRange(
    orient(
      points,
      shares.map((s) => s[ORIENT_X_GROUP] ?? 0),
      shares.map((s) => s[ORIENT_Y_GROUP] ?? 0),
    ),
    PROXIMITY_EXTENT,
  );
  const model: ChartModel = {
    ...view.model,
    title: `${view.electionLabel}, carte de proximité`,
    description:
      `Carte de proximité de ${candidates.length} électorats : ` +
      'plus deux électorats sont proches, plus leur composition sociale se ressemble.',
    xLabel: '',
    yLabel: '',
    pcs: [],
    candidates: candidates.map((c, i) => ({
      ...c,
      x: placed[i]?.x ?? 0,
      y: placed[i]?.y ?? 0,
      ellipse: null,
    })),
    barycenter: null,
    axes: { plain: true, none: true },
  };
  return {
    explained,
    view: {
      ...view,
      method: withMethod(
        view,
        'Carte de proximité',
        'Carte de proximité : la méthode de placement ne joue pas ici, seule compte la composition des électorats.',
      ),
      model,
      canRecompute: false,
      recomputeBlock: 'Ces réglages ne s’appliquent pas à la carte de proximité.',
      customized: false,
      hasEllipses: false,
      reserves: [proximityReserve(explained)],
      reserveSummary: PROXIMITY_RESERVE_SUMMARY,
      sources: { ...view.sources, positions: [] },
    },
  };
}

/** Électorat d'une clé : celui de cette élection, ou celui de la même famille à une autre élection. */
function resolveCandidate(
  ds: Dataset,
  view: ResolvedView,
  id: string,
): { candidate: ChartCandidate | null; family: string | null } {
  const direct = view.model.candidates.find((c) => c.id === id);
  if (direct) return { candidate: direct, family: null };
  const family = ds.families?.families.find((f) => [...f.candidates.values()].includes(id));
  if (!family) return { candidate: null, family: null };
  const mapped = family.candidates.get(view.electionId);
  return {
    candidate: view.model.candidates.find((c) => c.id === mapped) ?? null,
    family: family.label,
  };
}

function resolveItem(
  ds: Dataset,
  view: ResolvedView,
  key: string | null,
): { item: SelectedItem | null; absent: string | null } {
  if (!key) return { item: null, absent: null };
  const id = key.slice(2);
  if (key.startsWith('c:')) {
    const { candidate, family } = resolveCandidate(ds, view, id);
    return candidate
      ? { item: { kind: 'candidate', key: `c:${candidate.id}`, candidate }, absent: null }
      : { item: null, absent: family };
  }
  if (key.startsWith('p:')) {
    const pcs = view.model.pcs.find((p) => p.code === id);
    return { item: pcs ? { kind: 'pcs', key, pcs } : null, absent: null };
  }
  return { item: null, absent: null };
}

/** Vote du groupe qui couvre une catégorie ; null sans élection. */
export function lensForPcs(
  view: ResolvedView,
  pcs: ChartPcs,
  groupOf: (code: string) => string,
): LensInfo | null {
  const election = view.rawElection;
  if (!election) return null;
  const { votes } = voteByGroup(election, groupOf);
  const available = new Set(votes.keys());
  const pollGroup = pollGroupOf(pcs.group, available);
  if (pollGroup === null) return { pollGroup: null, merged: false, rows: [] };
  const row = votes.get(pollGroup);
  const rows: GroupVoteRow[] = view.model.candidates
    .map((c) => ({
      id: c.id,
      label: c.label,
      color: c.color,
      share: row?.get(c.id) ?? 0,
      isAbstention: c.isAbstention,
    }))
    .sort((a, b) => b.share - a.share);
  return { pollGroup, merged: pollGroup === '2' && !available.has('1'), rows };
}

/** Les catégories que couvre un groupe du sondage. */
function membersOf(
  pcs: readonly ChartPcs[],
  election: ResolvedView['rawElection'],
  group: string,
  groupOf: (code: string) => string,
): string[] {
  const available = election
    ? new Set(voteByGroup(election, groupOf).votes.keys())
    : new Set<string>();
  const poll = pollGroupOf(group, available);
  return pcs
    .filter((p) => (poll === null ? p.group === group : pollGroupOf(p.group, available) === poll))
    .map((p) => `p:${p.code}`);
}

function focusOf(
  view: ResolvedView,
  selected: SelectedItem | null,
  compared: SelectedItem | null,
  groupOf: (code: string) => string,
): ReadonlySet<string> | null {
  if (!selected) return null;
  if (selected.kind === 'candidate') {
    return new Set([selected.key, ...(compared ? [compared.key] : [])]);
  }
  const keys = new Set<string>(view.model.candidates.map((c) => `c:${c.id}`));
  for (const item of [selected, compared]) {
    if (item?.kind !== 'pcs') continue;
    for (const key of membersOf(view.model.pcs, view.rawElection, item.pcs.group, groupOf)) {
      keys.add(key);
    }
  }
  return keys;
}

export function applyCrossing(ds: Dataset, state: AppState, base: ResolvedView): ResolvedView {
  const groupOf = groupOfFn(ds);
  let view = base;
  let mode: CrossingMode = 'map';
  let free: FreeLayout | null = null;
  let explained: number | null = null;
  // La projection prolonge des positions sur les axes de la méthode : sans composition, elle n'a pas
  // de place sur d'autres axes. Le croisement attend le prochain scrutin, sans se perdre.
  const suspended = base.projection !== null && hasCustomLayout(state);
  if (suspended) {
    // La carte reste celle de la méthode.
  } else if (state.layout === 'proximity') {
    const result = applyProximity(ds, base);
    if (result) {
      view = result.view;
      explained = result.explained;
      mode = 'proximity';
    }
  } else if (state.axisX || state.axisY) {
    const result = applyFree(ds, state, base);
    if (result) {
      view = result.view;
      free = result.layout;
      mode = 'free';
    }
  }

  const first = resolveItem(ds, view, state.selected);
  const second = resolveItem(ds, view, state.compared);
  const selected = first.item;
  const compared = selected && second.item?.key !== selected.key ? second.item : null;

  // Le panneau Croiser choisit ce que mesure l'aire des bulles.
  const measure = parseBubbleSize(state.bubbleSize, crossVariables(ds));
  let sizeLabel = bubbleSizeLabel(measure);
  const sizes = view.rawElection
    ? bubbleSizes(view.rawElection, measure, ds.rawPcs?.items ?? [], groupOf)
    : null;
  if (sizes) {
    const candidates = view.model.candidates.map((c) => ({
      ...c,
      sizeShare: sizes.get(c.id) ?? 0,
      sizeLabel: `Aire : ${sizeLabel}`,
    }));
    view = { ...view, model: { ...view.model, candidates } };
  }

  // Vue depuis un groupe : l'aire des bulles montre le vote de ce groupe, le temps de la sélection.
  let lens: LensInfo | null = null;
  if (selected?.kind === 'pcs' && mode !== 'proximity') {
    lens = lensForPcs(view, selected.pcs, groupOf);
    if (lens && lens.pollGroup !== null) {
      const shares = new Map(lens.rows.map((r) => [r.id, r.share]));
      const candidates = view.model.candidates.map((c) => ({
        ...c,
        sizeShare: shares.get(c.id) ?? 0,
        sizeLabel: 'Vote du groupe',
      }));
      view = { ...view, model: { ...view.model, candidates } };
      sizeLabel = 'vote du groupe choisi';
    }
  }

  if (base.projection) sizeLabel = 'part des inscrits à son dernier scrutin';

  const crossing: CrossingInfo = {
    mode,
    selected,
    compared,
    keys: [selected, compared].flatMap((item) => (item ? [item.key] : [])),
    focus: focusOf(view, selected, compared, groupOf),
    lens,
    absent: selected ? null : first.absent,
    free,
    explained,
    suspended,
    groupOf,
    sizeLabel,
  };
  return { ...view, crossing };
}

/** Sélection telle qu'elle s'affiche : la famille suit le changement d'élection. */
export function effectiveSelection(
  view: ResolvedView | null,
  state: Pick<AppState, 'selected' | 'compared'>,
): Pick<AppState, 'selected' | 'compared'> {
  return {
    selected: view?.crossing?.selected?.key ?? state.selected,
    compared: view?.crossing?.compared?.key ?? state.compared,
  };
}

/** Variables proposées, pour le panneau. */
export function crossVariables(ds: Dataset): Variable[] {
  return ds.rawPcs ? availableVariables(ds.rawPcs.items) : [];
}
