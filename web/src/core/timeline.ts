/**
 * Frise des élections : étapes, trajectoires des familles, vote de chaque groupe par bloc.
 *
 * Une trajectoire suit une famille d'une élection à l'autre (config/families.yaml). Une élection sans
 * électorat de la famille, comme les années de coalition NUPES et NFP, coupe la trajectoire : aucun
 * parti ne reçoit les voix d'une coalition.
 *
 * Module pur, testé dans timeline.test.ts.
 */
import { pollGroupOf, voteByGroup } from './crossing.ts';
import { instituteOf, shortPublisher } from './format.ts';
import type { AppState, TypeFilter } from './state.ts';
import { PROJECTION_ID, type Point, type RawElection } from './types.ts';
import type { FamilyConfig, FamilyInfo } from '../data/dataset.ts';

const TYPE_LETTERS: Readonly<Record<string, string>> = {
  presidentielle: 'P',
  legislatives: 'L',
  europeennes: 'E',
};

/** Lettre d'un type de scrutin sur la frise ; vide si le type est inconnu. */
export function typeLetter(type: string | null | undefined): string {
  return TYPE_LETTERS[type ?? ''] ?? '';
}

export interface TimelineStop {
  id: string;
  label: string;
  /** Type d'élection : presidentielle, legislatives, europeennes. */
  type: string | null;
  year: number;
  date: number;
  projection: boolean;
  /** Institut du sondage, tel qu'il s'affiche : « Ifop-Fiducial », « CSA ». Null s'il est inconnu. */
  source: string | null;
  /** L'institut seul : deux étapes du même institut ne font pas de rupture de source. */
  institute: string | null;
}

export interface StopSource {
  elections: readonly { id: string; label: string; type: string | null; year: number | null }[];
  families: FamilyConfig | null;
  projections: ReadonlyMap<string, { target: { label: string; date: number } }>;
  /** Fichiers bruts des élections : le premier de leurs `sources` est le sondage. */
  rawElections?: ReadonlyMap<string, { sources: readonly { publisher?: string }[] }>;
}

/** Étapes dans l'ordre du temps. La projection n'en est une que si un fichier existe. */
export function timelineStops(source: StopSource): TimelineStop[] {
  const stops: TimelineStop[] = source.elections.map((e) => {
    const year = e.year ?? 0;
    const publisher = source.rawElections?.get(e.id)?.sources[0]?.publisher;
    return {
      id: e.id,
      label: e.label,
      type: e.type,
      year,
      date: source.families?.dates.get(e.id) ?? year,
      projection: false,
      source: publisher ? shortPublisher(publisher) : null,
      institute: publisher ? instituteOf(publisher) : null,
    };
  });
  const projection = source.projections.values().next().value;
  if (projection) {
    stops.push({
      id: PROJECTION_ID,
      label: `Projection 2027 : ${projection.target.label}, pas un résultat`,
      type: 'presidentielle',
      year: Math.floor(projection.target.date),
      date: projection.target.date,
      projection: true,
      source: null,
      institute: null,
    });
  }
  return stops.sort((a, b) => a.date - b.date);
}

/** Nom d'une étape avec sa source : « Présidentielle 2002 (1er tour) · Ipsos ». */
export function stopTitle(stop: Pick<TimelineStop, 'label' | 'source'>): string {
  return stop.source ? `${stop.label} · ${stop.source}` : stop.label;
}

export interface YearGroup {
  year: number;
  stops: TimelineStop[];
  /** Années écoulées depuis le groupe précédent : l'espace qui les sépare sur la frise. */
  gap: number;
}

