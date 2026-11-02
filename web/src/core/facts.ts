/**
 * « Le saviez-vous ? » : des corrélations et des proximités inattendues, calculées à chaque fois sur
 * les données chargées. Aucun chiffre n'est écrit ici : si une méthode ou une mise à jour des données
 * rend un constat faux, il disparaît au lieu d'afficher une erreur.
 *
 * Deux règles empêchent de présenter un artefact comme une découverte :
 * - une corrélation doit se répéter d'une élection à l'autre (`correlationRepeats`). Sur 6 groupes, un
 *   r élevé isolé ne prouve rien : sur 516 paires essayées, 15 dépassent déjà 0,9 en valeur absolue ;
 * - une proximité sur la carte doit être confirmée par la composition (`closenessConfirmed`). Deux
 *   électorats peuvent avoir le même barycentre sans se ressembler : Arthaud et Le Pen sont à 0,17
 *   unité en 2022, avec 18,6 points d'écart de composition.
 *
 * Les distances sont en unités de données : l'étirement de la carte à l'écran n'y change rien.
 *
 * Module pur (sans DOM), testé dans facts.test.ts.
 */
import { computedKey, type Dataset, type ElectionInfo, type FamilyInfo } from '../data/dataset.ts';
import { compositionByGroup, compositionGap, pollGroupOf, voteByGroup } from './crossing.ts';
import { formatNumber, formatPct } from './format.ts';
import type { ComputedFile, Point, RawCandidate, RawElection, RawPcsItem } from './types.ts';

/** Distance sous laquelle deux repères sont dits proches : le pas de la grille du graphique. */
export const CLOSE_ON_MAP = 0.5;
/** Écart de composition (points) sous lequel deux électorats sont dits semblables. */
export const ALIKE_COMPOSITION = 12;
/** Une corrélation doit se répéter sur ce nombre d'élections, avec ce r minimal, de même signe. */
export const MIN_REPEATED_POLLS = 3;
export const MIN_REPEATED_R = 0.7;
/** En dessous de ce score (%), l'échantillon du sondage est trop petit pour comparer un électorat. */
export const MIN_ELECTORATE_SHARE = 2;

const RETIRED_GROUP = '7';
const FIT_PADDING = 1.2;

export interface FactBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Vue à afficher pour lire le constat sur la carte. */
export interface FactTarget {
  election: string;
  selected: string | null;
  compared: string | null;
  /** Zone à cadrer, en données ; null si la méthode ne couvre pas cette élection. */
  box: FactBox | null;
}

export interface Fact {
  id: string;
  text: string;
  /** Valeurs mesurées, non arrondies. */
  numbers: Record<string, number>;
  /** Ce qui a été comparé. */
  scope: { n: number; unit: string; elections: string[] };
  caveat: string;
  /** Vrai si le constat dépend des positions de la méthode : il suppose ses poids d'origine. */
  usesPositions: boolean;
  target: FactTarget;
}

// --- Règles -----------------------------------------------------------------------------------

/** Une proximité sur la carte n'est retenue que si la composition la confirme. */
export function closenessConfirmed(mapDistance: number, gap: number): boolean {
  return mapDistance <= CLOSE_ON_MAP && gap <= ALIKE_COMPOSITION;
}

/** Une corrélation n'est retenue que si elle se répète : même signe et r élevé à chaque élection. */
export function correlationRepeats(rs: readonly number[]): boolean {
  if (rs.length < MIN_REPEATED_POLLS) return false;
  const sign = Math.sign(rs[0] ?? 0);
  return sign !== 0 && rs.every((r) => Math.sign(r) === sign && Math.abs(r) >= MIN_REPEATED_R);
}

/** Coefficient de corrélation de Pearson ; 0 si une série est constante. */
export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return 0;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - meanA;
    const db = (b[i] ?? 0) - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  return varA === 0 || varB === 0 ? 0 : cov / Math.sqrt(varA * varB);
}

// --- Lecture des données ----------------------------------------------------------------------

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function groupOfCode(ds: Dataset): (code: string) => string {
  return (code) => ds.pcsMeta.get(code)?.group ?? code;
}

function family(ds: Dataset, id: string): FamilyInfo | null {
  return ds.families?.families.find((f) => f.id === id) ?? null;
}

function presidentials(ds: Dataset): ElectionInfo[] {
  return ds.elections
    .filter((e) => e.type === 'presidentielle')
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
}

function fileOf(ds: Dataset, method: string, election: string): ComputedFile | null {
  return ds.computed.get(computedKey(method, election)) ?? null;
}

