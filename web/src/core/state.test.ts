import { describe, expect, it } from 'vitest';
import {
  defaultState,
  normalizeState,
  parseState,
  serializeState,
  type AppState,
} from './state.ts';

const custom: AppState = {
  election: '2022_presidentielle_t1',
  method: 'continuous',
  hiddenCandidates: ['le-pen', 'abstention'],
  hiddenGroups: ['7', '1'],
  weights: { bac5: 5.5, bac3: 3, bac2: 2, bac: 1, cap: -1, brevet: -2.5, certif_aucun: -3 },
  retired: -180,
  theme: 'dark',
  showLabels: false,
  showEllipses: true,
  bubbleSize: 'vote:6',
  selected: 'c:macron',
  compared: 'p:31',
  panel: 'cross',
  square: true,
  showTrails: false,
  showRings: true,
  typeFilter: 'presidentielle',
  scenario: 'trend',
  axisX: 'niveau_vie',
  axisY: 'bac5',
  colorBy: 'patrimoine',
  layout: 'proximity',
};

describe('aller-retour dans l’URL', () => {
  it('ignore un panneau ou un filtre inconnu', () => {
    const s = parseState('#p=rien&ty=municipales&sc=autre&vue=autre');
    expect(s.panel).toBeNull();
    expect(s.typeFilter).toBe('all');
    expect(s.scenario).toBe('still');
    expect(s.layout).toBe('map');
  });

  it('ne garde pas un repère comparé sans repère sélectionné', () => {
    expect(parseState('#c2=c%3Amacron').compared).toBeNull();
  });

  it('conserve un état complet', () => {
    expect(parseState(`#${serializeState(custom)}`)).toEqual(normalizeState(custom));
  });

  it('conserve un état par défaut, qui ne produit aucun paramètre', () => {
    expect(serializeState(defaultState())).toBe('');
    expect(parseState('')).toEqual(defaultState());
  });

  it('conserve le score des retraités désactivé', () => {
    const state: AppState = { ...defaultState(), retired: 'off' };
    expect(serializeState(state)).toBe('r=off');
    expect(parseState(serializeState(state)).retired).toBe('off');
  });

  it('conserve un score de zéro et les poids négatifs ou décimaux', () => {
    const state: AppState = {
      ...defaultState(),
      retired: 0,
      weights: { bac5: 0.25, bac3: 0, bac2: -0, bac: 1e-7, cap: -1, brevet: -2, certif_aucun: -3 },
    };
    const round = parseState(serializeState(state));
    expect(round.retired).toBe(0);
    expect(round.weights).toEqual({
      bac5: 0.25,
      bac3: 0,
      bac2: 0,
      bac: 1e-7,
      cap: -1,
      brevet: -2,
      certif_aucun: -3,
    });
  });

  it('encode les identifiants contenant des caractères réservés', () => {
    const state: AppState = { ...defaultState(), election: 'a&b=c d', hiddenCandidates: ['x+y'] };
    const round = parseState(serializeState(state));
    expect(round.election).toBe('a&b=c d');
    expect(round.hiddenCandidates).toEqual(['x+y']);
  });

  it('accepte un fragment ou une chaîne de requête', () => {
    expect(parseState('#m=mca').method).toBe('mca');
    expect(parseState('?m=mca').method).toBe('mca');
    expect(parseState('m=mca').method).toBe('mca');
  });
});

describe('normalisation', () => {
  it('trie les listes et retire les doublons, pour une URL stable', () => {
    const state: AppState = { ...defaultState(), hiddenCandidates: ['b', 'a', 'b', ''] };
    expect(normalizeState(state).hiddenCandidates).toEqual(['a', 'b']);
    expect(serializeState(state)).toBe('h=a&h=b');
  });

  it('écarte les poids et scores non finis', () => {
    const state: AppState = {
      ...defaultState(),
      retired: Number.NaN,
      weights: {
        bac5: Number.NaN,
        bac3: 3,
        bac2: 2,
        bac: 1,
        cap: -1,
        brevet: -2,
        certif_aucun: -3,
      },
    };
    const normal = normalizeState(state);
    expect(normal.weights).toBeNull();
    expect(normal.retired).toBe('default');
  });
});

describe('lecture tolérante', () => {
  it('ignore les valeurs invalides', () => {
    const state = parseState('#w=1_2_3&r=abc&t=rose&lbl=1&ci=oui');
    expect(state.weights).toBeNull();
    expect(state.retired).toBe('default');
    expect(state.theme).toBe('system');
    expect(state.showLabels).toBe(true);
    expect(state.showEllipses).toBe(false);
  });

  it('refuse des poids incomplets ou vides', () => {
    expect(parseState('#w=1_2_3_4_5_6_').weights).toBeNull();
    expect(parseState('#w=1_2_3_4_5_6_x').weights).toBeNull();
  });
});
