/**
 * Lecture de la fixture de parité Python/TypeScript (src/core/__fixtures__/parity.json, écrite par
 * `python -m pipeline.build --parity`) et comparaison avec le portage TypeScript.
 *
 * Deux formes sont acceptées :
 * - celle du pipeline : `input` global (`pcs`, `elections`), chaque cas désigne son `election_id` ;
 * - la forme compacte : chaque cas porte son propre `input` (`pcs`, `composition`, `candidates`).
 */
import {
  computeLayout,
  defaultParamsFor,
  normalizeParams,
  type Layout,
  type LayoutElection,
} from './methods.ts';
import type { Composition, RawPcsItem } from './types.ts';

interface ExpectedPoint {
  x: number;
  y: number;
}

export interface ParityExpected {
  pcs: (ExpectedPoint & { code: string })[];
  groups?: (ExpectedPoint & { code: string })[];
  candidates: (ExpectedPoint & { id: string })[];
  population_barycenter?: ExpectedPoint;
}

export interface ParityCase {
  name: string;
  method: string;
  params: unknown;
  pcs: RawPcsItem[];
  election: LayoutElection | null;
  expected: ParityExpected;
}

interface RawInput {
  pcs?: RawPcsItem[];
  elections?: (LayoutElection & { id: string })[];
  composition?: Composition;
  candidates?: { id: string }[];
  pcs_level?: 1 | 2;
}

interface RawCase {
  method: string;
  params?: unknown;
  election_id?: string;
  input?: RawInput;
  expected: ParityExpected;
}

interface RawDocument {
  input?: RawInput;
  tolerance?: number;
  cases?: RawCase[];
}

/** Tolérance de la fixture, 1e-9 par défaut. */
export function parityTolerance(doc: unknown): number {
  const t = (doc as RawDocument).tolerance;
  return typeof t === 'number' && t > 0 ? t : 1e-9;
}

/** Normalise la fixture en une liste de cas exécutables. */
export function parityCases(doc: unknown): ParityCase[] {
  const root = doc as RawDocument;
  return (root.cases ?? []).map((c, i) => {
    const input = c.input ?? root.input;
    const pcs = input?.pcs;
    if (!pcs) throw new Error(`Cas de parité ${i} : données PCS absentes`);
    let election: LayoutElection | null = null;
    if (c.election_id !== undefined) {
      const found = input?.elections?.find((e) => e.id === c.election_id);
      if (!found) throw new Error(`Cas de parité ${i} : élection ${c.election_id} absente`);
      election = found;
    } else if (input?.composition) {
      election = {
        candidates: input.candidates ?? Object.keys(input.composition).map((id) => ({ id })),
        composition: input.composition,
        ...(input.pcs_level ? { pcs_level: input.pcs_level } : {}),
      };
    }
    return {
      name: `${c.method} / ${c.election_id ?? `cas ${i}`}`,
      method: c.method,
      params: c.params,
      pcs,
      election,
      expected: c.expected,
    };
  });
}

/** Exécute un cas avec le portage TypeScript. */
export function runParityCase(c: ParityCase): Layout {
  const params = normalizeParams(c.params, defaultParamsFor(c.method));
  return computeLayout(c.method, params, { pcs: c.pcs, election: c.election });
}

/** Écarts à la valeur attendue au-delà de la tolérance (liste vide si tout concorde). */
export function parityDiff(c: ParityCase, got: Layout, tolerance: number): string[] {
  const issues: string[] = [];
  const compare = (where: string, a: ExpectedPoint | undefined, b: ExpectedPoint): void => {
    if (!a) {
      issues.push(`${where} : absent`);
      return;
    }
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (!(dx <= tolerance) || !(dy <= tolerance)) {
      issues.push(`${where} : (${a.x}, ${a.y}) au lieu de (${b.x}, ${b.y})`);
    }
  };
  const pcs = new Map(got.pcs.map((p) => [p.code, p]));
  for (const e of c.expected.pcs) compare(`pcs ${e.code}`, pcs.get(e.code), e);
  if (got.pcs.length !== c.expected.pcs.length) {
    issues.push(`${got.pcs.length} PCS au lieu de ${c.expected.pcs.length}`);
  }
  for (const e of c.expected.groups ?? []) compare(`groupe ${e.code}`, got.groups.get(e.code), e);
  const candidates = new Map(got.candidates.map((p) => [p.id, p]));
  for (const e of c.expected.candidates) compare(`candidat ${e.id}`, candidates.get(e.id), e);
  if (got.candidates.length !== c.expected.candidates.length) {
    issues.push(`${got.candidates.length} candidats au lieu de ${c.expected.candidates.length}`);
  }
  if (c.expected.population_barycenter) {
    compare('barycentre', got.population_barycenter, c.expected.population_barycenter);
  }
  return issues;
}
