/**
 * Ce que mesure l'aire des bulles d'électorats. Par défaut, la part des inscrits ; le panneau
 * « Croiser » la remplace par une autre grandeur, pour voir les électorats gonfler ou fondre.
 *
 * Module pur, testé dans bubbleSize.test.ts.
 */
import { compositionByGroup, pollGroupOf, registeredShares, voteByGroup } from './crossing.ts';
import { GROUP_SHORT_NAMES } from './groups.ts';
import type { RawElection, RawPcsItem } from './types.ts';
import type { Variable } from './variables.ts';

export type BubbleMeasure =
  | { kind: 'registered' }
  | { kind: 'score' }
  /** Part d'un groupe dans chaque électorat. */
  | { kind: 'inGroup'; group: string }
  /** Vote d'un groupe : ce que chaque électorat pèse chez lui. */
  | { kind: 'ofGroup'; group: string }
  /** Part du total d'une variable que chaque électorat rassemble. */
  | { kind: 'variable'; variable: Variable };

const REGISTERED: BubbleMeasure = { kind: 'registered' };

/** Identifiant de l'URL : `score`, `dans:<groupe>`, `vote:<groupe>`, `var:<variable>`. */
export function parseBubbleSize(id: string | null, variables: readonly Variable[]): BubbleMeasure {
  if (!id) return REGISTERED;
  if (id === 'score') return { kind: 'score' };
  const [prefix, value] = id.split(':');
  if (!value) return REGISTERED;
  if (prefix === 'dans') return { kind: 'inGroup', group: value };
  if (prefix === 'vote') return { kind: 'ofGroup', group: value };
  if (prefix === 'var') {
    const variable = variables.find((v) => v.id === value);
    if (variable) return { kind: 'variable', variable };
  }
  return REGISTERED;
}

function groupName(group: string): string {
  return GROUP_SHORT_NAMES[group] ?? `groupe ${group}`;
}

/** Ce que dit l'aire, en toutes lettres. */
export function bubbleSizeLabel(measure: BubbleMeasure): string {
  switch (measure.kind) {
    case 'registered':
      return 'part des inscrits';
    case 'score':
      return 'score parmi les exprimés';
    case 'inGroup':
      return `part des ${groupName(measure.group)} dans l’électorat`;
    case 'ofGroup':
      return `vote des ${groupName(measure.group)}`;
    case 'variable':
      return `part du total : ${measure.variable.label}`;
  }
}

/** Moyenne d'une variable par groupe du sondage, pondérée par les effectifs. */
function groupMeans(
  items: readonly RawPcsItem[],
  variable: Variable,
  available: ReadonlySet<string>,
): Map<string, number> {
  const totals = new Map<string, { sum: number; weight: number }>();
  for (const item of items) {
    const value = variable.read(item);
    const group = pollGroupOf(item.group, available);
    if (value === null || group === null) continue;
    const row = totals.get(group) ?? { sum: 0, weight: 0 };
    row.sum += value * item.population;
    row.weight += item.population;
    totals.set(group, row);
  }
  return new Map(
    [...totals].flatMap(([group, { sum, weight }]) => (weight > 0 ? [[group, sum / weight]] : [])),
  );
}

/**
 * Taille (en points, comme une part en %) de chaque électorat selon la mesure. Null pour la mesure
 * par défaut : la carte utilise alors la part des inscrits qu'elle connaît déjà.
 */
export function bubbleSizes(
  election: RawElection,
  measure: BubbleMeasure,
  items: readonly RawPcsItem[],
  groupOf: (code: string) => string = (code) => code,
): Map<string, number> | null {
  switch (measure.kind) {
    case 'registered':
      return null;
    case 'score':
      return new Map(election.candidates.map((c) => [c.id, c.national_share_pct ?? 0]));
    case 'inGroup':
      return new Map(
        election.candidates.map((c) => [
          c.id,
          compositionByGroup(election, c.id, groupOf)[measure.group] ?? 0,
        ]),
      );
    case 'ofGroup': {
      const votes = voteByGroup(election, groupOf).votes.get(measure.group);
      return new Map(election.candidates.map((c) => [c.id, votes?.get(c.id) ?? 0]));
    }
    case 'variable': {
      const { weights } = voteByGroup(election, groupOf);
      const means = groupMeans(items, measure.variable, new Set(weights.keys()));
      const registered = registeredShares(election);
      const raw = new Map(
        election.candidates.map((c) => {
          const shares = compositionByGroup(election, c.id, groupOf);
          let known = 0;
          let sum = 0;
          for (const [group, share] of Object.entries(shares)) {
            const mean = means.get(group);
            if (mean === undefined) continue;
            known += share;
            sum += share * mean;
          }
          const average = known > 0 ? sum / known : 0;
          return [c.id, Math.max(0, (registered.get(c.id) ?? 0) * average)];
        }),
      );
      const total = [...raw.values()].reduce((a, b) => a + b, 0);
      return new Map([...raw].map(([id, v]) => [id, total > 0 ? (100 * v) / total : 0]));
    }
  }
}
