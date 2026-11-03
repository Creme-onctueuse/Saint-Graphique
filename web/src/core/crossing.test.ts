import { describe, expect, it } from 'vitest';
import {
  compositionByGroup,
  compositionGap,
  groupBase,
  hasAbstentionBreakdown,
  pollGroupOf,
  registeredShares,
  representation,
  voteByGroup,
} from './crossing.ts';
import type { RawElection } from './types.ts';

const election: RawElection = {
  id: 'test',
  type: 'presidentielle',
  year: 2022,
  label: 'Test',
  pcs_level: 1,
  sources: [],
  candidates: [
    { id: 'a', label: 'A', color: '#000', national_share_pct: 60 },
    { id: 'b', label: 'B', color: '#000', national_share_pct: 40 },
    { id: 'abst', label: 'Abstention', color: '#000', national_share_pct: 50, is_abstention: true },
  ],
  composition: {
    a: { '3': 50, '6': 50 },
    b: { '3': 25, '6': 75 },
    abst: { '3': 20, '6': 80 },
  },
};

describe('registeredShares', () => {
  it('rapporte les scores aux inscrits', () => {
    const r = registeredShares(election);
    expect(r.get('a')).toBeCloseTo(30);
    expect(r.get('b')).toBeCloseTo(20);
    expect(r.get('abst')).toBeCloseTo(50);
    expect([...r.values()].reduce((x, y) => x + y, 0)).toBeCloseTo(100);
  });
});

describe('voteByGroup', () => {
  const { votes, weights } = voteByGroup(election);

  it('donne le vote de chaque groupe, qui somme à 100', () => {
    // Cadres : A 30·50 %, B 20·25 %, abstention 50·20 %, soit 15 + 5 + 10 = 30 points.
    expect(weights.get('3')).toBeCloseTo(30);
    expect(votes.get('3')?.get('a')).toBeCloseTo(50);
    expect(votes.get('3')?.get('b')).toBeCloseTo((100 * 5) / 30);
    for (const row of votes.values()) {
      expect([...row.values()].reduce((x, y) => x + y, 0)).toBeCloseTo(100);
    }
  });

  it('donne le poids des groupes parmi les inscrits, qui somme à 100', () => {
    expect([...weights.values()].reduce((x, y) => x + y, 0)).toBeCloseTo(100);
  });

  it('agrège un sondage de niveau 2 par groupe', () => {
    const level2: RawElection = {
      ...election,
      pcs_level: 2,
      composition: { a: { '31': 30, '37': 20, '62': 50 } },
      candidates: [{ id: 'a', label: 'A', color: '#000', national_share_pct: 100 }],
    };
    const groupOf = (code: string): string => code.charAt(0);
    expect(compositionByGroup(level2, 'a', groupOf)).toEqual({ '3': 50, '6': 50 });
    expect(voteByGroup(level2, groupOf).votes.get('3')?.get('a')).toBeCloseTo(100);
  });
});

describe('compositionGap', () => {
  it('vaut 0 pour deux compositions identiques et 100 sans groupe commun', () => {
    expect(compositionGap({ '3': 40, '6': 60 }, { '3': 40, '6': 60 })).toBe(0);
    expect(compositionGap({ '3': 100 }, { '6': 100 })).toBe(100);
  });

  it('compte les électeurs à déplacer', () => {
    expect(compositionGap({ '3': 50, '6': 50 }, { '3': 25, '6': 75 })).toBe(25);
  });
});

describe('representation', () => {
  it('range les groupes du plus surreprésenté au plus sous-représenté', () => {
    const rows = representation(election, 'a');
    expect(rows[0]?.group).toBe('3');
    expect(rows[0]?.reference).toBeCloseTo(30);
    expect(rows[0]?.delta).toBeCloseTo(20);
    expect(rows.at(-1)?.delta).toBeCloseTo(-20);
  });
});

describe('pollGroupOf', () => {
  const available = new Set(['2', '3', '4', '5', '6', '7']);

  it('rattache les agriculteurs aux indépendants', () => {
    expect(pollGroupOf('1', available)).toBe('2');
  });

  it('garde un groupe présent au tableau', () => {
    expect(pollGroupOf('6', available)).toBe('6');
  });

  it('signale un groupe sans donnée de vote', () => {
    expect(pollGroupOf('8', available)).toBeNull();
  });
});

describe('abstention connue par son seul taux', () => {
  const rateOnly: RawElection = {
    ...election,
    composition: {
      a: { '3': 50, '6': 50 },
      b: { '3': 25, '6': 75 },
    },
  };

  it('se repère à l’absence de composition', () => {
    expect(hasAbstentionBreakdown(election)).toBe(true);
    expect(hasAbstentionBreakdown(rateOnly)).toBe(false);
    expect(groupBase(election)).toBe('inscrits');
    expect(groupBase(rateOnly)).toBe('votants');
  });

  it('réduit quand même les scores aux inscrits', () => {
    expect(registeredShares(rateOnly).get('a')).toBeCloseTo(30);
    expect(registeredShares(rateOnly).get('abst')).toBe(50);
  });

  it('ramène le poids des groupes à 100, parmi les votants', () => {
    const { weights, votes } = voteByGroup(rateOnly);
    expect(weights.get('3')).toBeCloseTo(40);
    expect(weights.get('6')).toBeCloseTo(60);
    expect(votes.get('3')?.get('a')).toBeCloseTo(75);
    expect(votes.get('3')?.has('abst')).toBe(false);
  });
});
