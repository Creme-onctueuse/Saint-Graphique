import { describe, expect, it } from 'vitest';
import { colorClassOf, COLOR_CLASSES, computeFreeLayout, pollCoordinates } from './freeAxes.ts';
import type { RawElection, RawPcsItem } from './types.ts';
import { availableVariables, variableById, VARIABLES } from './variables.ts';

function item(
  code: string,
  group: string,
  population: number,
  niveau: number,
  patrimoine: number,
  bac5: number,
  proprietaire?: number,
): RawPcsItem {
  return {
    code,
    group,
    population,
    niveau_vie_mensuel_eur: niveau,
    patrimoine_keur: patrimoine,
    diplomes: { bac5, bac3: 0, bac2: 0, bac: 0, cap: 0, brevet: 0, certif_aucun: 0 },
    ...(proprietaire === undefined
      ? {}
      : {
          patrimoine_composition: { proprietaire_pct: proprietaire },
          patrimoine_composition_status: 'imputed',
        }),
  };
}

const items = [
  item('10', '1', 100, 2000, 600, 10, 80),
  item('21', '2', 100, 1000, 400, 0, 60),
  item('31', '3', 100, 3000, 200, 50),
];

const election: RawElection = {
  id: 'e',
  type: 'presidentielle',
  year: 2022,
  label: 'E',
  pcs_level: 1,
  sources: [],
  candidates: [
    { id: 'a', label: 'A', color: '#000', national_share_pct: 50 },
    { id: 'b', label: 'B', color: '#000', national_share_pct: 50 },
  ],
  composition: { a: { '2': 100 }, b: { '2': 50, '3': 50 } },
};

const niveau = variableById('niveau_vie');
const patrimoine = variableById('patrimoine');
const proprietaire = variableById('proprietaire');
if (!niveau || !patrimoine || !proprietaire) throw new Error('variables absentes');

const base = {
  items,
  election,
  xVariable: niveau,
  yVariable: patrimoine,
  colorVariable: null,
  range: [-10, 10] as const,
  xScale: 'linear' as const,
  yScale: 'linear' as const,
};

describe('échelle des axes libres', () => {
  const positive = [
    item('10', '1', 100, 2000, 100, 10),
    item('21', '2', 100, 1000, 10, 20),
    item('31', '3', 100, 3000, 1000, 50),
  ];
  const input = { ...base, items: positive, xScale: null, yScale: null };

  it('ouvre le patrimoine en logarithme, et le reste en linéaire', () => {
    const layout = computeFreeLayout(input);
    expect(layout?.x.scale).toBe('linear');
    expect(layout?.y.scale).toBe('log');
    expect(layout?.pcs.find((p) => p.code === '10')?.y).toBeCloseTo(0);
  });

  it('respecte le choix de l’axe', () => {
    expect(computeFreeLayout({ ...input, yScale: 'linear' })?.y.scale).toBe('linear');
    expect(computeFreeLayout({ ...input, xScale: 'rank' })?.x.scale).toBe('rank');
  });

  it('refuse le logarithme devant un zéro, et le signale', () => {
    const bac5 = variableById('bac5');
    if (!bac5) throw new Error('variable absente');
    const layout = computeFreeLayout({ ...base, xVariable: bac5, xScale: 'log' });
    expect(layout?.x.scale).toBe('linear');
    expect(layout?.x.logPossible).toBe(false);
  });

  it('gradue le logarithme sur des valeurs rondes, à leur vraie place', () => {
    const y = computeFreeLayout(input)?.y;
    const ticks = y?.tickPositions([-10, 10], 5) ?? [];
    const values = ticks.map((t) => y?.valueAt(t) ?? 0);
    expect(values.map((v) => Math.round(v))).toEqual([10, 100, 1000]);
  });

  it('laisse les autres échelles graduer à intervalles réguliers', () => {
    expect(computeFreeLayout(input)?.x.tickPositions([-10, 10], 5)).toBeNull();
  });

  it('calcule les électorats sur les positions : le logarithme les écarte du maximum', () => {
    const log = computeFreeLayout({ ...input, yScale: 'log' })?.candidates.get('b')?.y ?? 0;
    const linear = computeFreeLayout({ ...input, yScale: 'linear' })?.candidates.get('b')?.y ?? 0;
    // Pour moitié le groupe 3 (+10), pour moitié le groupe 2, qui réunit ici agriculteurs (0) et
    // indépendants (-10) : (10 - 5) / 2. En linéaire, les deux derniers restent tout en bas.
    expect(log).toBeCloseTo(2.5);
    expect(linear).toBeLessThan(log);
  });
});

