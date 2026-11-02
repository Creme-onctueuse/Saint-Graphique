/** Espace social : cas vérifiable à la main et invariants (portage de espace_social.py). */
import { describe, expect, it } from 'vitest';
import {
  computeLayout,
  defaultParamsFor,
  espaceSocialScores,
  getClientMethod,
  isClientComputable,
  methodScores,
  STUDY_YEARS,
  weightedStandardize,
} from './methods.ts';
import type { DiplomaKey, RawPcsItem } from './types.ts';

const NOTHING = { bac5: 0, bac3: 0, bac2: 0, bac: 0, cap: 0, brevet: 0, certif_aucun: 0 };

/** PCS dont le patrimoine et le niveau de vie valent e^money, tous diplômés de `diploma`. */
function item(
  code: string,
  group: string,
  population: number,
  money: number,
  diploma: DiplomaKey,
): RawPcsItem {
  return {
    code,
    group,
    population,
    niveau_vie_mensuel_eur: Math.exp(money),
    patrimoine_keur: Math.exp(money),
    diplomes: { ...NOTHING, [diploma]: 100 },
  };
}

/** E vaut -1 ou +1 (ln à -1 ou +1), C aussi (score -100 pour le CAP, +500 pour le bac+5). */
const SQUARE = [
  item('61', '6', 10, -1, 'cap'), // E = -1, C = -1 : peu des deux
  item('34', '3', 10, -1, 'bac5'), // E = -1, C = +1 : surtout culturel
  item('23', '2', 10, 1, 'cap'), // E = +1, C = -1 : surtout économique
  item('31', '3', 10, 1, 'bac5'), // E = +1, C = +1 : beaucoup des deux
];

const params = defaultParamsFor('espace_social');

function positions(pcs: readonly RawPcsItem[]): Map<string, { x: number; y: number }> {
  return new Map(computeLayout('espace_social', params, { pcs }).pcs.map((p) => [p.code, p]));
}

describe('weightedStandardize', () => {
  it('calcule moyenne et écart-type pondérés', () => {
    // Moyenne (3·1 + 1·5) / 4 = 2 ; variance (3·1 + 1·9) / 4 = 3.
    const [a, b] = weightedStandardize([1, 5], [3, 1]);
    expect(a).toBeCloseTo(-1 / Math.sqrt(3), 12);
    expect(b).toBeCloseTo(3 / Math.sqrt(3), 12);
  });

  it('place une valeur de poids nul sur l’échelle des autres', () => {
    expect(weightedStandardize([0, 2, 5], [1, 1, 0])).toEqual([-1, 1, 4]);
  });

  it('gère les cas dégénérés', () => {
    expect(weightedStandardize([3, 3], [1, 2])).toEqual([0, 0]);
    expect(() => weightedStandardize([1, 2], [0, 0])).toThrow(RangeError);
    expect(() => weightedStandardize([1, Number.NaN], [1, 1])).toThrow(RangeError);
  });
});

