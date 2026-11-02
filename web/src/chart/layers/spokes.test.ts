import { describe, expect, it } from 'vitest';
import type { ChartPcs } from '../types.ts';
import { spokesOf, spokeWidth } from './spokes.ts';

function pcs(code: string, group: string, x: number, weight: number): ChartPcs {
  return {
    code,
    group,
    label: code,
    short: code,
    groupLabel: group,
    color: '#000',
    x,
    y: 0,
    weight,
    status: null,
    notes: [],
  };
}

const map = [
  pcs('10', '1', 0, 1),
  pcs('21', '2', 10, 1),
  pcs('31', '3', 4, 3),
  pcs('37', '3', 8, 1),
];

describe('spokesOf', () => {
  it('relie chaque groupe, du plus lourd au plus léger', () => {
    const spokes = spokesOf(map, { '2': 20, '3': 80 });
    expect(spokes.map((s) => s.group)).toEqual(['3', '2']);
  });

  it('va au centre pondéré du groupe', () => {
    const spoke = spokesOf(map, { '3': 100 })[0];
    expect(spoke?.to.x).toBeCloseTo(5);
  });

  it('réunit agriculteurs et indépendants sous la clé « 2 »', () => {
    const spoke = spokesOf(map, { '2': 100 })[0];
    expect(spoke?.to.x).toBeCloseTo(5);
  });

  it('ignore un groupe sans catégorie ou sans électeur', () => {
    expect(spokesOf(map, { '7': 50, '3': 0 })).toEqual([]);
  });
});

describe('spokeWidth', () => {
  it('grandit avec la part de l’électorat', () => {
    expect(spokeWidth(50)).toBeGreaterThan(spokeWidth(10));
    expect(spokeWidth(0)).toBeGreaterThan(0);
  });
});