/** Étapes réunies par année, dans l'ordre du temps. */
export function yearGroups(stops: readonly TimelineStop[]): YearGroup[] {
  const byYear = new Map<number, TimelineStop[]>();
  for (const stop of stops) {
    const list = byYear.get(stop.year);
    if (list) list.push(stop);
    else byYear.set(stop.year, [stop]);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  return years.map((year, i) => ({
    year,
    stops: byYear.get(year) ?? [],
    gap: i === 0 ? 0 : year - (years[i - 1] ?? year),
  }));
}

export function stopsForFilter(stops: readonly TimelineStop[], filter: TypeFilter): TimelineStop[] {
  return filter === 'all' ? [...stops] : stops.filter((s) => s.type === filter);
}

/** Étape suivante, ou null à la fin de la frise. */
export function nextStopId(stops: readonly TimelineStop[], current: string): string | null {
  const i = stops.findIndex((s) => s.id === current);
  if (i < 0) return stops[0]?.id ?? null;
  return stops[i + 1]?.id ?? null;
}

/** Étape précédente, ou null au début de la frise. */
export function previousStopId(stops: readonly TimelineStop[], current: string): string | null {
  const i = stops.findIndex((s) => s.id === current);
  if (i < 0) return stops.at(-1)?.id ?? null;
  return stops[i - 1]?.id ?? null;
}

/** Point de départ de la lecture : l'étape courante, sauf si elle est hors de la frise ou la dernière. */
export function playStartId(stops: readonly TimelineStop[], current: string): string | null {
  const i = stops.findIndex((s) => s.id === current);
  if (i < 0 || i === stops.length - 1) return stops[0]?.id ?? null;
  return current;
}

/** Étape de même type la plus proche dans le temps. */
export function nearestStopId(stops: readonly TimelineStop[], date: number): string | null {
  let best: TimelineStop | null = null;
  for (const s of stops) {
    if (!best || Math.abs(s.date - date) < Math.abs(best.date - date)) best = s;
  }
  return best?.id ?? null;
}

/** La famille d'un identifiant de candidat, ou de la famille elle-même sur la carte de 2027. */
export function familyOfCandidate(families: FamilyConfig, id: string): FamilyInfo | null {
  return (
    families.families.find((f) => [...f.candidates.values()].includes(id)) ??
    families.families.find((f) => f.id === id) ??
    null
  );
}

/** Quand l'élection change, la sélection suit la famille. Sans électorat là-bas, elle ne bouge pas. */
export function carrySelection(
  families: FamilyConfig | null,
  to: string,
  selected: string | null,
): string | null {
  if (!families || !selected?.startsWith('c:')) return selected;
  const family = familyOfCandidate(families, selected.slice(2));
  if (!family) return selected;
  if (to === PROJECTION_ID) return family.projection ? `c:${family.id}` : selected;
  const candidate = family.candidates.get(to);
  return candidate ? `c:${candidate}` : selected;
}

export interface TrailPoint extends Point {
  election: string;
  share: number | null;
  /** Institut du sondage de cette étape. */
  institute: string | null;
}

/** Partie d'une trajectoire : `sourceChange` dit que son sondage change à chaque pas. */
export interface TrailRun {
  points: TrailPoint[];
  sourceChange: boolean;
}

/**
 * Découpe une partie continue là où l'institut change entre deux étapes. Un écart à cet endroit peut
 * venir du changement de source, pas de l'électorat : la carte le dessine en pointillés.
 */
export function sourceRuns(points: readonly TrailPoint[]): TrailRun[] {
  const runs: TrailRun[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) continue;
    const sourceChange = from.institute !== to.institute;
    const last = runs.at(-1);
    if (last && last.sourceChange === sourceChange) last.points.push(to);
    else runs.push({ points: [from, to], sourceChange });
  }
  return runs;
}

export interface Trail {
  family: string;
  label: string;
  color: string;
  isAbstention: boolean;
  /** Parties continues ; une élection sans électorat de la famille les sépare. */
  segments: TrailPoint[][];
}

/** L'institut change-t-il entre deux étapes retenues, jusqu'à la date `upTo` ? */
export function sourceChangesUpTo(stops: readonly TimelineStop[], upTo: number): boolean {
  const shown = stops.filter((s) => !s.projection && s.date <= upTo);
  return shown.some((s, i) => i > 0 && s.institute !== shown[i - 1]?.institute);
}

export interface CandidatePosition extends Point {
  color: string;
  share: number | null;
  isAbstention: boolean;
}

/**
 * Trajectoires jusqu'à la date `upTo`. `stops` porte le filtre par type : seules les étapes retenues
 * comptent, donc une élection d'un autre type ne coupe pas une trajectoire.
 */
