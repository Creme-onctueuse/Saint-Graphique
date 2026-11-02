import { describe, expect, it } from 'vitest';
import { compositionByGroup, compositionGap } from './core/crossing.ts';
import { defaultState, type AppState } from './core/state.ts';
import { buildDataset } from './data/dataset.ts';
import { buildView } from './view.ts';
import { effectiveSelection } from './viewCrossing.ts';

const sampleModules = import.meta.glob<unknown>('./data/sample/**/*.json', {
  eager: true,
  import: 'default',
});
const sampleFiles: Record<string, unknown> = {};
for (const [path, value] of Object.entries(sampleModules)) {
  sampleFiles[path.replace('./data/sample/', '')] = value;
}
const ds = buildDataset(sampleFiles);

// Vraies données synchronisées par sync-data, si elles sont là.
const realModules = import.meta.glob<unknown>('./data/computed/**/*.json', {
  eager: true,
  import: 'default',
});
const realFiles: Record<string, unknown> = {};
for (const [path, value] of Object.entries(realModules)) {
  realFiles[path.replace('./data/computed/', '')] = value;
}
const real = Object.keys(realFiles).length > 0 ? buildDataset(realFiles) : null;
const hasReal = real !== null && !real.isSample && real.rawElections.size > 0;

function state(patch: Partial<AppState> = {}): AppState {
  return { ...defaultState(), ...patch };
}

function view(patch: Partial<AppState> = {}) {
  const v = buildView(ds, state(patch));
  if (!v) throw new Error('vue absente');
  return v;
}

describe('sélection', () => {
  it('ne change rien sans sélection', () => {
    const v = view();
    expect(v.crossing?.mode).toBe('map');
    expect(v.crossing?.focus).toBeNull();
    expect(v.crossing?.keys).toEqual([]);
    expect(v.model.candidates.every((c) => c.sizeShare === undefined)).toBe(true);
  });

  it('met en avant l’électorat sélectionné', () => {
    const first = view().model.candidates[0];
    const v = view({ selected: `c:${first?.id}` });
    expect(v.crossing?.selected?.kind).toBe('candidate');
    expect(v.crossing?.focus?.has(`c:${first?.id}`)).toBe(true);
    expect(v.crossing?.focus?.size).toBe(1);
  });

  it('met en avant les deux électorats d’un duel', () => {
    const [a, b] = view().model.candidates;
    const v = view({ selected: `c:${a?.id}`, compared: `c:${b?.id}` });
    expect(v.crossing?.compared?.key).toBe(`c:${b?.id}`);
    expect(v.crossing?.keys).toHaveLength(2);
    expect(v.crossing?.focus?.size).toBe(2);
  });

  it('ignore une sélection inconnue', () => {
    const v = view({ selected: 'c:personne', compared: 'c:autre' });
    expect(v.crossing?.selected).toBeNull();
    expect(v.crossing?.compared).toBeNull();
    expect(v.crossing?.focus).toBeNull();
  });

  it('donne la sélection telle qu’elle s’affiche', () => {
    expect(effectiveSelection(null, { selected: 'c:a', compared: null })).toEqual({
      selected: 'c:a',
      compared: null,
    });
  });
});

describe('vue depuis un groupe', () => {
  it('fait dépendre la taille des losanges du vote du groupe', () => {
    const code = view().model.pcs.find((p) => p.group === '6')?.code;
    const v = view({ selected: `p:${code}` });
    expect(v.crossing?.lens?.pollGroup).toBe('6');
    expect(v.model.candidates.every((c) => typeof c.sizeShare === 'number')).toBe(true);
    const total = (v.crossing?.lens?.rows ?? []).reduce((a, r) => a + r.share, 0);
    expect(total).toBeCloseTo(100);
  });

  it('garde les électorats et le groupe en avant, et estompe le reste', () => {
    const code = view().model.pcs.find((p) => p.group === '6')?.code;
    const v = view({ selected: `p:${code}` });
    const focus = v.crossing?.focus;
    for (const c of v.model.candidates) expect(focus?.has(`c:${c.id}`)).toBe(true);
    for (const p of v.model.pcs) expect(focus?.has(`p:${p.code}`)).toBe(p.group === '6');
  });

  it('ne donne aucun vote sans élection', () => {
    const code = view().model.pcs[0]?.code;
    const v = view({ election: 'population', selected: `p:${code}` });
    expect(v.crossing?.lens).toBeNull();
  });
});

