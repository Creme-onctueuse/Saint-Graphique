import { describe, expect, it } from 'vitest';
import {
  computeLayout,
  continuousCoords,
  defaultParamsFor,
  detectCompositionLevel,
  getClientMethod,
  isClientComputable,
  normalizeParams,
  parseWeights,
  registerClientMethod,
  standardize,
} from './methods.ts';
import { DEFAULT_Y_WEIGHTS } from './scores.ts';
import type { RawPcsItem } from './types.ts';

const diplomes = { bac5: 10, bac3: 10, bac2: 10, bac: 10, cap: 10, brevet: 10, certif_aucun: 40 };

function item(code: string, group: string, population: number, patrimoine: number): RawPcsItem {
  return {
    code,
    group,
    population,
    niveau_vie_mensuel_eur: 2000,
    patrimoine_keur: patrimoine,
    diplomes: { ...diplomes, bac5: patrimoine / 10 },
  };
}

const pcs = [
  item('21', '2', 100, 100),
  item('22', '2', 300, 200),
  item('31', '3', 100, 300),
  item('7', '7', 500, 400),
];

describe('continuousCoords', () => {
  it('standardise sans pondération (ddof = 0)', () => {
    expect(standardize([1, 3])).toEqual([-1, 1]);
    expect(standardize([2, 2])).toEqual([0, 0]);
    expect(standardize([])).toEqual([]);
  });

  it('place exactement le minimum et le maximum sur les bornes', () => {
    const coords = continuousCoords([
      { code: 'a', score: 0.1 },
      { code: 'b', score: 0.2 },
      { code: 'c', score: 0.7 },
    ]);
    expect(coords.get('a')).toBe(-10);
    expect(coords.get('c')).toBe(10);
    expect(coords.get('b')).toBeCloseTo(-10 + 20 * (0.1 / 0.6), 12);
  });

  it('place au centre si tous les scores sont égaux', () => {
    const coords = continuousCoords([
      { code: 'a', score: 3 },
      { code: 'b', score: 3 },
    ]);
    expect(coords.get('a')).toBe(0);
  });

  it('refuse un score non fini', () => {
    expect(() => continuousCoords([{ code: 'a', score: Infinity }])).toThrow(RangeError);
  });
});

describe('normalizeParams', () => {
  it('lit les paramètres de config/methods.yaml, sans la description', () => {
    const p = normalizeParams({
      description: 'ignorée',
      x_score: 'patrimoine_over_niveau_vie',
      y_weights: { ...DEFAULT_Y_WEIGHTS, bac5: 9 },
      retired_y_override: { code: 7, score: -100 },
      candidate_pcs_level: 2,
      range: [-5, 5],
    });
    expect(p.y_weights.bac5).toBe(9);
    expect(p.retired_y_override).toEqual({ code: '7', score: -100 });
    expect(p.candidate_pcs_level).toBe(2);
    expect(p.range).toEqual([-5, 5]);
  });

  it('distingue un score imposé absent (repli) d’un score explicitement nul', () => {
    const fallback = defaultParamsFor('ranks');
    expect(normalizeParams({}, fallback).retired_y_override).toEqual({ code: '7', score: -180 });
    expect(normalizeParams({ retired_y_override: null }, fallback).retired_y_override).toBeNull();
  });

  it('écarte des poids incomplets', () => {
    expect(parseWeights({ bac5: 1 })).toBeNull();
    expect(normalizeParams({ y_weights: { bac5: 1 } }).y_weights).toEqual(DEFAULT_Y_WEIGHTS);
  });
});

describe('registre des méthodes', () => {
  it('connaît les méthodes portées et pas les autres', () => {
    expect(isClientComputable('ranks', defaultParamsFor('ranks'))).toBe(true);
    expect(isClientComputable('continuous', defaultParamsFor('continuous'))).toBe(true);
    expect(isClientComputable('mca', defaultParamsFor('mca'))).toBe(false);
    expect(
      isClientComputable('continuous', { ...defaultParamsFor('continuous'), x_score: 'autre' }),
    ).toBe(false);
  });

  it('permet d’ajouter une méthode en une ligne', () => {
    registerClientMethod({
      id: 'test_axe_plat',
      label: 'Test',
      ranked: false,
      placeAxis: (items) => new Map(items.map((it) => [it.code, 1])),
    });
    expect(getClientMethod('test_axe_plat')?.label).toBe('Test');
    const layout = computeLayout('test_axe_plat', defaultParamsFor('test_axe_plat'), { pcs });
    expect(layout.pcs.every((p) => p.x === 1 && p.y === 1)).toBe(true);
    expect(layout.population_barycenter).toEqual({ x: 1, y: 1 });
  });
});

