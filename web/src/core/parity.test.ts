import { describe, expect, it } from 'vitest';
import { parityCases, parityDiff, parityTolerance, runParityCase } from './parity.ts';
import { DEFAULT_Y_WEIGHTS } from './scores.ts';

// La fixture est produite par WP3 (python -m pipeline.build --parity) : le test est ignoré sans elle.
const fixtures = import.meta.glob<unknown>('./__fixtures__/parity.json', {
  eager: true,
  import: 'default',
});
const fixture = fixtures['./__fixtures__/parity.json'];

describe.skipIf(fixture === undefined)('parité avec le pipeline Python (fixture)', () => {
  const cases = fixture === undefined ? [] : parityCases(fixture);
  const tolerance = fixture === undefined ? 0 : parityTolerance(fixture);

  it('contient au moins un cas', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(parityDiff(c, runParityCase(c), tolerance)).toEqual([]);
  });
});

describe('lecture de la fixture', () => {
  const pcs = [
    {
      code: '21',
      group: '2',
      population: 1,
      niveau_vie_mensuel_eur: 1000,
      patrimoine_keur: 100,
      diplomes: { bac5: 0, bac3: 0, bac2: 0, bac: 0, cap: 100, brevet: 0, certif_aucun: 0 },
    },
    {
      code: '31',
      group: '3',
      population: 1,
      niveau_vie_mensuel_eur: 1000,
      patrimoine_keur: 300,
      diplomes: { bac5: 100, bac3: 0, bac2: 0, bac: 0, cap: 0, brevet: 0, certif_aucun: 0 },
    },
  ];
  const params = {
    x_score: 'patrimoine_over_niveau_vie',
    y_weights: DEFAULT_Y_WEIGHTS,
    retired_y_override: null,
    candidate_pcs_level: 1,
    range: [-10, 10],
  };
  const expected = {
    pcs: [
      { code: '21', x: -10, y: -10 },
      { code: '31', x: 10, y: 10 },
    ],
    candidates: [{ id: 'a', x: 5, y: 5 }],
  };

  it('accepte la forme du pipeline (entrée globale et election_id)', () => {
    const doc = {
      tolerance: 1e-9,
      input: {
        pcs,
        elections: [
          {
            id: 'e',
            pcs_level: 1,
            candidates: [{ id: 'a' }],
            composition: { a: { '2': 25, '3': 75 } },
          },
        ],
      },
      cases: [
        {
          method: 'ranks_chris_v1',
          election_id: 'e',
          params,
          expected: { ...expected, population_barycenter: { x: 0, y: 0 } },
        },
      ],
    };
    const [c] = parityCases(doc);
    expect(c).toBeDefined();
    if (c) expect(parityDiff(c, runParityCase(c), parityTolerance(doc))).toEqual([]);
  });

  it('accepte la forme compacte (entrée par cas)', () => {
    const doc = {
      cases: [
        {
          method: 'continuous',
          params,
          input: {
            pcs,
            composition: { a: { '2': 25, '3': 75 } },
            candidates: [{ id: 'a' }],
          },
          expected,
        },
      ],
    };
    const [c] = parityCases(doc);
    expect(c).toBeDefined();
    expect(parityTolerance(doc)).toBe(1e-9);
    if (c) expect(parityDiff(c, runParityCase(c), 1e-9)).toEqual([]);
  });

  it('signale les écarts, les manques et les éléments en trop', () => {
    const [c] = parityCases({
      cases: [
        {
          method: 'ranks_chris_v1',
          params,
          input: { pcs, composition: { a: { '2': 1 } }, candidates: [{ id: 'a' }] },
          expected: {
            pcs: [{ code: '21', x: 0, y: -10 }],
            candidates: [{ id: 'absent', x: 0, y: 0 }],
          },
        },
      ],
    });
    expect(c).toBeDefined();
    if (!c) return;
    const issues = parityDiff(c, runParityCase(c), 1e-9);
    expect(issues.some((i) => i.startsWith('pcs 21'))).toBe(true);
    expect(issues.some((i) => i.includes('absent'))).toBe(true);
    expect(issues.some((i) => i.includes('2 PCS au lieu de 1'))).toBe(true);
  });

  it('refuse une fixture incomplète', () => {
    expect(() => parityCases({ cases: [{ method: 'm', expected }] })).toThrow(/PCS/);
    expect(() =>
      parityCases({ input: { pcs }, cases: [{ method: 'm', election_id: 'x', expected }] }),
    ).toThrow(/élection x/);
  });
});