function pointOf(file: ComputedFile | null, candidate: string): Point | null {
  return file?.candidates.find((c) => c.id === candidate) ?? null;
}

/** « de Marine Le Pen », « d'Éric Zemmour » : l'élision suit le nom, qui vient des données. */
export function ofName(name: string): string {
  return /^[aeiouàâéèêëîïôöùûü]/i.test(name) ? `d'${name}` : `de ${name}`;
}

function labelOf(election: RawElection, id: string): string {
  return election.candidates.find((c) => c.id === id)?.label ?? id;
}

/** Électorats assez nombreux pour être comparés : l'abstention n'en est pas un. */
function comparable(election: RawElection): RawCandidate[] {
  return election.candidates.filter(
    (c) => c.is_abstention !== true && (c.national_share_pct ?? 0) >= MIN_ELECTORATE_SHARE,
  );
}

function boxAround(points: readonly (Point | null)[]): FactBox | null {
  const known = points.filter((p): p is Point => p !== null);
  if (known.length === 0) return null;
  return {
    x0: Math.min(...known.map((p) => p.x)) - FIT_PADDING,
    x1: Math.max(...known.map((p) => p.x)) + FIT_PADDING,
    y0: Math.min(...known.map((p) => p.y)) - FIT_PADDING,
    y1: Math.max(...known.map((p) => p.y)) + FIT_PADDING,
  };
}

/** Écart de composition entre deux électorats d'une même élection. */
export function gapBetween(ds: Dataset, election: RawElection, a: string, b: string): number {
  const groupOf = groupOfCode(ds);
  return compositionGap(
    compositionByGroup(election, a, groupOf),
    compositionByGroup(election, b, groupOf),
  );
}

/** Distance sur la carte entre deux électorats, en unités de données. */
export function mapDistance(
  ds: Dataset,
  method: string,
  election: string,
  a: string,
  b: string,
): number | null {
  const file = fileOf(ds, method, election);
  const pa = pointOf(file, a);
  const pb = pointOf(file, b);
  return pa && pb ? distance(pa, pb) : null;
}

/** Moyenne d'une variable par groupe du sondage, pondérée par les effectifs. */
export function groupMeans(
  items: readonly RawPcsItem[],
  value: (item: RawPcsItem) => number,
  available: ReadonlySet<string>,
): Map<string, number> {
  const totals = new Map<string, { sum: number; weight: number }>();
  for (const item of items) {
    const group = pollGroupOf(item.group, available);
    if (!group) continue;
    const t = totals.get(group) ?? { sum: 0, weight: 0 };
    t.sum += value(item) * item.population;
    t.weight += item.population;
    totals.set(group, t);
  }
  return new Map([...totals].map(([g, t]) => [g, t.sum / t.weight]));
}

export interface FamilyCorrelation {
  election: string;
  r: number;
  /** Nombre de groupes comparés. */
  n: number;
}

/** Corrélation, à chaque élection, entre le vote d'une famille dans chaque groupe et une variable. */
export function familyCorrelations(
  ds: Dataset,
  familyInfo: FamilyInfo,
  value: (item: RawPcsItem) => number,
): FamilyCorrelation[] {
  const items = ds.rawPcs?.items;
  if (!items) return [];
  const out: FamilyCorrelation[] = [];
  const groupOf = groupOfCode(ds);
  for (const info of ds.elections) {
    const election = ds.rawElections.get(info.id);
    const candidate = familyInfo.candidates.get(info.id);
    if (!election || !candidate) continue;
    const { votes } = voteByGroup(election, groupOf);
    const means = groupMeans(items, value, new Set(votes.keys()));
    const groups = [...votes.keys()].filter((g) => means.has(g)).sort();
    const shares = groups.map((g) => votes.get(g)?.get(candidate) ?? 0);
    const variable = groups.map((g) => means.get(g) ?? 0);
    out.push({ election: info.id, r: pearson(shares, variable), n: groups.length });
  }
  return out;
}

function lastElectionOf(ds: Dataset, familyInfo: FamilyInfo): ElectionInfo | null {
  const dates = ds.families?.dates;
  const held = ds.elections.filter((e) => familyInfo.candidates.has(e.id));
  const sorted = [...held].sort((a, b) => (dates?.get(a.id) ?? 0) - (dates?.get(b.id) ?? 0));
  return sorted.at(-1) ?? null;
}

function firstElectionOf(ds: Dataset, familyInfo: FamilyInfo): ElectionInfo | null {
  const dates = ds.families?.dates;
  const held = ds.elections.filter((e) => familyInfo.candidates.has(e.id));
  const sorted = [...held].sort((a, b) => (dates?.get(a.id) ?? 0) - (dates?.get(b.id) ?? 0));
  return sorted[0] ?? null;
}

