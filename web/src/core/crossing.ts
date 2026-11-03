/**
 * Croisements entre catégories et électorats, à partir des tableaux de composition des sondages.
 *
 * Les sondages donnent la composition de chaque électorat : la part de chaque groupe de PCS dans les
 * voix d'un candidat. En le multipliant par le score, rapporté aux inscrits, on obtient l'inverse :
 * comment vote chaque groupe.
 *
 * Limite à garder en tête : ces tableaux ne détaillent que six groupes, sept en 1995 et 2002. Sinon,
 * les agriculteurs sont réunis avec les artisans et commerçants, et les autres inactifs n'y figurent
 * pas (voir `pollGroupOf`). Sans abstention par groupe, le poids d'un groupe se lit parmi les votants.
 *
 * Module pur, testé dans crossing.test.ts.
 */
import type { RawElection } from './types.ts';

/** Parts (%) indexées par groupe de PCS. */
export type GroupShares = Readonly<Record<string, number>>;

/** Composition d'un électorat par groupe, quel que soit le niveau de détail du sondage. */
export function compositionByGroup(
  election: RawElection,
  candidateId: string,
  groupOf: (code: string) => string = (code) => code,
): Record<string, number> {
  const shares = election.composition[candidateId] ?? {};
  const out: Record<string, number> = {};
  for (const [code, share] of Object.entries(shares)) {
    const group = election.pcs_level === 2 ? groupOf(code) : code;
    out[group] = (out[group] ?? 0) + share;
  }
  return out;
}

/** Vrai si le sondage détaille l'abstention par groupe, et pas seulement son taux. */
export function hasAbstentionBreakdown(election: RawElection): boolean {
  return election.candidates.some(
    (c) => c.is_abstention === true && election.composition[c.id] !== undefined,
  );
}

/** Sur qui se lisent les parts de groupe : les inscrits, ou les seuls votants faute de détail. */
export function groupBase(election: RawElection): 'inscrits' | 'votants' {
  return hasAbstentionBreakdown(election) ? 'inscrits' : 'votants';
}

/** Score de chaque électorat rapporté aux inscrits : les exprimés se partagent ce que l'abstention laisse. */
export function registeredShares(election: RawElection): Map<string, number> {
  const abstention = election.candidates.find((c) => c.is_abstention === true);
  const abstained = abstention?.national_share_pct ?? 0;
  const out = new Map<string, number>();
  for (const c of election.candidates) {
    const share = c.national_share_pct ?? 0;
    out.set(c.id, c.is_abstention === true ? share : (share * (100 - abstained)) / 100);
  }
  return out;
}

export interface GroupVotes {
  /** Vote de chaque groupe : votes.get(groupe).get(candidat) = part (%) du groupe. */
  votes: Map<string, Map<string, number>>;
  /** Poids de chaque groupe parmi les inscrits (%), ou les votants sans abstention par groupe. */
  weights: Map<string, number>;
}

/** Comment vote chaque groupe, abstention comprise si le sondage la donne. */
export function voteByGroup(
  election: RawElection,
  groupOf: (code: string) => string = (code) => code,
): GroupVotes {
  const registered = registeredShares(election);
  const mass = new Map<string, Map<string, number>>();
  for (const c of election.candidates) {
    const score = registered.get(c.id) ?? 0;
    for (const [group, share] of Object.entries(compositionByGroup(election, c.id, groupOf))) {
      const row = mass.get(group) ?? new Map<string, number>();
      row.set(c.id, (row.get(c.id) ?? 0) + (score * share) / 100);
      mass.set(group, row);
    }
  }
  const weights = new Map<string, number>();
  const votes = new Map<string, Map<string, number>>();
  for (const [group, row] of mass) {
    const total = [...row.values()].reduce((a, b) => a + b, 0);
    weights.set(group, total);
    if (total > 0) {
      votes.set(group, new Map([...row].map(([id, v]) => [id, (100 * v) / total])));
    }
  }
  if (!hasAbstentionBreakdown(election) && election.candidates.some((c) => c.is_abstention)) {
    // Le taux officiel réduit les parts à ce que l'abstention laisse : on revient à une somme de 100.
    const total = [...weights.values()].reduce((a, b) => a + b, 0);
    if (total > 0) for (const [group, w] of weights) weights.set(group, (100 * w) / total);
  }
  return { votes, weights };
}

/**
 * Écart entre deux compositions, en points : la part des électeurs de l'un qu'il faudrait changer de
 * groupe pour obtenir l'autre (0 : identiques ; 100 : aucun groupe en commun).
 */
export function compositionGap(a: GroupShares, b: GroupShares): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  for (const k of keys) sum += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  return sum / 2;
}

export interface Representation {
  group: string;
  /** Part du groupe dans cet électorat (%). */
  share: number;
  /** Part du groupe parmi les inscrits (%). */
  reference: number;
  /** Écart en points : positif quand le groupe est surreprésenté. */
  delta: number;
}

/** Sur- et sous-représentation de chaque groupe dans un électorat, des plus forts aux plus faibles. */
export function representation(
  election: RawElection,
  candidateId: string,
  groupOf: (code: string) => string = (code) => code,
): Representation[] {
  const { weights } = voteByGroup(election, groupOf);
  const shares = compositionByGroup(election, candidateId, groupOf);
  return [...weights]
    .map(([group, reference]) => {
      const share = shares[group] ?? 0;
      return { group, share, reference, delta: share - reference };
    })
    .sort((a, b) => b.delta - a.delta);
}

/**
 * Groupe du sondage qui couvre un groupe de PCS : le groupe lui-même s'il figure au tableau, les
 * artisans et commerçants pour les agriculteurs, null pour un groupe sans donnée de vote.
 */
export function pollGroupOf(group: string, available: ReadonlySet<string>): string | null {
  if (available.has(group)) return group;
  if (group === '1' && available.has('2')) return '2';
  return null;
}