describe('computeLayout', () => {
  const params = defaultParamsFor('ranks');

  it('calcule rangs, parts de population et barycentre', () => {
    const layout = computeLayout('ranks', params, { pcs });
    const byCode = new Map(layout.pcs.map((p) => [p.code, p]));
    expect(byCode.get('7')?.x).toBe(10);
    expect(byCode.get('21')?.x).toBe(-10);
    expect(byCode.get('7')?.y).toBe(-10); // score imposé : -180
    expect(byCode.get('7')?.weight).toBe(50);
    const expectedX =
      (100 * (byCode.get('21')?.x ?? 0) +
        300 * (byCode.get('22')?.x ?? 0) +
        100 * (byCode.get('31')?.x ?? 0) +
        500 * (byCode.get('7')?.x ?? 0)) /
      1000;
    expect(layout.population_barycenter.x).toBeCloseTo(expectedX, 12);
    expect(layout.candidates).toEqual([]);
  });

  it('place les électorats de niveau 1 sur les barycentres de groupes', () => {
    const layout = computeLayout('ranks', params, {
      pcs,
      election: {
        pcs_level: 1,
        candidates: [{ id: 'a' }, { id: 'b' }, { id: 'vide' }, { id: 'inconnu' }],
        composition: { a: { '2': 50, '7': 50 }, b: { '3': 100, '8': 40 }, vide: {} },
      },
    });
    const group2 = layout.groups.get('2');
    const group7 = layout.groups.get('7');
    const group3 = layout.groups.get('3');
    expect(layout.candidates.map((c) => c.id)).toEqual(['a', 'b']);
    expect(layout.candidates[0]?.x).toBeCloseTo(((group2?.x ?? 0) + (group7?.x ?? 0)) / 2, 12);
    // La clé « 8 » n'a pas de coordonnées : l'électorat b tombe sur le groupe 3.
    expect(layout.candidates[1]).toMatchObject({ x: group3?.x, y: group3?.y });
  });

  it('somme par groupe une composition de niveau 2 quand la méthode travaille au niveau 1', () => {
    const election = {
      pcs_level: 2 as const,
      candidates: [{ id: 'a' }],
      composition: { a: { '21': 10, '22': 30, '7': 40, '81': 20 } },
    };
    const layout = computeLayout('ranks', params, { pcs, election });
    const g2 = layout.groups.get('2');
    const g7 = layout.groups.get('7');
    expect(layout.candidates[0]?.x).toBeCloseTo(((g2?.x ?? 0) * 40 + (g7?.x ?? 0) * 40) / 80, 12);
  });

  it('utilise les PCS détaillées si la méthode ET la composition sont de niveau 2', () => {
    const layout = computeLayout(
      'ranks',
      { ...params, candidate_pcs_level: 2 },
      {
        pcs,
        election: { pcs_level: 2, candidates: [{ id: 'a' }], composition: { a: { '21': 1 } } },
      },
    );
    const p21 = layout.pcs.find((p) => p.code === '21');
    expect(layout.candidates[0]).toMatchObject({ x: p21?.x, y: p21?.y });
  });

  it('déduit le niveau d’une composition de ses clés (« 7 » est ambigu)', () => {
    expect(detectCompositionLevel({ a: { '2': 1, '7': 1 } }, pcs)).toBe(1);
    expect(detectCompositionLevel({ a: { '21': 1, '7': 1 } }, pcs)).toBe(2);
  });

  it('refuse une méthode inconnue, un score X inconnu ou des données vides', () => {
    expect(() => computeLayout('mca', params, { pcs })).toThrow(/mca/);
    expect(() => computeLayout('continuous', { ...params, x_score: 'autre' }, { pcs })).toThrow(
      /autre/,
    );
    expect(() => computeLayout('continuous', params, { pcs: [] })).toThrow(/PCS/);
  });
});