const FROM_TYPE: Record<string, string> = {
  presidentielle: 'De la présidentielle',
  legislatives: 'Des législatives',
  europeennes: 'Des européennes',
};
const TO_TYPE: Record<string, string> = {
  presidentielle: 'à la présidentielle',
  legislatives: 'aux législatives',
  europeennes: 'aux européennes',
};

// --- Constats ---------------------------------------------------------------------------------

/**
 * Un électorat bien plus proche d'un autre qu'on ne l'attendrait : la proximité sur la carte est
 * confirmée par la composition, et l'électorat de comparaison est plus loin sur les deux mesures.
 */
function reconqueteNearMacron(ds: Dataset, method: string): Fact | null {
  const info = presidentials(ds).at(-1);
  const election = info && ds.rawElections.get(info.id);
  if (!info || !election) return null;
  const subject = family(ds, 'reconquete')?.candidates.get(info.id);
  const near = family(ds, 'macron')?.candidates.get(info.id);
  const far = family(ds, 'rn')?.candidates.get(info.id);
  if (!subject || !near || !far) return null;
  const mapNear = mapDistance(ds, method, info.id, subject, near);
  const mapFar = mapDistance(ds, method, info.id, subject, far);
  if (mapNear === null || mapFar === null) return null;
  const gapNear = gapBetween(ds, election, subject, near);
  const gapFar = gapBetween(ds, election, subject, far);
  if (!closenessConfirmed(mapNear, gapNear) || mapFar <= mapNear || gapFar <= gapNear) return null;
  const file = fileOf(ds, method, info.id);
  return {
    id: 'zemmour-macron',
    text:
      `En ${info.year}, l'électorat ${ofName(labelOf(election, subject))} ressemble bien plus à celui ` +
      `${ofName(labelOf(election, near))} qu'à celui ${ofName(labelOf(election, far))} : ` +
      `${formatNumber(mapNear)} contre ${formatNumber(mapFar)} unités sur la carte, ` +
      `et ${formatNumber(gapNear, 1)} contre ${formatNumber(gapFar, 1)} points d'écart de composition.`,
    numbers: { mapNear, mapFar, gapNear, gapFar },
    scope: { n: 3, unit: 'électorats', elections: [info.id] },
    caveat: 'Composition sociale en six groupes : cela ne dit rien des opinions de ces électeurs.',
    usesPositions: true,
    target: {
      election: info.id,
      selected: `c:${subject}`,
      compared: `c:${near}`,
      box: boxAround([pointOf(file, subject), pointOf(file, near), pointOf(file, far)]),
    },
  };
}

/** Les deux électorats les plus semblables d'une présidentielle, s'ils sont de blocs différents. */
function mostAlike(ds: Dataset, method: string): Fact | null {
  const info = presidentials(ds).at(-1);
  const election = info && ds.rawElections.get(info.id);
  const blocs = ds.families?.blocs;
  if (!info || !election || !blocs) return null;
  const list = comparable(election);
  let best: { a: string; b: string; gap: number } | null = null;
  let pairs = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]?.id;
      const b = list[j]?.id;
      if (!a || !b) continue;
      pairs++;
      const gap = gapBetween(ds, election, a, b);
      if (!best || gap < best.gap) best = { a, b, gap };
    }
  }
  if (!best || best.gap > ALIKE_COMPOSITION) return null;
  const { a, b, gap } = best;
  const blocOf = (id: string): string | undefined =>
    blocs.find((bloc) => bloc.candidates.has(id))?.id;
  if (!blocOf(a) || !blocOf(b) || blocOf(a) === blocOf(b)) return null;
  const file = fileOf(ds, method, info.id);
  return {
    id: 'plus-semblables',
    text:
      `Par leur composition sociale, les deux électorats les plus semblables de ${info.year} sont ` +
      `ceux ${ofName(labelOf(election, a))} et ${ofName(labelOf(election, b))} : ` +
      `${formatNumber(gap, 1)} points d'écart, soit la part d'électeurs à changer de groupe pour ` +
      "passer de l'un à l'autre.",
    numbers: { gap, pairs },
    scope: { n: list.length, unit: 'électorats', elections: [info.id] },
    caveat: `Électorats de plus de ${MIN_ELECTORATE_SHARE} %, en six groupes sociaux : se ressembler socialement ne veut pas dire voter pour les mêmes raisons.`,
    usesPositions: false,
    target: {
      election: info.id,
      selected: `c:${a}`,
      compared: `c:${b}`,
      box: boxAround([pointOf(file, a), pointOf(file, b)]),
    },
  };
}