export function familyTrails(
  families: FamilyConfig,
  stops: readonly TimelineStop[],
  position: (election: string, candidate: string) => CandidatePosition | null,
  upTo: number,
): Trail[] {
  const elections = stops.filter((s) => !s.projection && s.date <= upTo);
  const out: Trail[] = [];
  for (const family of families.families) {
    const segments: TrailPoint[][] = [];
    let current: TrailPoint[] = [];
    let color: string | null = null;
    let isAbstention = false;
    for (const stop of elections) {
      const candidate = family.candidates.get(stop.id);
      const p = candidate ? position(stop.id, candidate) : null;
      if (p) {
        current.push({
          election: stop.id,
          x: p.x,
          y: p.y,
          share: p.share,
          institute: stop.institute,
        });
        color = p.color;
        isAbstention = p.isAbstention;
      } else if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    }
    if (current.length > 0) segments.push(current);
    if (segments.length > 0 && color) {
      out.push({ family: family.id, label: family.label, color, isAbstention, segments });
    }
  }
  return out;
}

/** Les axes du Saint-Graphique sont-ils affichés ? Sinon, trajectoires et anneaux n'ont pas de sens. */
export function usesMapAxes(state: Pick<AppState, 'axisX' | 'axisY' | 'layout'>): boolean {
  return state.axisX === null && state.axisY === null && state.layout === 'map';
}

/** Ordre fixe des parts d'un anneau, de la gauche vers la droite, puis ce qui n'est pas un bloc. */
const RING_ORDER = [
  'gauche',
  'centre',
  'droite',
  'extreme_droite',
  'autres',
  'abstention',
] as const;

export interface RingPart {
  bloc: string;
  label: string;
  /** Part du groupe (%). */
  share: number;
}

export interface RingDatum {
  /** Groupe du sondage. */
  group: string;
  /** Poids du groupe parmi les inscrits (%). */
  weight: number;
  parts: RingPart[];
}

/** Comment chaque groupe se partage entre les blocs. Les parts somment à 100. */
export function blocVotes(
  election: RawElection,
  families: FamilyConfig,
  groupOf: (code: string) => string = (code) => code,
): RingDatum[] {
  const { votes, weights } = voteByGroup(election, groupOf);
  const blocOf = new Map<string, string>();
  for (const bloc of families.blocs) {
    for (const id of bloc.candidates) blocOf.set(id, bloc.id);
  }
  const labels = new Map(families.blocs.map((b) => [b.id, b.label]));
  const out: RingDatum[] = [];
  for (const [group, row] of votes) {
    const totals = new Map<string, number>();
    for (const [candidate, share] of row) {
      const bloc = blocOf.get(candidate) ?? 'autres';
      totals.set(bloc, (totals.get(bloc) ?? 0) + share);
    }
    out.push({
      group,
      weight: weights.get(group) ?? 0,
      parts: RING_ORDER.map((bloc) => ({
        bloc,
        label: labels.get(bloc) ?? 'Autres',
        share: totals.get(bloc) ?? 0,
      })),
    });
  }
  return out.sort((a, b) => a.group.localeCompare(b.group));
}

export interface PlacedCategory extends Point {
  group: string;
  weight: number;
}

/** Centre d'un groupe du sondage : barycentre pondéré des catégories qu'il couvre. */
export function ringCenter(
  group: string,
  categories: readonly PlacedCategory[],
  available: ReadonlySet<string>,
): Point | null {
  let weight = 0;
  let x = 0;
  let y = 0;
  for (const c of categories) {
    if (pollGroupOf(c.group, available) !== group) continue;
    weight += c.weight;
    x += c.weight * c.x;
    y += c.weight * c.y;
  }
  return weight > 0 ? { x: x / weight, y: y / weight } : null;
}

export interface FamilyMoment {
  election: string;
  label: string;
  date: number;
  /** Score (%), ou null s'il est inconnu. */
  share: number | null;
  /** Composition de l'électorat par groupe (%). */
  composition: Readonly<Record<string, number>>;
}

/** Score et composition d'une famille au fil du temps. Une coalition n'y figure pas. */
export function familyHistory(
  families: FamilyConfig,
  stops: readonly TimelineStop[],
  rawElections: ReadonlyMap<string, RawElection>,
  familyId: string,
): FamilyMoment[] {
  const family = families.families.find((f) => f.id === familyId);
  if (!family) return [];
  const out: FamilyMoment[] = [];
  for (const stop of stops) {
    const candidate = family.candidates.get(stop.id);
    const election = rawElections.get(stop.id);
    if (!candidate || !election) continue;
    const raw = election.candidates.find((c) => c.id === candidate);
    out.push({
      election: stop.id,
      label: stop.label,
      date: stop.date,
      share: raw?.national_share_pct ?? null,
      composition: election.composition[candidate] ?? {},
    });
  }
  return out;
}
