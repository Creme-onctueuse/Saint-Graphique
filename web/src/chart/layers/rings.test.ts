import { describe, expect, it } from 'vitest';
import { bestNamePlace, ringName } from './rings.ts';

describe('bestNamePlace', () => {
  it('met le nom sous l’anneau quand rien ne gêne', () => {
    expect(bestNamePlace(100, 100, 20, 60, [])).toMatchObject({ dx: 0, anchor: 'middle' });
    expect(bestNamePlace(100, 100, 20, 60, []).dy).toBeGreaterThan(20);
  });

  it('passe au-dessus si un libellé occupe le dessous', () => {
    const below = { left: 60, right: 140, top: 125, bottom: 145 };
    const place = bestNamePlace(100, 100, 20, 60, [below]);
    expect(place.dy).toBeLessThan(0);
    expect(place.anchor).toBe('middle');
  });

  it('passe sur le côté si le dessus et le dessous sont pris', () => {
    const obstacles = [
      { left: 60, right: 140, top: 125, bottom: 145 },
      { left: 60, right: 140, top: 55, bottom: 80 },
    ];
    const place = bestNamePlace(100, 100, 20, 60, obstacles);
    expect(place.dx).toBeGreaterThan(0);
    expect(place.anchor).toBe('start');
  });

  it('choisit le moindre recouvrement quand tout est pris', () => {
    const obstacles = [
      { left: 0, right: 200, top: 118, bottom: 150 },
      { left: 0, right: 200, top: 50, bottom: 80 },
      { left: 120, right: 200, top: 85, bottom: 115 },
      { left: 40, right: 72, top: 96, bottom: 108 },
    ];
    expect(bestNamePlace(100, 100, 20, 60, obstacles).anchor).toBe('end');
  });
});

describe('bestNamePlace, au bord de l’écran', () => {
  it('ne laisse pas le nom sortir de l’écran', () => {
    // Dessous et dessus débordent à droite : le nom passe à gauche de l'anneau.
    const place = bestNamePlace(380, 100, 20, 120, [], 400);
    expect(place.anchor).toBe('end');
  });
});

describe('ringName', () => {
  it('nomme le groupe', () => {
    expect(ringName('6', false)).toBe('Ouvriers');
  });

  it('dit que les agriculteurs sont réunis aux indépendants', () => {
    expect(ringName('2', true)).toBe('Indépendants et agriculteurs');
    expect(ringName('2', false)).toBe('Indépendants');
  });
});
