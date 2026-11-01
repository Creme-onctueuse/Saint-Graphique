import { describe, expect, it } from 'vitest';
import { computeScores, DEFAULT_Y_WEIGHTS, sameWeights, xScore, yScore } from './scores.ts';
import type { DiplomaShares, RawPcsItem } from './types.ts';

const diplomes: DiplomaShares = {
  bac5: 10,
  bac3: 20,
  bac2: 30,
  bac: 15,
  cap: 10,
  brevet: 5,
  certif_aucun: 10,
};

function item(code: string, patch: Partial<RawPcsItem> = {}): RawPcsItem {
  return {
    code,
    group: code.charAt(0),
    population: 100,
    niveau_vie_mensuel_eur: 2000,
    patrimoine_keur: 300,
    diplomes,
    ...patch,
  };
}

describe('xScore', () => {
  it('vaut patrimoine / niveau de vie × 100', () => {
    expect(xScore(item('10'))).toBeCloseTo(15, 12);
  });

  it('refuse un niveau de vie nul', () => {
    expect(() => xScore(item('10', { niveau_vie_mensuel_eur: 0 }))).toThrow(/niveau de vie/i);
  });

  it('refuse un patrimoine non fini', () => {
    expect(() => xScore(item('10', { patrimoine_keur: Number.NaN }))).toThrow(/patrimoine/i);
  });
});

describe('yScore', () => {
  it('fait la somme pondérée des parts de diplômes', () => {
    // 5·10 + 3·20 + 2·30 + 15 − 10 − 2·5 − 3·10
    expect(yScore(diplomes, DEFAULT_Y_WEIGHTS)).toBe(135);
  });

  it('suit des poids paramétrables', () => {
    expect(yScore(diplomes, { ...DEFAULT_Y_WEIGHTS, bac5: 0 })).toBe(85);
  });
});

describe('computeScores', () => {
  it('impose le score Y demandé sans toucher au score X ni aux autres PCS', () => {
    const scores = computeScores([item('10'), item('7')], DEFAULT_Y_WEIGHTS, {
      code: '7',
      score: -180,
    });
    expect(scores[0]?.y).toBe(135);
    expect(scores[1]?.y).toBe(-180);
    expect(scores[1]?.x).toBeCloseTo(15, 12);
  });

  it('calcule tous les scores sans score imposé', () => {
    const scores = computeScores([item('7')], DEFAULT_Y_WEIGHTS);
    expect(scores[0]?.y).toBe(135);
  });
});

describe('sameWeights', () => {
  it('compare les sept poids', () => {
    expect(sameWeights(DEFAULT_Y_WEIGHTS, { ...DEFAULT_Y_WEIGHTS })).toBe(true);
    expect(sameWeights(DEFAULT_Y_WEIGHTS, { ...DEFAULT_Y_WEIGHTS, cap: 0 })).toBe(false);
  });
});
