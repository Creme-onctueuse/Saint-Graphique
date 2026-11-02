import { describe, expect, it } from 'vitest';
import { arcAngles, arcPath, lerpAngles } from './arc.ts';

describe('arcPath', () => {
  it('ne trace rien pour une part vide', () => {
    expect(arcPath(5, 10, 1, 1)).toBe('');
  });

  it('commence en haut et tourne dans le sens horaire', () => {
    const d = arcPath(5, 10, 0, Math.PI / 2);
    expect(d.startsWith('M0.00,-10.00')).toBe(true);
    expect(d).toContain('10.00,0.00');
  });

  it('prend le grand arc au-delà d’un demi-tour', () => {
    expect(arcPath(5, 10, 0, 3)).toContain('0 0 1');
    expect(arcPath(5, 10, 0, 4)).toContain('0 1 1');
  });

  it('trace un anneau complet', () => {
    const d = arcPath(5, 10, 0, 2 * Math.PI);
    expect(d).toContain('0 1 1');
    expect(d).not.toBe('');
  });
});

describe('arcAngles', () => {
  it('répartit le tour selon les valeurs', () => {
    const angles = arcAngles([25, 25, 50]);
    expect(angles[0]).toEqual({ start: 0, end: Math.PI / 2 });
    expect(angles[1]?.end).toBeCloseTo(Math.PI);
    expect(angles[2]?.end).toBeCloseTo(2 * Math.PI);
  });

  it('garde une part nulle, sans largeur', () => {
    const angles = arcAngles([50, 0, 50]);
    expect(angles[1]?.start).toBe(angles[1]?.end);
  });

  it('ne divise pas par zéro', () => {
    expect(arcAngles([0, 0])).toEqual([
      { start: 0, end: 0 },
      { start: 0, end: 0 },
    ]);
  });
});

describe('lerpAngles', () => {
  const from = [{ start: 0, end: 2 }];
  const to = [{ start: 2, end: 4 }];

  it('va de l’un à l’autre', () => {
    expect(lerpAngles(from, to, 0)).toEqual(from);
    expect(lerpAngles(from, to, 1)).toEqual(to);
    expect(lerpAngles(from, to, 0.5)).toEqual([{ start: 1, end: 3 }]);
  });

  it('part de la cible si la part est nouvelle', () => {
    expect(lerpAngles([], to, 0.5)).toEqual(to);
  });
});
