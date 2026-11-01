import { describe, expect, it } from 'vitest';
import { compareCodes, rankCoords, rankDescending, rankToCoord } from './ranks.ts';

describe('rankToCoord', () => {
  it('applique X = −10 + (20/(N−1))·(N − rang)', () => {
    expect(rankToCoord(1, 30)).toBe(10);
    expect(rankToCoord(30, 30)).toBe(-10);
    expect(rankToCoord(15, 30)).toBeCloseTo(-10 + (20 / 29) * 15, 12);
  });

  it('place une PCS unique au centre de l’axe', () => {
    expect(rankToCoord(1, 1)).toBe(0);
    expect(rankToCoord(1, 1, [0, 4])).toBe(2);
  });

  it('respecte un autre intervalle', () => {
    expect(rankToCoord(1, 3, [0, 1])).toBe(1);
    expect(rankToCoord(2, 3, [0, 1])).toBe(0.5);
    expect(rankToCoord(3, 3, [0, 1])).toBe(0);
  });
});

describe('rankDescending', () => {
  it('classe du score le plus fort au plus faible', () => {
    const ranks = rankDescending([
      { code: 'a', score: 1 },
      { code: 'b', score: 3 },
      { code: 'c', score: 2 },
    ]);
    expect([...ranks.entries()]).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ]);
  });

  it('départage les ex æquo par code, en ordre lexicographique comme le pipeline', () => {
    const ranks = rankDescending([
      { code: '7', score: 5 },
      { code: '69', score: 5 },
      { code: '10', score: 5 },
    ]);
    expect(ranks.get('10')).toBe(1);
    expect(ranks.get('69')).toBe(2);
    expect(ranks.get('7')).toBe(3);
    expect(compareCodes('10', '7')).toBeLessThan(0);
  });

  it('refuse les scores non finis et les codes en double', () => {
    expect(() => rankDescending([{ code: 'a', score: Number.NaN }])).toThrow(RangeError);
    expect(() =>
      rankDescending([
        { code: 'a', score: 1 },
        { code: 'a', score: 2 },
      ]),
    ).toThrow(/double/);
  });
});

describe('rankCoords', () => {
  it('donne +10 au meilleur score et −10 au plus faible', () => {
    const coords = rankCoords([
      { code: 'a', score: 10 },
      { code: 'b', score: 30 },
      { code: 'c', score: 20 },
    ]);
    expect(coords.get('b')).toBe(10);
    expect(coords.get('c')).toBe(0);
    expect(coords.get('a')).toBe(-10);
  });
});
