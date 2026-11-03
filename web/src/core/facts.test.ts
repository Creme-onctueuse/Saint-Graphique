/**
 * Chaque constat est revérifié sur les données réellement synchronisées, et chaque règle l'est sur un
 * cas construit. Les tests sur données réelles sont ignorés sans ces données (dépôt sans fichiers Ifop).
 */
import { describe, expect, it } from 'vitest';
import { buildDataset, computedKey, type Dataset } from '../data/dataset.ts';
import {
  ALIKE_COMPOSITION,
  CLOSE_ON_MAP,
  closenessConfirmed,
  computeFacts,
  correlationRepeats,
  familyCorrelations,
  gapBetween,
  mapDistance,
  ofName,
  pearson,
  type Fact,
} from './facts.ts';
import type { ComputedFile } from './types.ts';

const modules = import.meta.glob<unknown>('../data/computed/**/*.json', {
  eager: true,
  import: 'default',
});
const files: Record<string, unknown> = {};
for (const [path, value] of Object.entries(modules)) {
  files[path.replace('../data/computed/', '')] = value;
}
const ds = buildDataset(files);
const hasRealData = !ds.isSample && ds.families !== null && ds.rawElections.size > 0;

const READ = 'read_positions';
const P2022 = '2022_presidentielle_t1';

function fact(facts: readonly Fact[], id: string): Fact {
  const found = facts.find((f) => f.id === id);
  if (!found) throw new Error(`constat absent : ${id}`);
  return found;
}

/** Copie du jeu de données où un électorat a changé de place. */
function withMoved(
  source: Dataset,
  method: string,
  election: string,
  id: string,
  x: number,
  y: number,
): Dataset {
  const computed = new Map(source.computed);
  const key = computedKey(method, election);
  const file = computed.get(key) as ComputedFile;
  computed.set(key, {
    ...file,
    candidates: file.candidates.map((c) => (c.id === id ? { ...c, x, y } : c)),
  });
  return { ...source, computed };
}

describe('règle : une corrélation doit se répéter', () => {
  it('accepte un r élevé de même signe à chaque élection', () => {
    expect(correlationRepeats([0.85, 0.84, 0.97, 0.77, 0.73, 0.95, 0.89])).toBe(true);
    expect(correlationRepeats([-0.8, -0.71, -0.9])).toBe(true);
  });

  it('rejette un r élevé isolé', () => {
    expect(correlationRepeats([0.95])).toBe(false);
    expect(correlationRepeats([0.95, 0.91])).toBe(false);
    expect(correlationRepeats([-0.91, -0.24, -0.31, -0.58])).toBe(false);
  });

  it('rejette un changement de signe', () => {
    expect(correlationRepeats([0.9, -0.9, 0.9])).toBe(false);
  });
});

describe('règle : une proximité sur la carte doit être confirmée par la composition', () => {
  it('exige les deux mesures', () => {
    expect(closenessConfirmed(CLOSE_ON_MAP, ALIKE_COMPOSITION)).toBe(true);
    expect(closenessConfirmed(CLOSE_ON_MAP + 0.01, 1)).toBe(false);
    expect(closenessConfirmed(0.01, ALIKE_COMPOSITION + 0.01)).toBe(false);
  });
});

describe('ofName', () => {
  it('élide devant une voyelle, même accentuée', () => {
    expect(ofName('Éric Zemmour')).toBe("d'Éric Zemmour");
    expect(ofName('Anne Hidalgo')).toBe("d'Anne Hidalgo");
    expect(ofName('Emmanuel Macron')).toBe("d'Emmanuel Macron");
  });

  it('garde « de » devant une consonne', () => {
    expect(ofName('Marine Le Pen')).toBe('de Marine Le Pen');
    expect(ofName('Yannick Jadot')).toBe('de Yannick Jadot');
  });
});

describe('pearson', () => {
  it('calcule le coefficient', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1);
  });

  it('vaut 0 pour une série constante ou des tailles différentes', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
    expect(pearson([1, 2], [1])).toBe(0);
  });
});

