import { describe, expect, it } from 'vitest';
import type { Scale } from './geometry.ts';
import { pickKey, type PickContext } from './pick.ts';
import type { ChartCandidate, ChartModel, ChartPcs } from './types.ts';

/** Une unité de données vaut un pixel : les distances se lisent directement. */
const identity = ((v: number) => v) as unknown as Scale;

const plot = { x: 0, y: 0, w: 400, h: 400 };

function pcs(code: string, x: number, y: number): ChartPcs {
  return { code, x, y, weight: 0 } as unknown as ChartPcs;
}

function cand(id: string, x: number, y: number, share: number | null = null): ChartCandidate {
  return { id, x, y, share } as unknown as ChartCandidate;
}

function ctx(
  points: { pcs?: ChartPcs[]; candidates?: ChartCandidate[]; barycenter?: unknown },
  hidden: { groups?: string[]; candidates?: string[] } = {},
): PickContext {
  return {
    model: { pcs: [], candidates: [], barycenter: null, ...points } as unknown as ChartModel,
    view: {
      hiddenGroups: new Set(hidden.groups ?? []),
      hiddenCandidates: new Set(hidden.candidates ?? []),
    },
    geom: { plot, unit: 10 },
    x: identity,
    y: identity,
  };
}

describe('pickKey', () => {
  it('ne réagit pas dans la bande des axes', () => {
    expect(pickKey(-1, 100, ctx({ candidates: [cand('a', 0, 100)] }))).toBeNull();
    expect(pickKey(100, 401, ctx({ candidates: [cand('a', 100, 400)] }))).toBeNull();
  });

  it('vise le repère le plus proche', () => {
    const points = { candidates: [cand('a', 100, 100), cand('b', 110, 100)] };
    expect(pickKey(102, 100, ctx(points))).toBe('c:a');
    expect(pickKey(108, 100, ctx(points))).toBe('c:b');
  });

  it('ignore ce qui est masqué', () => {
    const points = { candidates: [cand('a', 100, 100), cand('b', 110, 100)] };
    expect(pickKey(102, 100, ctx(points, { candidates: ['a'] }))).toBe('c:b');
    const hiddenGroup = { pcs: [{ ...pcs('10', 100, 100), group: '1' }] };
    expect(pickKey(100, 100, ctx(hiddenGroup, { groups: ['1'] }))).toBeNull();
  });

  it('hors de tout point, prend la plus petite bulle sous le pointeur', () => {
    const points = { candidates: [cand('grande', 100, 100, 100), cand('petite', 130, 100, 25)] };
    expect(pickKey(120, 100, ctx(points))).toBe('c:petite');
  });

  it('ne vise le barycentre que sur son anneau', () => {
    const barycenter = { x: 200, y: 200 };
    expect(pickKey(200, 200, ctx({ barycenter }))).toBeNull();
    expect(pickKey(300, 300, ctx({ barycenter }))).toBeNull();
  });

  it('ne renvoie rien loin de tout', () => {
    expect(pickKey(300, 300, ctx({ candidates: [cand('a', 100, 100)] }))).toBeNull();
  });
});
