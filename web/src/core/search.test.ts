import { describe, expect, it } from 'vitest';
import type { ChartModel, ChartPcs } from '../chart/types.ts';
import { normalize, searchItems, searchItemsOf } from './search.ts';

function pcs(code: string, label: string, short: string): ChartPcs {
  return {
    code,
    group: code.charAt(0),
    label,
    short,
    groupLabel: `Groupe ${code.charAt(0)}`,
    color: '#000',
    x: 1,
    y: 2,
    weight: 1,
    status: null,
    notes: [],
  };
}

const model: ChartModel = {
  title: '',
  description: '',
  xLabel: 'x',
  yLabel: 'y',
  range: [-10, 10],
  barycenter: null,
  pcs: [
    pcs('43', 'Professions intermédiaires de la santé et du travail social', 'PI santé/social'),
    pcs('52', 'Employés civils et agents de service de la fonction publique', 'Employés FP'),
    pcs('63', 'Ouvriers qualifiés de type artisanal', 'OQ artisanaux'),
  ],
  candidates: [
    {
      id: 'le-pen',
      label: 'Marine Le Pen',
      color: '#000',
      x: 3,
      y: 4,
      share: 23,
      isAbstention: false,
      ellipse: null,
      composition: null,
      trackKey: 'rn',
      trackLabel: 'Rassemblement national',
    },
  ],
};

const items = searchItemsOf(model);

describe('normalize', () => {
  it('ignore les accents, la casse et la ponctuation', () => {
    expect(normalize('Aide-Soignante')).toBe('aide soignante');
    expect(normalize('  Éric  Zemmour ')).toBe('eric zemmour');
    expect(normalize('chef d’entreprise')).toBe('chef d entreprise');
  });
});

describe('searchItems', () => {
  it('retrouve une catégorie à partir d’un métier courant', () => {
    const [first] = searchItems(items, 'infirmière');
    expect(first?.key).toBe('p:43');
    expect(first?.matched).toBe('infirmière');
  });

  it('ne tient pas compte des accents ni des tirets', () => {
    expect(searchItems(items, 'aide soignant')[0]?.key).toBe('p:52');
    expect(searchItems(items, 'MACON')[0]?.key).toBe('p:63');
  });

  it('retrouve un électorat par son nom ou sa famille', () => {
    expect(searchItems(items, 'le pen')[0]?.key).toBe('c:le-pen');
    expect(searchItems(items, 'rassemblement')[0]?.key).toBe('c:le-pen');
  });

  it('classe un début de mot avant un milieu de mot', () => {
    const results = searchItems(items, 'ouvriers');
    expect(results[0]?.key).toBe('p:63');
    expect(results[0]?.matched).toBeNull();
  });

  it('ne renvoie rien pour une recherche vide ou sans correspondance', () => {
    expect(searchItems(items, '   ')).toEqual([]);
    expect(searchItems(items, 'astronaute')).toEqual([]);
  });

  it('respecte la limite', () => {
    expect(searchItems(items, 'e', 2)).toHaveLength(2);
  });

  it('ignore un métier dont le code n’est pas sur la carte', () => {
    expect(searchItems(items, 'policier')).toEqual([]);
  });
});