describe('computeFreeLayout', () => {
  it('ramène chaque variable de son minimum à son maximum', () => {
    const layout = computeFreeLayout(base);
    expect(layout?.pcs.find((p) => p.code === '21')?.x).toBe(-10);
    expect(layout?.pcs.find((p) => p.code === '31')?.x).toBe(10);
    expect(layout?.pcs.find((p) => p.code === '10')?.x).toBeCloseTo(0);
    expect(layout?.x.min).toBe(1000);
    expect(layout?.x.max).toBe(3000);
    expect(layout?.y.min).toBe(200);
    expect(layout?.y.max).toBe(600);
  });

  it('retrouve la valeur réelle à partir de la position', () => {
    const layout = computeFreeLayout(base);
    expect(layout?.x.valueAt(-10)).toBe(1000);
    expect(layout?.x.valueAt(0)).toBeCloseTo(2000);
    expect(layout?.x.valueAt(10)).toBe(3000);
  });

  it('calcule le poids dans la population', () => {
    expect(computeFreeLayout(base)?.pcs[0]?.weight).toBeCloseTo(100 / 3);
  });

  it('place les électorats au barycentre de leurs groupes, agriculteurs réunis aux indépendants', () => {
    const layout = computeFreeLayout(base);
    // La clé « 2 » réunit les groupes 1 (x = 0) et 2 (x = −10), de même population.
    expect(layout?.candidates.get('a')?.x).toBeCloseTo(-5);
    // Électorat b : moitié clé 2 (−5), moitié cadres (+10).
    expect(layout?.candidates.get('b')?.x).toBeCloseTo(2.5);
  });

  it('écarte les catégories sans valeur et les compte', () => {
    const layout = computeFreeLayout({ ...base, xVariable: proprietaire });
    expect(layout?.pcs.map((p) => p.code)).toEqual(['10', '21']);
    expect(layout?.omitted).toBe(1);
    expect(layout?.pcs.every((p) => p.imputed)).toBe(true);
  });

  it('renonce s’il reste moins de deux catégories', () => {
    expect(
      computeFreeLayout({ ...base, items: items.slice(2), xVariable: proprietaire }),
    ).toBeNull();
  });

  it('donne une classe de couleur à chaque catégorie', () => {
    const layout = computeFreeLayout({ ...base, colorVariable: niveau });
    expect(layout?.color).toMatchObject({ min: 1000, max: 3000 });
    expect(layout?.pcs.find((p) => p.code === '21')?.colorClass).toBe(1);
    expect(layout?.pcs.find((p) => p.code === '31')?.colorClass).toBe(COLOR_CLASSES);
  });

  it('ne marque pas d’imputation sans variable imputée', () => {
    expect(computeFreeLayout(base)?.pcs.some((p) => p.imputed)).toBe(false);
  });
});

describe('colorClassOf', () => {
  it('reste dans les bornes', () => {
    expect(colorClassOf(0, 0, 10)).toBe(1);
    expect(colorClassOf(10, 0, 10)).toBe(COLOR_CLASSES);
    expect(colorClassOf(5, 5, 5)).toBe(1);
  });
});

describe('pollCoordinates', () => {
  const points = [
    { group: '1', x: 0, y: 0, weight: 1 },
    { group: '2', x: 10, y: 0, weight: 1 },
  ];
  const groupOf = (code: string): string => code;

  it('réunit agriculteurs et indépendants si le sondage ne les sépare pas', () => {
    const out = pollCoordinates(points, election, groupOf);
    expect(out.get('2')?.x).toBeCloseTo(5);
    expect(out.has('1')).toBe(false);
  });

  it('les laisse séparés si le sondage les distingue', () => {
    const detailed = { ...election, composition: { a: { '1': 50, '2': 50 }, b: {} } };
    const out = pollCoordinates(points, detailed, groupOf);
    expect(out.get('1')?.x).toBe(0);
    expect(out.get('2')?.x).toBe(10);
  });
});

describe('variables', () => {
  it('propose une dizaine de variables', () => {
    expect(VARIABLES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(VARIABLES.map((v) => v.id)).size).toBe(VARIABLES.length);
  });

  it('ne propose que les variables renseignées', () => {
    const ids = availableVariables(items).map((v) => v.id);
    expect(ids).toContain('niveau_vie');
    expect(ids).not.toContain('immobilier');
  });

  it('signale les parts du patrimoine comme imputées', () => {
    expect(variableById('immobilier')?.imputed).toBe(true);
    expect(variableById('bac5')?.imputed).toBe(false);
  });
});
