import { describe, expect, it } from 'vitest';
import { solveBounds } from './overlay.ts';

describe('calage du calque en deux clics', () => {
  it('fait tomber les deux points de l’image sur les coordonnées voulues', () => {
    const a = { u: 0.25, v: 0.75 };
    const b = { u: 0.75, v: 0.25 };
    const bounds = solveBounds(a, b, { x: -10, y: -10 }, { x: 10, y: 10 });
    expect(bounds).toEqual({ left: -20, right: 20, top: 20, bottom: -20 });
    if (!bounds) return;
    // Position des deux points dans l'image calée
    const at = (p: { u: number; v: number }): { x: number; y: number } => ({
      x: bounds.left + p.u * (bounds.right - bounds.left),
      y: bounds.top - p.v * (bounds.top - bounds.bottom),
    });
    expect(at(a)).toEqual({ x: -10, y: -10 });
    expect(at(b)).toEqual({ x: 10, y: 10 });
  });

  it('accepte des échelles différentes sur les deux axes', () => {
    const bounds = solveBounds({ u: 0, v: 1 }, { u: 1, v: 0 }, { x: 0, y: 0 }, { x: 100, y: 10 });
    expect(bounds).toEqual({ left: 0, right: 100, top: 10, bottom: 0 });
  });

  it('refuse deux points alignés sur un axe', () => {
    expect(
      solveBounds({ u: 0.5, v: 0 }, { u: 0.5, v: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }),
    ).toBeNull();
    expect(
      solveBounds({ u: 0, v: 0.5 }, { u: 1, v: 0.5 }, { x: 0, y: 0 }, { x: 1, y: 1 }),
    ).toBeNull();
  });
});
