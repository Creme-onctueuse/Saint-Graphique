import { describe, expect, it } from 'vitest';
import {
  aggregateShares,
  compositionBarycenter,
  groupBarycenters,
  weightedBarycenter,
} from './barycenter.ts';

describe('weightedBarycenter', () => {
  it('pondère les positions par les poids', () => {
    expect(
      weightedBarycenter([
        { x: 0, y: 0, weight: 1 },
        { x: 4, y: 8, weight: 3 },
      ]),
    ).toEqual({ x: 3, y: 6 });
  });

  it('ignore les poids nuls, négatifs ou non numériques', () => {
    expect(
      weightedBarycenter([
        { x: 2, y: 2, weight: 1 },
        { x: 100, y: 100, weight: 0 },
        { x: 100, y: 100, weight: -5 },
        { x: 100, y: 100, weight: Number.NaN },
      ]),
    ).toEqual({ x: 2, y: 2 });
  });

  it('renvoie null sans poids strictement positif', () => {
    expect(weightedBarycenter([{ x: 1, y: 1, weight: 0 }])).toBeNull();
    expect(weightedBarycenter([])).toBeNull();
  });
});

describe('groupBarycenters', () => {
  it('calcule le barycentre de chaque groupe, pondéré par la population', () => {
    const groups = groupBarycenters([
      { group: '1', x: 0, y: 0, weight: 1 },
      { group: '1', x: 10, y: 10, weight: 1 },
      { group: '2', x: -4, y: 2, weight: 7 },
    ]);
    expect(groups.get('1')).toEqual({ x: 5, y: 5 });
    expect(groups.get('2')).toEqual({ x: -4, y: 2 });
  });
});

describe('compositionBarycenter', () => {
  const coords = new Map([
    ['1', { x: 0, y: 0 }],
    ['2', { x: 10, y: 20 }],
  ]);

  it('pondère les coordonnées par les parts de la composition', () => {
    expect(compositionBarycenter({ '1': 25, '2': 75 }, coords)).toEqual({ x: 7.5, y: 15 });
  });

  it('ignore les clés sans coordonnées et renormalise', () => {
    expect(compositionBarycenter({ '1': 50, '2': 50, '8': 900 }, coords)).toEqual({ x: 5, y: 10 });
  });

  it('renvoie null pour une composition vide', () => {
    expect(compositionBarycenter({}, coords)).toBeNull();
    expect(compositionBarycenter({ '8': 100 }, coords)).toBeNull();
  });
});

describe('aggregateShares', () => {
  it('somme une composition de niveau 2 par groupe, sans les codes inconnus', () => {
    const groupOf = new Map([
      ['21', '2'],
      ['22', '2'],
      ['31', '3'],
    ]);
    expect(aggregateShares({ '21': 10, '22': 15, '31': 20, '81': 5 }, groupOf)).toEqual({
      '2': 25,
      '3': 20,
    });
  });
});
