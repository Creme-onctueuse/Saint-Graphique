/**
 * Mini-jeu « Qui est-ce ? » : deviner un électorat d'après sa composition sociale. La réponse et les
 * leurres viennent des données ; le tirage est injectable, pour que les tests soient déterministes.
 *
 * Module pur (sans DOM), testé dans game.test.ts.
 */
import type { Dataset } from '../data/dataset.ts';
import { representation } from './crossing.ts';
import { MIN_ELECTORATE_SHARE } from './facts.ts';
import type { RawCandidate, RawElection } from './types.ts';

/** Renvoie un nombre dans [0, 1[, comme Math.random. */
export type Rng = () => number;

/** Nombre de noms proposés. */
export const OPTION_COUNT = 3;

export interface GameBar {
  group: string;
  /** Part du groupe dans cet électorat (%). */
  share: number;
  /** Part du groupe parmi les inscrits (%). */
  reference: number;
}

export interface GameOption {
  id: string;
  label: string;
}

export interface GameRound {
  electionId: string;
  electionLabel: string;
  answerId: string;
  answerLabel: string;
  /** Les noms proposés, dans un ordre tiré au sort, réponse comprise. */
  options: GameOption[];
  /** Composition anonyme de l'électorat, dans l'ordre des groupes. */
  bars: GameBar[];
}

/** Électorats jouables : pas l'abstention, pas moins de 2 %, et une composition connue. */
export function eligibleElectorates(election: RawElection): RawCandidate[] {
  return election.candidates.filter((c) => {
    if (c.is_abstention === true || (c.national_share_pct ?? 0) < MIN_ELECTORATE_SHARE)
      return false;
    return Object.values(election.composition[c.id] ?? {}).some((share) => share > 0);
  });
}

/** Élections qui ont assez d'électorats pour proposer trois noms. */
export function playableElections(ds: Dataset): string[] {
  return ds.elections
    .filter((e) => {
      const election = ds.rawElections.get(e.id);
      return election !== undefined && eligibleElectorates(election).length >= OPTION_COUNT;
    })
    .map((e) => e.id);
}

function randomIndex(rng: Rng, length: number): number {
  return Math.min(length - 1, Math.floor(rng() * length));
}

/** Mélange de Fisher-Yates. */
export function shuffled<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomIndex(rng, i + 1);
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

export interface RoundOptions {
  /** Impose l'élection ; sinon, elle est tirée au sort. */
  election?: string;
  /** Manches déjà jouées (`élection/électorat`), à éviter tant qu'il en reste d'autres. */
  played?: ReadonlySet<string>;
}

/** Tire une manche ; null si aucune élection ne s'y prête. */
export function pickRound(ds: Dataset, rng: Rng, options: RoundOptions = {}): GameRound | null {
  const playable = playableElections(ds);
  const pool = options.election ? playable.filter((id) => id === options.election) : playable;
  if (pool.length === 0) return null;
  const played = options.played ?? new Set<string>();
  const key = (election: string, candidate: string): string => `${election}/${candidate}`;

  const fresh = pool.filter((id) => {
    const election = ds.rawElections.get(id);
    return election && eligibleElectorates(election).some((c) => !played.has(key(id, c.id)));
  });
  const candidates = fresh.length > 0 ? fresh : pool;
  const electionId = candidates[randomIndex(rng, candidates.length)];
  const election = electionId ? ds.rawElections.get(electionId) : undefined;
  if (!electionId || !election) return null;

  const eligible = eligibleElectorates(election);
  const unseen = eligible.filter((c) => !played.has(key(electionId, c.id)));
  const answers = unseen.length > 0 ? unseen : eligible;
  const answer = answers[randomIndex(rng, answers.length)];
  if (!answer) return null;

  const decoys = shuffled(
    eligible.filter((c) => c.id !== answer.id),
    rng,
  ).slice(0, OPTION_COUNT - 1);
  const groupOf = (code: string): string => ds.pcsMeta.get(code)?.group ?? code;
  return {
    electionId,
    electionLabel: ds.elections.find((e) => e.id === electionId)?.label ?? electionId,
    answerId: answer.id,
    answerLabel: answer.label,
    options: shuffled([answer, ...decoys], rng).map((c) => ({ id: c.id, label: c.label })),
    bars: representation(election, answer.id, groupOf)
      .map((r) => ({ group: r.group, share: r.share, reference: r.reference }))
      .sort((a, b) => a.group.localeCompare(b.group)),
  };
}

export function roundKey(round: GameRound): string {
  return `${round.electionId}/${round.answerId}`;
}