describe.skipIf(!hasRealData)('constats sur les données réelles, positions lues', () => {
  const facts = computeFacts(ds, READ);

  it('quatre constats tiennent sur les données de 1995 à 2024', () => {
    expect(facts.map((f) => f.id).sort()).toEqual(
      ['centre-population', 'plus-semblables', 'retraites', 'zemmour-macron'].sort(),
    );
  });

  it('Zemmour est plus près de Macron que de Le Pen', () => {
    const f = fact(facts, 'zemmour-macron');
    expect(f.numbers['mapNear']).toBeCloseTo(0.18, 2);
    expect(f.numbers['mapFar']).toBeCloseTo(2.19, 2);
    expect(f.numbers['gapNear']).toBeCloseTo(9.3, 1);
    expect(f.numbers['gapFar']).toBeCloseTo(25.1, 1);
    expect(f.text).toContain("l'électorat d'Éric Zemmour");
    expect(f.text).toContain("celui d'Emmanuel Macron");
    expect(f.text).toContain('celui de Marine Le Pen');
    expect(f.text).toContain('0,18');
    expect(f.text).toContain('2,19');
    expect(f.target).toMatchObject({
      election: P2022,
      selected: 'c:zemmour',
      compared: 'c:macron',
    });
  });

  it('Mélenchon et Le Pen sont les compositions les plus semblables', () => {
    const f = fact(facts, 'plus-semblables');
    expect(f.numbers['gap']).toBeCloseTo(6.9, 1);
    expect(f.text).toContain('Jean-Luc Mélenchon');
    expect(f.text).toContain('Marine Le Pen');
    expect(f.usesPositions).toBe(false);
  });

  it('Dupont-Aignan est le plus proche du centre aux deux présidentielles', () => {
    const f = fact(facts, 'centre-population');
    expect(f.numbers['map2022']).toBeCloseTo(0.03, 2);
    expect(f.numbers['map2017']).toBeCloseTo(0.11, 2);
    expect(f.numbers['gap2022']).toBeCloseTo(7.4, 1);
    expect(f.numbers['gap2017']).toBeCloseTo(10.2, 1);
    expect(f.text).toContain('Nicolas Dupont-Aignan');
    expect(f.scope.n).toBe(2);
    // Le rang change avant eux : la réserve le dit, pour ne pas suggérer une constante.
    expect(f.caveat).toContain("En 2012, c'était celui de François Hollande");
  });

  it('le lien entre vote RN et CAP ne se répète plus : le constat disparaît', () => {
    const rn = ds.families?.families.find((f) => f.id === 'rn');
    if (!rn) throw new Error('famille absente');
    const cap = familyCorrelations(ds, rn, (p) => p.diplomes.cap);
    expect(cap).toHaveLength(12);
    expect(cap.find((c) => c.election === '2007_presidentielle_t1')?.r).toBeCloseTo(0.45, 2);
    expect(cap.find((c) => c.election === '2012_presidentielle_t1')?.r).toBeCloseTo(0.62, 2);
    expect(correlationRepeats(cap.map((c) => c.r))).toBe(false);
    expect(facts.map((f) => f.id)).not.toContain('rn-cap');
  });

  it('le même constat tient encore sur les seuls scrutins depuis 2017, sans être affiché', () => {
    const recent = ds.elections.filter((e) => (e.year ?? 0) >= 2017);
    const f = fact(computeFacts({ ...ds, elections: recent }, READ), 'rn-cap');
    expect(f.numbers['rCap']).toBeCloseTo(0.86, 2);
    // La moyenne exacte vaut 0,44 : le 0,45 du plan faisait la moyenne de valeurs déjà arrondies.
    expect(f.numbers['rNoDiploma']).toBeCloseTo(0.44, 2);
    expect(f.numbers['rIncome']).toBeCloseTo(-0.79, 2);
    expect(f.scope.elections).toHaveLength(7);
    expect(f.text).toContain('sur 7 scrutins');
    expect(f.scope).toMatchObject({ n: 6, unit: 'groupes' });
    expect(f.caveat).toContain('n = 6');
    expect(f.caveat).toContain("corrélation n'est pas causalité");
  });

  it('les retraités changent de camp, et le sens tient sur les seules législatives', () => {
    const f = fact(facts, 'retraites');
    expect(Math.round(f.numbers['upFirst'] ?? 0)).toBe(37);
    expect(Math.round(f.numbers['upLast'] ?? 0)).toBe(51);
    expect(Math.round(f.numbers['downFirst'] ?? 0)).toBe(58);
    expect(Math.round(f.numbers['downLast'] ?? 0)).toBe(40);
    expect(Math.round(f.numbers['upLegislativesFirst'] ?? 0)).toBe(43);
    expect(Math.round(f.numbers['downLegislativesFirst'] ?? 0)).toBe(61);
    expect(f.text).toContain('De la présidentielle de 2017 aux législatives de 2024');
    expect(f.caveat).toContain('Types de scrutin différents');
  });

  it('chaque constat vise des repères et une zone qui existent', () => {
    for (const f of facts) {
      const file = ds.computed.get(computedKey(READ, f.target.election));
      const ids = new Set(file?.candidates.map((c) => `c:${c.id}`));
      expect(ids.has(f.target.selected ?? ''), f.id).toBe(true);
      if (f.target.compared) expect(ids.has(f.target.compared), f.id).toBe(true);
      expect(f.target.box, f.id).not.toBeNull();
      expect(f.target.box?.x1 ?? 0, f.id).toBeGreaterThan(f.target.box?.x0 ?? 0);
      expect(f.caveat.length, f.id).toBeGreaterThan(0);
    }
  });

  it('aucun constat ne parle de distance à l’écran, ni ne cite le jeu de données de référence', () => {
    for (const f of facts) {
      expect(`${f.text} ${f.caveat}`.toLowerCase()).not.toMatch(/pixel|à l'écran|jnthnbs/);
    }
  });

  it('Arthaud et Le Pen sont rejetés par la règle de composition', () => {
    const election = ds.rawElections.get(P2022);
    if (!election) throw new Error('élection absente');
    const map = mapDistance(ds, READ, P2022, 'arthaud', 'le-pen');
    const gap = gapBetween(ds, election, 'arthaud', 'le-pen');
    expect(map).toBeCloseTo(0.17, 2);
    expect(gap).toBeCloseTo(18.6, 1);
    expect(closenessConfirmed(map ?? 0, gap)).toBe(false);
  });

  it('Macron et Zemmour passent la même règle', () => {
    const election = ds.rawElections.get(P2022);
    if (!election) throw new Error('élection absente');
    const map = mapDistance(ds, READ, P2022, 'macron', 'zemmour') ?? 99;
    expect(closenessConfirmed(map, gapBetween(ds, election, 'macron', 'zemmour'))).toBe(true);
  });

  it('une corrélation isolée ne produit pas de constat : Macron et le CAP', () => {
    const macron = ds.families?.families.find((f) => f.id === 'macron');
    if (!macron) throw new Error('famille absente');
    const rs = familyCorrelations(ds, macron, (p) => p.diplomes.cap).map((c) => c.r);
    expect(Math.abs(rs[0] ?? 0)).toBeGreaterThan(0.9);
    expect(correlationRepeats(rs)).toBe(false);
  });
});

describe.skipIf(!hasRealData)('un constat disparaît quand il devient faux', () => {
  it('Zemmour rapproché de Le Pen sur la carte', () => {
    const lePen = ds.computed
      .get(computedKey(READ, P2022))
      ?.candidates.find((c) => c.id === 'le-pen');
    const moved = withMoved(ds, READ, P2022, 'zemmour', lePen?.x ?? 0, lePen?.y ?? 0);
    expect(computeFacts(moved, READ).map((f) => f.id)).not.toContain('zemmour-macron');
  });

  it('un autre électorat au centre de la population', () => {
    const centre = ds.computed.get(computedKey(READ, P2022))?.population_barycenter;
    const moved = withMoved(ds, READ, P2022, 'macron', centre?.x ?? 0, centre?.y ?? 0);
    expect(computeFacts(moved, READ).map((f) => f.id)).not.toContain('centre-population');
  });

  it('une méthode inconnue ne garde que les constats sans position', () => {
    const facts = computeFacts(ds, 'inconnue');
    expect(facts.every((f) => !f.usesPositions)).toBe(true);
    expect(facts.every((f) => f.target.box === null)).toBe(true);
  });

  it('sans familles, seul reste le constat qui n’en dépend pas', () => {
    const facts = computeFacts({ ...ds, families: null }, READ);
    expect(facts.map((f) => f.id)).toEqual(['centre-population']);
  });

  it('sans données de sondage, aucun constat ni erreur', () => {
    expect(computeFacts({ ...ds, rawElections: new Map() }, READ)).toEqual([]);
  });
});

describe.skipIf(!hasRealData)('les autres méthodes', () => {
  it('produisent des constats vrais, sans erreur', () => {
    for (const method of ds.methods) {
      for (const f of computeFacts(ds, method.id)) {
        expect(f.text.length, `${method.id}/${f.id}`).toBeGreaterThan(20);
        expect(f.text, `${method.id}/${f.id}`).not.toContain('NaN');
      }
    }
  });
});
