import { describe, expect, it } from 'vitest';
import { duelRows, misleadinglyClose, neighbors } from './compare.ts';
import type { RawElection } from './types.ts';

const election: RawElection = {
  id: 'e',
  type: 'presidentielle',
  year: 2022,
  label: 'E',
  pcs_level: 1,
  sources: [],
  candidates: [
    { id: 'a', label: 'A', color: '#000' },
    { id: 'b', label: 'B', color: '#000' },
    { id: 'c', label: 'C', color: '#000' },
    { id: 'sans-position', label: 'D', color: '#000' },
  ],
  composition: {
    a: { '3': 50, '6': 50 },
    b: { '3': 40, '6': 60 },
    c: { '3': 0, '6': 100 },
    'sans-position': { '3': 50, '6': 50 },
  },
};

const positions = new Map([
  ['a', { x: 0, y: 0 }],
  ['b', { x: 3, y: 4 }],
  ['c', { x: 1, y: 0 }],
]);

describe('neighbors', () => {
  it('classe par ressemblance de composition, et donne aussi la distance sur la carte', () => {
    const rows = neighbors(election, 'a', positions);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c']);
    expect(rows[0]?.gap).toBe(10);
    expect(rows[0]?.distance).toBe(5);
    expect(rows[1]?.gap).toBe(50);
    expect(rows[1]?.distance).toBe(1);
  });

  it('ne renvoie rien pour un électorat sans position', () => {
    expect(neighbors(election, 'sans-position', positions)).toEqual([]);
  });
});

describe('misleadinglyClose', () => {
  it('repère deux électorats voisins sur la carte mais de composition différente', () => {
    expect(misleadinglyClose(0.17, 18.6)).toBe(true);
  });

  it('ne signale rien quand la carte dit vrai', () => {
    expect(misleadinglyClose(0.18, 9.3)).toBe(false);
    expect(misleadinglyClose(2.19, 25.1)).toBe(false);
  });
});

describe('duelRows', () => {
  it('met les plus grands écarts en tête', () => {
    const rows = duelRows({ '3': 10, '6': 40 }, { '3': 12, '6': 20, '7': 5 });
    expect(rows.map((r) => r.key)).toEqual(['6', '7', '3']);
    expect(rows[1]).toEqual({ key: '7', a: 0, b: 5 });
  });
});
