import { describe, expect, it } from 'vitest';
import { bubbleSizeLabel, bubbleSizes, parseBubbleSize } from './bubbleSize.ts';
import type { RawElection, RawPcsItem } from './types.ts';
import type { Variable } from './variables.ts';

const election: RawElection = {
  id: 'test',
  type: 'presidentielle',
  year: 2022,
  label: 'Test',
  pcs_level: 1,
  sources: [],
  candidates: [
    { id: 'a', label: 'A', color: '#000', national_share_pct: 60 },
    { id: 'b', label: 'B', color: '#000', national_share_pct: 40 },
    { id: 'abst', label: 'Abstention', color: '#000', national_share_pct: 50, is_abstention: true },
  ],
  composition: {
    a: { '3': 50, '6': 50 },
    b: { '3': 25, '6': 75 },
    abst: { '3': 20, '6': 80 },
  },
};

const wealth: Variable = {
  id: 'patrimoine',
  label: 'Patrimoine',
  imputed: false,
  read: (item) => item.patrimoine_keur,
  format: String,
};

const item = (code: string, group: string, wealthValue: number): RawPcsItem => ({
  code,
  group,
  population: 100,
  niveau_vie_mensuel_eur: 2000,
  patrimoine_keur: wealthValue,
  diplomes: { bac5: 0, bac3: 0, bac2: 0, bac: 0, cap: 0, brevet: 0, certif_aucun: 0 },
});

const items = [item('31', '3', 300), item('62', '6', 100)];

describe('parseBubbleSize', () => {
  it('lit chaque mesure et se replie sur la part des inscrits', () => {
    expect(parseBubbleSize(null, []).kind).toBe('registered');
    expect(parseBubbleSize('score', []).kind).toBe('score');
    expect(parseBubbleSize('dans:6', [])).toEqual({ kind: 'inGroup', group: '6' });
    expect(parseBubbleSize('vote:3', [])).toEqual({ kind: 'ofGroup', group: '3' });
    expect(parseBubbleSize('var:patrimoine', [wealth]).kind).toBe('variable');
    expect(parseBubbleSize('var:inconnue', [wealth]).kind).toBe('registered');
    expect(parseBubbleSize('n_importe_quoi', []).kind).toBe('registered');
  });
});

describe('bubbleSizes', () => {
  it('laisse la part des inscrits à la carte', () => {
    expect(bubbleSizes(election, { kind: 'registered' }, items)).toBeNull();
  });

  it('donne le score', () => {
    expect(bubbleSizes(election, { kind: 'score' }, items)?.get('a')).toBe(60);
  });

  it('donne la part d’un groupe dans chaque électorat', () => {
    const sizes = bubbleSizes(election, { kind: 'inGroup', group: '6' }, items);
    expect(sizes?.get('a')).toBe(50);
    expect(sizes?.get('b')).toBe(75);
  });

  it('donne le vote d’un groupe, qui somme à 100', () => {
    const sizes = bubbleSizes(election, { kind: 'ofGroup', group: '3' }, items);
    expect(sizes?.get('a')).toBeCloseTo(50);
    expect([...(sizes?.values() ?? [])].reduce((x, y) => x + y, 0)).toBeCloseTo(100);
  });

  it('répartit le total d’une variable entre les électorats, à hauteur de 100', () => {
    const sizes = bubbleSizes(election, { kind: 'variable', variable: wealth }, items);
    // A : 30 inscrits à (300 + 100) / 2 = 200 ; B : 20 à 150 ; abstention : 50 à 140.
    const total = 30 * 200 + 20 * 150 + 50 * 140;
    expect(sizes?.get('a')).toBeCloseTo((100 * 30 * 200) / total);
    expect([...(sizes?.values() ?? [])].reduce((x, y) => x + y, 0)).toBeCloseTo(100);
  });
});

describe('bubbleSizeLabel', () => {
  it('dit ce que mesure l’aire', () => {
    expect(bubbleSizeLabel({ kind: 'registered' })).toBe('part des inscrits');
    expect(bubbleSizeLabel({ kind: 'ofGroup', group: '6' })).toContain('Ouvriers');
    expect(bubbleSizeLabel({ kind: 'variable', variable: wealth })).toContain('Patrimoine');
  });
});
