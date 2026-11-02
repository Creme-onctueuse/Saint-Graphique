import { describe, expect, it } from 'vitest';
import { baseScales, computeGeometry, fitTransform, type GeometryStyle } from './geometry.ts';

const STYLE: GeometryStyle = {
  smallWidth: 560,
  axisBand: { left: 40, bottom: 30 },
  axisBandSmall: { left: 24, bottom: 24 },
  minPlot: 120,
};
const INSETS = { top: 60, right: 10, bottom: 30, left: 60 };

describe('computeGeometry', () => {
  it('étire la zone de tracé pour remplir la fenêtre', () => {
    const g = computeGeometry(1912, 948, INSETS, false, STYLE);
    expect(g.plot).toEqual({ x: 100, y: 60, w: 1802, h: 828 });
    expect(g.unit).toBe(828);
    expect(g.plot.w / g.plot.h).toBeGreaterThan(2);
  });

  it('centre un carré en proportions d’origine', () => {
    const g = computeGeometry(1912, 948, INSETS, true, STYLE);
    expect(g.plot.w).toBe(g.plot.h);
    expect(g.plot.w).toBe(828);
    expect(g.plot.x + g.plot.w / 2).toBe(100 + 1802 / 2);
  });

  it('réserve une bande plus étroite sur téléphone', () => {
    const g = computeGeometry(400, 800, { top: 50, right: 4, bottom: 90, left: 4 }, false, STYLE);
    expect(g.small).toBe(true);
    expect(g.plot.x).toBe(28);
    expect(g.plot.w).toBe(368);
  });
});

describe('baseScales', () => {
  it('place le domaine élargi aux bords de la zone de tracé', () => {
    const g = computeGeometry(1000, 800, INSETS, false, STYLE);
    const { x, y } = baseScales(g, [-10, 10], 0.1);
    expect(x(-12)).toBeCloseTo(g.plot.x);
    expect(x(12)).toBeCloseTo(g.plot.x + g.plot.w);
    expect(y(12)).toBeCloseTo(g.plot.y);
    expect(y(-12)).toBeCloseTo(g.plot.y + g.plot.h);
  });
});

describe('fitTransform', () => {
  const g = computeGeometry(1000, 800, INSETS, false, STYLE);
  const { x, y } = baseScales(g, [-10, 10], 0);

  it('centre la zone demandée et la fait tenir', () => {
    const box = { x0: -2, x1: 2, y0: -2, y1: 2 };
    const t = fitTransform(g, x, y, box, 1, 12);
    expect(t.k).toBeGreaterThan(1);
    expect(t.k * x(0) + t.tx).toBeCloseTo(g.plot.x + g.plot.w / 2);
    expect(t.k * y(0) + t.ty).toBeCloseTo(g.plot.y + g.plot.h / 2);
    expect(t.k * x(2) + t.tx).toBeLessThanOrEqual(g.plot.x + g.plot.w + 1e-6);
    expect(t.k * y(-2) + t.ty).toBeLessThanOrEqual(g.plot.y + g.plot.h + 1e-6);
  });

  it('respecte les bornes du zoom', () => {
    expect(fitTransform(g, x, y, { x0: 0, x1: 0.01, y0: 0, y1: 0.01 }, 1, 6).k).toBe(6);
    expect(fitTransform(g, x, y, { x0: -30, x1: 30, y0: -30, y1: 30 }, 1, 6).k).toBe(1);
  });
});