describe('espace social', () => {
  it('place les quatre coins du plan (E, C) à la main', () => {
    const at = positions(SQUARE);
    const expected: Record<string, [number, number]> = {
      '61': [0, -10],
      '34': [-10, 0],
      '23': [10, 0],
      '31': [0, 10],
    };
    for (const [code, [x, y]] of Object.entries(expected)) {
      expect(at.get(code)?.x, code).toBeCloseTo(x, 9);
      expect(at.get(code)?.y, code).toBeCloseTo(y, 9);
    }
  });

  it('structure = E − C et volume = E + C', () => {
    const scores = espaceSocialScores(SQUARE, STUDY_YEARS);
    const cultural = scores.find((s) => s.code === '34');
    expect(cultural?.x).toBeCloseTo(-2, 12);
    expect(cultural?.y).toBeCloseTo(0, 12);
    expect(scores.find((s) => s.code === '23')?.x).toBeCloseTo(2, 12);
  });

  it('place les retraités sans leur laisser fixer l’échelle', () => {
    const base = positions(SQUARE);
    const at = positions([...SQUARE, item('7', '7', 1e6, -1, 'cap')]);
    for (const code of ['61', '34', '23', '31']) {
      expect(at.get(code)?.x, code).toBeCloseTo(base.get(code)?.x ?? Number.NaN, 9);
      expect(at.get(code)?.y, code).toBeCloseTo(base.get(code)?.y ?? Number.NaN, 9);
    }
    expect(at.get('7')?.x).toBeCloseTo(at.get('61')?.x ?? Number.NaN, 9);
    expect(at.get('7')?.y).toBeCloseTo(at.get('61')?.y ?? Number.NaN, 9);
    const layout = computeLayout('espace_social', params, {
      pcs: [...SQUARE, item('7', '7', 1e6, -1, 'cap')],
    });
    expect(layout.population_barycenter.y).toBeCloseTo(-10, 2);
  });

  it('utilise les diplômes des retraités tels quels : moins diplômés, plus à droite et plus bas', () => {
    const low = positions([...SQUARE, item('7', '7', 100, 0, 'brevet')]).get('7');
    const high = positions([...SQUARE, item('7', '7', 100, 0, 'bac')]).get('7');
    expect(low?.x ?? 0).toBeGreaterThan(high?.x ?? 0);
    expect(low?.y ?? 0).toBeLessThan(high?.y ?? 0);
  });

  it('atteint exactement les bornes et y reste', () => {
    const pcs = [...SQUARE, item('7', '7', 50, 0.2, 'bac')];
    const layout = computeLayout('espace_social', params, { pcs });
    const xs = layout.pcs.map((p) => p.x);
    const ys = layout.pcs.map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([
      -10, 10, -10, 10,
    ]);
    const total = layout.pcs.reduce((acc, p) => acc + p.weight, 0);
    expect(total).toBeCloseTo(100, 9);
  });

  it('ne dépend ni de l’unité monétaire, ni de l’échelle des effectifs', () => {
    const base = positions(SQUARE);
    const scaled = SQUARE.map((it) => ({
      ...it,
      population: it.population * 7,
      patrimoine_keur: it.patrimoine_keur * 1000,
      niveau_vie_mensuel_eur: it.niveau_vie_mensuel_eur * 12,
    }));
    const at = positions(scaled);
    for (const code of ['61', '34', '23', '31']) {
      expect(at.get(code)?.x, code).toBeCloseTo(base.get(code)?.x ?? Number.NaN, 9);
      expect(at.get(code)?.y, code).toBeCloseTo(base.get(code)?.y ?? Number.NaN, 9);
    }
  });

  it('ne dépend que des écarts entre poids, car les parts somment à 100', () => {
    const base = positions(SQUARE);
    const shifted = Object.fromEntries(
      Object.entries(STUDY_YEARS).map(([k, v]) => [k, v + 4]),
    ) as typeof STUDY_YEARS;
    const layout = computeLayout(
      'espace_social',
      { ...params, y_weights: { ...shifted } },
      { pcs: SQUARE },
    );
    for (const p of layout.pcs) {
      expect(p.x, p.code).toBeCloseTo(base.get(p.code)?.x ?? Number.NaN, 9);
      expect(p.y, p.code).toBeCloseTo(base.get(p.code)?.y ?? Number.NaN, 9);
    }
  });

  it('refuse un patrimoine nul : le logarithme n’existe pas', () => {
    const broke = SQUARE.map((it) => (it.code === '34' ? { ...it, patrimoine_keur: 0 } : it));
    expect(() => positions(broke)).toThrow(/PCS 34/);
  });

  it('se recalcule, avec ses propres poids, sans score imposé aux retraités', () => {
    expect(isClientComputable('espace_social', params)).toBe(true);
    expect(params.y_weights).toEqual(STUDY_YEARS);
    expect(params.retired_y_override).toBeNull();
    const client = getClientMethod('espace_social');
    expect(client?.retiredOverride).toBe(false);
    expect(client?.tuningNote).toMatch(/capital culturel/);
  });

  it('a ses propres scores, les autres méthodes gardent les leurs', () => {
    const own = methodScores('espace_social', SQUARE, params);
    expect(own).toEqual(espaceSocialScores(SQUARE, STUDY_YEARS));
    const ranks = methodScores('ranks', SQUARE, defaultParamsFor('ranks'));
    expect(ranks.find((s) => s.code === '61')?.x).toBeCloseTo(100, 9); // ratio : e⁻¹ / e⁻¹ × 100
  });
});
