import { describe, expect, it } from 'vitest';
import { classicalMds, distanceMatrix, fitToRange, orient } from './mds.ts';
import type { Point } from './types.ts';

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function expectDistancesKept(source: readonly Point[], placed: readonly Point[]): void {
  for (let i = 0; i < source.length; i++) {
    for (let j = i + 1; j < source.length; j++) {
      const a = source[i] as Point;
      const b = source[j] as Point;
      const c = placed[i] as Point;
      const d = placed[j] as Point;
      expect(distance(c, d)).toBeCloseTo(distance(a, b), 5);
    }
  }
}

describe('classicalMds', () => {
  it('retrouve les distances d’une configuration plane', () => {
    const source: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
      { x: 2, y: 7 },
    ];
    const result = classicalMds(distanceMatrix(source, distance));
    expectDistancesKept(source, result.points);
    expect(result.explained).toBeCloseTo(1, 5);
  });

  it('retrouve des points alignés', () => {
    const source: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 3, y: 0 },
    ];
    const result = classicalMds(distanceMatrix(source, distance));
    expectDistancesKept(source, result.points);
  });

  it('centre la carte', () => {
    const source: Point[] = [
      { x: 10, y: 10 },
      { x: 12, y: 10 },
      { x: 10, y: 13 },
    ];
    const { points } = classicalMds(distanceMatrix(source, distance));
    expect(points.reduce((s, p) => s + p.x, 0)).toBeCloseTo(0, 6);
    expect(points.reduce((s, p) => s + p.y, 0)).toBeCloseTo(0, 6);
  });

  it('dit ce qu’il perd quand deux dimensions ne suffisent pas', () => {
    // Quatre points à égale distance forment un tétraèdre : le plan ne peut pas les représenter.
    const d = [
      [0, 1, 1, 1],
      [1, 0, 1, 1],
      [1, 1, 0, 1],
      [1, 1, 1, 0],
    ];
    const { explained } = classicalMds(d);
    expect(explained).toBeLessThan(0.75);
    expect(explained).toBeGreaterThan(0.5);
  });

  it('est déterministe', () => {
    const d = distanceMatrix(
      [
        { x: 1, y: 2 },
        { x: 3, y: 1 },
        { x: 7, y: 5 },
        { x: 2, y: 9 },
      ],
      distance,
    );
    expect(classicalMds(d)).toEqual(classicalMds(d));
  });

  it('accepte zéro ou un point', () => {
    expect(classicalMds([]).points).toEqual([]);
    expect(classicalMds([[0]]).points).toEqual([{ x: 0, y: 0 }]);
  });
});

describe('orient', () => {
  it('fait aller chaque dimension dans le sens de sa référence', () => {
    const points = [
      { x: -1, y: 2 },
      { x: 1, y: -2 },
    ];
    expect(orient(points, [10, 0], [0, 10])).toEqual([
      { x: 1, y: -2 },
      { x: -1, y: 2 },
    ]);
  });

  it('ne change rien si le sens est déjà le bon', () => {
    const points = [
      { x: -1, y: -2 },
      { x: 1, y: 2 },
    ];
    expect(orient(points, [0, 10], [0, 10])).toEqual(points);
  });
});

describe('fitToRange', () => {
  it('garde les proportions', () => {
    const fitted = fitToRange(
      [
        { x: 2, y: 0 },
        { x: 0, y: 1 },
      ],
      10,
    );
    expect(fitted[0]?.x).toBe(10);
    expect(fitted[1]?.y).toBe(5);
  });

  it('accepte des points confondus', () => {
    expect(fitToRange([{ x: 0, y: 0 }], 10)).toEqual([{ x: 0, y: 0 }]);
  });
});