/** Le même électorat de candidat est le plus proche du centre de la population à chaque présidentielle. */
function closestToCentre(ds: Dataset, method: string): Fact | null {
  const list = presidentials(ds);
  if (list.length < 2) return null;
  const groupOf = groupOfCode(ds);
  const rows: { year: number; id: string; label: string; map: number; gap: number }[] = [];
  for (const info of list) {
    const election = ds.rawElections.get(info.id);
    const file = fileOf(ds, method, info.id);
    if (!election || !file) return null;
    const { weights } = voteByGroup(election, groupOf);
    const everyone = Object.fromEntries(weights);
    let closest: { id: string; map: number } | null = null;
    for (const c of comparable(election)) {
      const point = pointOf(file, c.id);
      if (!point) continue;
      const map = distance(point, file.population_barycenter);
      if (!closest || map < closest.map) closest = { id: c.id, map };
    }
    if (!closest) return null;
    const gap = compositionGap(compositionByGroup(election, closest.id, groupOf), everyone);
    if (!closenessConfirmed(closest.map, gap)) return null;
    rows.push({
      year: info.year ?? 0,
      id: closest.id,
      label: labelOf(election, closest.id),
      map: closest.map,
      gap,
    });
  }
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last || rows.some((r) => r.id !== first.id)) return null;
  const lastInfo = list.at(-1);
  if (!lastInfo) return null;
  const file = fileOf(ds, method, lastInfo.id);
  const years = rows.map((r) => r.year).join(' et ');
  const maps = rows.map((r) => formatNumber(r.map)).join(' puis ');
  const gaps = rows.map((r) => formatNumber(r.gap, 1)).join(' puis ');
  const numbers: Record<string, number> = {};
  for (const r of rows) {
    numbers[`map${r.year}`] = r.map;
    numbers[`gap${r.year}`] = r.gap;
  }
  return {
    id: 'centre-population',
    text:
      `L'électorat de candidat le plus proche du centre de la population, aux présidentielles de ` +
      `${years}, est celui ${ofName(last.label)} : ${maps} unité sur la carte.`,
    numbers,
    scope: { n: rows.length, unit: 'présidentielles', elections: list.map((e) => e.id) },
    caveat: `Être au centre, c'est ressembler à la moyenne, pas être centriste. Composition confirmée : ${gaps} points d'écart avec l'ensemble des inscrits.`,
    usesPositions: true,
    target: {
      election: lastInfo.id,
      selected: `c:${last.id}`,
      compared: null,
      box: boxAround([pointOf(file, last.id), file?.population_barycenter ?? null]),
    },
  };
}

/** Le vote d'une famille suit une variable inattendue plus que les variables attendues. */
function rnFollowsCap(ds: Dataset, method: string): Fact | null {
  const rn = family(ds, 'rn');
  if (!rn || !ds.rawPcs) return null;
  const cap = familyCorrelations(ds, rn, (p) => p.diplomes.cap);
  const noDiploma = familyCorrelations(ds, rn, (p) => p.diplomes.certif_aucun);
  const income = familyCorrelations(ds, rn, (p) => p.niveau_vie_mensuel_eur);
  const capRs = cap.map((c) => c.r);
  if (!correlationRepeats(capRs)) return null;
  const rCap = mean(capRs);
  const rNoDiploma = mean(noDiploma.map((c) => c.r));
  const rIncome = mean(income.map((c) => c.r));
  if (Math.abs(rCap) <= Math.abs(rNoDiploma) || Math.abs(rCap) <= Math.abs(rIncome)) return null;
  const n = cap[0]?.n ?? 0;
  const last = lastElectionOf(ds, rn);
  const candidate = last ? rn.candidates.get(last.id) : undefined;
  if (!last || !candidate) return null;
  const file = fileOf(ds, method, last.id);
  return {
    id: 'rn-cap',
    text:
      `Dans chaque groupe social, le vote « ${rn.label} » suit la part de titulaires d'un CAP ou ` +
      `d'un BEP (r moyen de ${formatNumber(rCap)} sur ${cap.length} scrutins) bien plus que la part ` +
      `de sans-diplôme (${formatNumber(rNoDiploma)}), et plus encore que le niveau de vie ` +
      `(${formatNumber(rIncome)}).`,
    numbers: { rCap, rNoDiploma, rIncome, minCap: Math.min(...capRs.map(Math.abs)), n },
    scope: { n, unit: 'groupes', elections: cap.map((c) => c.election) },
    caveat: `n = ${n} groupes sociaux, pas des individus : corrélation n'est pas causalité.`,
    usesPositions: false,
    target: {
      election: last.id,
      selected: `c:${candidate}`,
      compared: null,
      box: boxAround([pointOf(file, candidate)]),
    },
  };
}

