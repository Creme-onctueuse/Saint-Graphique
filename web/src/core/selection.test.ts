import { describe, expect, it } from 'vitest';
import { selectionPatch } from './selection.ts';

const none = { selected: null, compared: null };

describe('selectionPatch', () => {
  it('sélectionne au clic', () => {
    expect(selectionPatch(none, 'c:a', false)).toEqual({ selected: 'c:a', compared: null });
  });

  it('remplace la sélection au clic sur un autre repère', () => {
    expect(selectionPatch({ selected: 'c:a', compared: 'c:b' }, 'c:c', false)).toEqual({
      selected: 'c:c',
      compared: null,
    });
  });

  it('retire la sélection au second clic', () => {
    expect(selectionPatch({ selected: 'c:a', compared: null }, 'c:a', false)).toEqual(none);
  });

  it('retire tout au clic sur le fond', () => {
    expect(selectionPatch({ selected: 'c:a', compared: 'c:b' }, null, false)).toEqual(none);
  });

  it('compare deux repères de même nature avec Maj', () => {
    expect(selectionPatch({ selected: 'c:a', compared: null }, 'c:b', true)).toEqual({
      selected: 'c:a',
      compared: 'c:b',
    });
    expect(selectionPatch({ selected: 'p:31', compared: null }, 'p:62', true)).toEqual({
      selected: 'p:31',
      compared: 'p:62',
    });
  });

  it('ne compare pas un électorat et une catégorie', () => {
    expect(selectionPatch({ selected: 'c:a', compared: null }, 'p:62', true)).toEqual({
      selected: 'p:62',
      compared: null,
    });
  });

  it('Maj sans sélection revient à un clic', () => {
    expect(selectionPatch(none, 'c:a', true)).toEqual({ selected: 'c:a', compared: null });
  });

  it('retirer le premier repère d’un duel garde le second', () => {
    expect(selectionPatch({ selected: 'c:a', compared: 'c:b' }, 'c:a', false)).toEqual({
      selected: 'c:b',
      compared: null,
    });
  });

  it('retirer le second repère d’un duel garde le premier', () => {
    expect(selectionPatch({ selected: 'c:a', compared: 'c:b' }, 'c:b', true)).toEqual({
      selected: 'c:a',
      compared: null,
    });
  });
});