describe('axes libres', () => {
  const v = view({ axisX: 'niveau_vie', axisY: 'bac5' });

  it('passe en mode libre, sur les catégories Insee', () => {
    expect(v.crossing?.mode).toBe('free');
    expect(v.model.xLabel).toBe('Niveau de vie mensuel');
    expect(v.model.pcs).toHaveLength(30);
    expect(v.method.label).toBe('Axes libres');
    expect(v.sources.positions).toEqual([]);
  });

  it('étend les variables sur toute la carte', () => {
    const xs = v.model.pcs.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-10);
    expect(Math.max(...xs)).toBeCloseTo(10);
  });

  it('montre les vraies valeurs aux extrémités, sans diagonale', () => {
    expect(v.model.axes?.plain).toBe(true);
    expect(v.model.axes?.ends?.xLow).toMatch(/€$/);
    expect(v.model.axes?.text?.x(-10)).toBe(v.model.axes?.ends?.xLow);
    expect(v.model.axes?.text?.x(10)).toBe(v.model.axes?.ends?.xHigh);
  });

  it('place les électorats sans ellipse', () => {
    expect(v.model.candidates.length).toBeGreaterThan(0);
    expect(v.model.candidates.every((c) => c.ellipse === null)).toBe(true);
    expect(v.hasEllipses).toBe(false);
    expect(v.canRecompute).toBe(false);
  });

  it('garde une réserve propre à ce mode', () => {
    expect(v.reserves[0]).toMatch(/^Axes libres/);
    expect(v.reserveSummary).toContain('30 catégories');
  });

  it('colore par classes quand on choisit une variable', () => {
    const colored = view({ axisX: 'niveau_vie', axisY: 'bac5', colorBy: 'patrimoine' });
    expect(colored.model.pcs.every((p) => /^var\(--sg-seq-[1-5]\)$/.test(p.fill ?? ''))).toBe(true);
    expect(v.model.pcs.every((p) => p.fill === undefined)).toBe(true);
  });

  it('prend une variable par défaut pour un axe manquant', () => {
    const one = view({ axisX: 'niveau_vie' });
    expect(one.crossing?.mode).toBe('free');
    expect(one.crossing?.free?.y.variable.id).toBe('bac5');
  });
});

describe('carte de proximité', () => {
  const v = view({ layout: 'proximity' });

  it('ne garde que les électorats, sans axes', () => {
    expect(v.crossing?.mode).toBe('proximity');
    expect(v.model.pcs).toEqual([]);
    expect(v.model.barycenter).toBeNull();
    expect(v.model.axes?.none).toBe(true);
    expect(v.model.candidates.length).toBeGreaterThan(2);
  });

  it('dit ce qu’elle conserve', () => {
    expect(v.crossing?.explained).toBeGreaterThan(0);
    expect(v.crossing?.explained).toBeLessThanOrEqual(1);
    expect(v.reserves[0]).toMatch(/\d+ % de cette information/);
  });

  it('reste dans la carte', () => {
    for (const c of v.model.candidates) {
      expect(Math.abs(c.x)).toBeLessThanOrEqual(10);
      expect(Math.abs(c.y)).toBeLessThanOrEqual(10);
    }
  });

  it('revient à la carte sans élection', () => {
    expect(view({ layout: 'proximity', election: 'population' }).crossing?.mode).toBe('map');
  });
});

describe.runIf(hasReal)('sur les vraies données', () => {
  const realView = (patch: Partial<AppState>) => {
    if (!real) throw new Error('données absentes');
    const v = buildView(real, state({ election: '2022_presidentielle_t1', ...patch }));
    if (!v) throw new Error('vue absente');
    return v;
  };

  it('retrouve les écarts mesurés pour 2022', () => {
    const election = realView({}).rawElection;
    if (!election) throw new Error('élection absente');
    const shares = (id: string): Record<string, number> => compositionByGroup(election, id);
    expect(compositionGap(shares('macron'), shares('zemmour'))).toBeCloseTo(9.3, 0);
    expect(compositionGap(shares('zemmour'), shares('le-pen'))).toBeCloseTo(25.1, 0);
    expect(compositionGap(shares('melenchon'), shares('le-pen'))).toBeCloseTo(6.9, 0);
  });

  it('rapproche Mélenchon et Le Pen sur la carte de proximité, contrairement à Arthaud', () => {
    const { model } = realView({ layout: 'proximity' });
    const at = (id: string) => model.candidates.find((c) => c.id === id);
    const distance = (a: string, b: string): number => {
      const p = at(a);
      const q = at(b);
      if (!p || !q) throw new Error('électorat absent');
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    expect(distance('melenchon', 'le-pen')).toBeLessThan(distance('arthaud', 'le-pen'));
  });

  it('couvre 30 catégories, dont les valeurs imputées signalées', () => {
    const v = realView({ axisX: 'immobilier', axisY: 'niveau_vie' });
    expect(v.model.pcs).toHaveLength(30);
    expect(v.model.xLabel).toContain('imputé');
    expect(v.model.pcs.filter((p) => p.notes.length > 0)).toHaveLength(27);
  });

  it('dit que les agriculteurs sont réunis aux indépendants, et qu’un groupe n’a pas de donnée', () => {
    const farmers = realView({ selected: 'p:11' });
    expect(farmers.crossing?.lens?.pollGroup).toBe('2');
    expect(farmers.crossing?.lens?.merged).toBe(true);
    const inactive = realView({ selected: 'p:81' });
    expect(inactive.crossing?.lens?.pollGroup).toBeNull();
    expect(inactive.model.candidates.every((c) => c.sizeShare === undefined)).toBe(true);
  });

  it('suit une famille d’une élection à l’autre', () => {
    const v = realView({ election: '2019_europeennes', selected: 'c:macron' });
    expect(v.crossing?.selected?.key).toBe('c:lrem');
    const none = realView({ election: '2022_legislatives_t1', selected: 'c:lfi' });
    expect(none.crossing?.selected).toBeNull();
    expect(none.crossing?.absent).toBe('France insoumise');
  });
});