interface RetiredShift {
  first: number;
  last: number;
  legislativesFirst: number;
  legislativesLast: number;
}

function retiredShift(ds: Dataset, f: FamilyInfo): RetiredShift | null {
  const groupOf = groupOfCode(ds);
  const shareAt = (id: string): number | null => {
    const election = ds.rawElections.get(id);
    const candidate = f.candidates.get(id);
    if (!election || !candidate) return null;
    return compositionByGroup(election, candidate, groupOf)[RETIRED_GROUP] ?? null;
  };
  const start = firstElectionOf(ds, f);
  const end = lastElectionOf(ds, f);
  const legislatives = ds.elections.filter(
    (e) => e.type === 'legislatives' && f.candidates.has(e.id),
  );
  const dates = ds.families?.dates;
  legislatives.sort((a, b) => (dates?.get(a.id) ?? 0) - (dates?.get(b.id) ?? 0));
  const legFirst = legislatives[0];
  const legLast = legislatives.at(-1);
  if (!start || !end || !legFirst || !legLast || legFirst === legLast) return null;
  const first = shareAt(start.id);
  const last = shareAt(end.id);
  const legislativesFirst = shareAt(legFirst.id);
  const legislativesLast = shareAt(legLast.id);
  if (first === null || last === null || legislativesFirst === null || legislativesLast === null) {
    return null;
  }
  return { first, last, legislativesFirst, legislativesLast };
}

/**
 * Deux électorats dont la part de retraités évolue en sens inverse. Le premier et le dernier scrutin
 * ne sont pas du même type : le sens doit donc se retrouver sur les seules législatives.
 */
function retiredSwap(ds: Dataset, method: string): Fact | null {
  const up = family(ds, 'macron');
  const down = family(ds, 'lr');
  if (!up || !down) return null;
  const a = retiredShift(ds, up);
  const b = retiredShift(ds, down);
  const start = firstElectionOf(ds, up);
  const end = lastElectionOf(ds, up);
  if (!a || !b || !start || !end) return null;
  if (firstElectionOf(ds, down)?.id !== start.id || lastElectionOf(ds, down)?.id !== end.id) {
    return null;
  }
  const rises = a.last > a.first && a.legislativesLast > a.legislativesFirst;
  const falls = b.last < b.first && b.legislativesLast < b.legislativesFirst;
  if (!rises || !falls) return null;
  const from = FROM_TYPE[start.type ?? ''];
  const to = TO_TYPE[end.type ?? ''];
  const upCandidate = up.candidates.get(end.id);
  const downCandidate = down.candidates.get(end.id);
  if (!from || !to || !upCandidate || !downCandidate) return null;
  const file = fileOf(ds, method, end.id);
  const pct = (v: number): string => formatPct(v, 0);
  return {
    id: 'retraites',
    text:
      `${from} de ${start.year} ${to} de ${end.year}, les retraités passent de ${pct(a.first)} à ` +
      `${pct(a.last)} de l'électorat « ${up.label} », et de ${pct(b.first)} à ${pct(b.last)} de ` +
      `l'électorat « ${down.label} ».`,
    numbers: {
      upFirst: a.first,
      upLast: a.last,
      downFirst: b.first,
      downLast: b.last,
      upLegislativesFirst: a.legislativesFirst,
      upLegislativesLast: a.legislativesLast,
      downLegislativesFirst: b.legislativesFirst,
      downLegislativesLast: b.legislativesLast,
    },
    scope: { n: 2, unit: 'familles', elections: [start.id, end.id] },
    caveat:
      `Types de scrutin différents, mais même sens sur les seules législatives : ` +
      `${pct(a.legislativesFirst)} à ${pct(a.legislativesLast)}, et ` +
      `${pct(b.legislativesFirst)} à ${pct(b.legislativesLast)}.`,
    usesPositions: false,
    target: {
      election: end.id,
      selected: `c:${upCandidate}`,
      compared: `c:${downCandidate}`,
      box: boxAround([pointOf(file, upCandidate), pointOf(file, downCandidate)]),
    },
  };
}

/** Tous les constats vrais pour cette méthode, du plus inattendu au plus attendu. */
export function computeFacts(ds: Dataset, method: string): Fact[] {
  const builders = [reconqueteNearMacron, mostAlike, rnFollowsCap, closestToCentre, retiredSwap];
  return builders.map((build) => build(ds, method)).filter((f): f is Fact => f !== null);
}
