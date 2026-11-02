import { describe, expect, it } from 'vitest';
import { TOUR_STEPS, tourPatch } from './tour.ts';

describe('visite guidée', () => {
  it('compte cinq étapes, avec un titre et un texte', () => {
    expect(TOUR_STEPS).toHaveLength(5);
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.text.length).toBeGreaterThan(0);
    }
  });

  it('ne cite aucun chiffre : ceux qu’on voit viennent des données', () => {
    for (const step of TOUR_STEPS) expect(step.text).not.toMatch(/\d/);
  });

  it('n’hérite pas des réglages de l’étape précédente', () => {
    const [first, , third, , last] = TOUR_STEPS;
    if (!first || !third || !last) throw new Error('étapes manquantes');
    expect(tourPatch(third).selected).toBe('p:62');
    expect(tourPatch(first).selected).toBeNull();
    expect(tourPatch(first).panel).toBeNull();
    expect(tourPatch(last).panel).toBe('cross');
    expect(tourPatch(first).bubbleSize).toBeNull();
  });
});
