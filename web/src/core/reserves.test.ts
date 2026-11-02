import { describe, expect, it } from 'vitest';
import {
  countStatuses,
  findTies,
  formatStatus,
  IMPUTED_MARK,
  parseStatus,
  xAxisReserve,
} from './reserves.ts';

describe('countStatuses', () => {
  it('compte séparément patrimoine et niveau de vie', () => {
    const counts = countStatuses([
      { patrimoine_status: 'imputed', niveau_vie_status: 'published' },
      { patrimoine_status: 'imputed', niveau_vie_status: 'calculated' },
      { patrimoine_status: 'published', niveau_vie_status: 'published' },
    ]);
    expect(counts.patrimoine).toEqual({
      published: 1,
      imputed: 2,
      calculated: 0,
      unknown: 0,
      total: 3,
    });
    expect(counts.niveauVie).toEqual({
      published: 2,
      imputed: 0,
      calculated: 1,
      unknown: 0,
      total: 3,
    });
    expect(counts.all).toEqual({ published: 3, imputed: 2, calculated: 1, unknown: 0, total: 6 });
  });

  it('classe les champs absents ou invalides en « inconnu », sans rien supposer', () => {
    const counts = countStatuses([
      {},
      { patrimoine_status: 'estimated', niveau_vie_status: null },
      { patrimoine_status: 42, niveau_vie_status: 'published' },
    ]);
    expect(counts.patrimoine.unknown).toBe(3);
    expect(counts.niveauVie.unknown).toBe(2);
    expect(counts.niveauVie.published).toBe(1);
    expect(counts.all.total).toBe(6);
  });

  it('accepte une liste vide', () => {
    expect(countStatuses([]).all.total).toBe(0);
  });
});

describe('parseStatus et formatStatus', () => {
  it('ne reconnaît que les valeurs du schéma', () => {
    expect(parseStatus('published')).toBe('published');
    expect(parseStatus('imputed')).toBe('imputed');
    expect(parseStatus('calculated')).toBe('calculated');
    expect(parseStatus('IMPUTED')).toBe('unknown');
    expect(parseStatus(undefined)).toBe('unknown');
  });

  it('ne marque que les valeurs imputées', () => {
    expect(formatStatus('imputed')).toBe(`${IMPUTED_MARK} imputé`);
    expect(formatStatus('published')).toBe('publié');
    expect(formatStatus('calculated')).toBe('calculé');
    expect(formatStatus('unknown')).toBe('statut inconnu');
  });
});

describe('xAxisReserve', () => {
  it('donne le nombre de valeurs imputées et calculées', () => {
    const text = xAxisReserve(
      countStatuses([
        { patrimoine_status: 'imputed', niveau_vie_status: 'calculated' },
        { patrimoine_status: 'imputed', niveau_vie_status: 'published' },
      ]),
      'Exploitation',
    );
    expect(text).toContain('axe Exploitation');
    expect(text).toContain('2 valeurs imputées et 1 calculée sur 4');
    expect(text).toContain('patrimoine : 2 imputées, 0 calculée');
    expect(text).toContain('niveau de vie : 0 imputée, 1 calculée');
  });

  it('reste affichée pour une valeur calculée', () => {
    const counts = countStatuses([
      { patrimoine_status: 'calculated', niveau_vie_status: 'published' },
    ]);
    const text = xAxisReserve(counts, 'Exploitation');
    expect(text).toContain('0 valeur imputée et 1 calculée sur 2');
    expect(text).toContain('patrimoine : 0 imputée, 1 calculée');
  });

  it('disparaît si toutes les valeurs sont publiées', () => {
    const counts = countStatuses([
      { patrimoine_status: 'published', niveau_vie_status: 'published' },
    ]);
    expect(xAxisReserve(counts, 'Exploitation')).toBeNull();
  });

  it('signale un statut inconnu tant que les champs manquent', () => {
    const counts = countStatuses([{}, {}]);
    const text = xAxisReserve(counts, 'Exploitation');
    expect(text).toContain('statut inconnu');
    expect(text).not.toMatch(/imputées? et/);
  });

  it('signale un statut inconnu sans données brutes', () => {
    expect(xAxisReserve(null, 'Exploitation')).toContain('statut inconnu');
    expect(xAxisReserve(countStatuses([]), 'Exploitation')).toContain('statut inconnu');
  });

  it('signale les valeurs inconnues d’un jeu partiellement renseigné', () => {
    const partial = countStatuses([{ patrimoine_status: 'published' }]);
    expect(xAxisReserve(partial, 'X')).toContain('1 valeur de statut inconnu');
    const withImputed = countStatuses([{ patrimoine_status: 'imputed' }]);
    const text = xAxisReserve(withImputed, 'X');
    expect(text).toContain('1 valeur imputée');
    expect(text).toContain('1 valeur de statut inconnu');
  });
});

describe('findTies', () => {
  const score = (code: string, x: number, y: number): { code: string; x: number; y: number } => ({
    code,
    x,
    y,
  });

  it('ne trouve rien sans égalité', () => {
    expect(findTies([score('10', 1, 1), score('21', 2, 2)])).toEqual([]);
    expect(findTies([])).toEqual([]);
  });

  it('détecte les ex æquo par axe, codes triés comme le départage', () => {
    const ties = findTies([score('7', 5, 1), score('10', 5, 2), score('21', 3, 2)]);
    expect(ties).toEqual([
      { axis: 'x', score: 5, codes: ['10', '7'] },
      { axis: 'y', score: 2, codes: ['10', '21'] },
    ]);
  });

  it('regroupe plus de deux PCS et distingue plusieurs groupes', () => {
    const ties = findTies([
      score('21', 22, 0),
      score('22', 22, 1),
      score('23', 22, 2),
      score('31', 40, 3),
      score('33', 40, 4),
      score('34', 50, 5),
    ]);
    expect(ties).toEqual([
      { axis: 'x', score: 22, codes: ['21', '22', '23'] },
      { axis: 'x', score: 40, codes: ['31', '33'] },
    ]);
  });

  it('traite l’arrondi des calculs comme une égalité, et pas un vrai écart', () => {
    const near = 0.1 + 0.2;
    expect(findTies([score('a', 0.3, 0), score('b', near, 1)])).toHaveLength(1);
    expect(findTies([score('a', 0.3, 0), score('b', 0.3001, 1)])).toEqual([]);
  });
});
