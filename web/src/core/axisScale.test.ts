import { describe, expect, it } from 'vitest';
import { logIsPossible, logTickValues, scaleMapping } from './axisScale.ts';

const RANGE = [-10, 10] as const;

describe('échelle logarithmique', () => {
  const values = [10, 100, 1000];
  const log = scaleMapping('log', values, RANGE);

  it('place le minimum et le maximum aux bords, et la moyenne géométrique au centre', () => {
    expect(log.toPosition(10)).toBeCloseTo(-10);
    expect(log.toPosition(1000)).toBeCloseTo(10);
    expect(log.toPosition(100)).toBeCloseTo(0);
  });

  it('retrouve la valeur réelle d’une position', () => {
    for (const v of [10, 37, 100, 640, 1000]) expect(log.toValue(log.toPosition(v))).toBeCloseTo(v);
  });

  it('écarte davantage les petites valeurs que l’échelle linéaire', () => {
    const linear = scaleMapping('linear', values, RANGE);
    expect(log.toPosition(100)).toBeGreaterThan(linear.toPosition(100));
  });

  it('n’est pas possible avec un zéro ou une valeur négative', () => {
    expect(logIsPossible([1, 2])).toBe(true);
    expect(logIsPossible([0, 2])).toBe(false);
    expect(logIsPossible([-1, 2])).toBe(false);
    expect(logIsPossible([])).toBe(false);
  });

  it('centre une variable sans écart', () => {
    expect(scaleMapping('log', [5, 5], RANGE).toPosition(5)).toBe(0);
  });
});

describe('échelle de rang', () => {
  const rank = scaleMapping('rank', [1, 2, 3, 1000], RANGE);

  it('espace les catégories régulièrement, quel que soit l’écart des valeurs', () => {
    expect(rank.toPosition(1)).toBeCloseTo(-10);
    expect(rank.toPosition(2)).toBeCloseTo(-10 / 3);
    expect(rank.toPosition(3)).toBeCloseTo(10 / 3);
    expect(rank.toPosition(1000)).toBeCloseTo(10);
  });

  it('donne le même rang à des valeurs égales', () => {
    const tied = scaleMapping('rank', [1, 5, 5, 9], RANGE);
    expect(tied.toPosition(5)).toBeCloseTo(0);
    expect(tied.toPosition(1)).toBeCloseTo(-10);
    expect(tied.toPosition(9)).toBeCloseTo(10);
  });

  it('retrouve les vraies valeurs aux positions des catégories, sans dépasser les extrêmes', () => {
    for (const v of [1, 2, 3, 1000]) expect(rank.toValue(rank.toPosition(v))).toBeCloseTo(v);
    expect(rank.toValue(-12)).toBe(1);
    expect(rank.toValue(12)).toBe(1000);
  });

  it('centre une variable sans écart', () => {
    expect(scaleMapping('rank', [7, 7], RANGE).toPosition(7)).toBe(0);
  });
});

describe('échelle linéaire', () => {
  it('garde les écarts réels', () => {
    const linear = scaleMapping('linear', [0, 100], RANGE);
    expect(linear.toPosition(25)).toBeCloseTo(-5);
    expect(linear.toValue(5)).toBeCloseTo(75);
  });
});

describe('graduations logarithmiques', () => {
  it('donne des valeurs rondes dans l’intervalle', () => {
    expect(logTickValues(32, 1532, 5)).toEqual([50, 100, 200, 500, 1000]);
    expect(logTickValues(1.6, 74, 5)).toEqual([2, 5, 10, 20, 50]);
  });

  it('se resserre sur un petit intervalle', () => {
    expect(logTickValues(1100, 6000, 5)).toEqual([2000, 3000, 5000]);
  });

  it('garde les bornes malgré l’arrondi', () => {
    expect(logTickValues(Math.exp(Math.log(10)), Math.exp(Math.log(1000)), 5)).toEqual([
      10, 100, 1000,
    ]);
  });

  it('renonce quand trois valeurs rondes ne tiennent pas', () => {
    expect(logTickValues(2100, 2200, 5)).toBeNull();
    expect(logTickValues(0, 10, 5)).toBeNull();
    expect(logTickValues(5, 5, 5)).toBeNull();
  });
});
