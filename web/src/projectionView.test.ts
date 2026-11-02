import { describe, expect, it } from 'vitest';
import { defaultState, type AppState } from './core/state.ts';
import { PROJECTION_ID } from './core/types.ts';
import { buildDataset } from './data/dataset.ts';
import { buildView, resolveElection } from './view.ts';

// La fixture fictive, complétée d'un fichier de projection pour sa méthode par défaut.
const modules = import.meta.glob<unknown>('./data/sample/**/*.json', {
  eager: true,
  import: 'default',
});
const files: Record<string, unknown> = {};
for (const [path, value] of Object.entries(modules)) {
  files[path.replace('./data/sample/', '')] = value;
}

const errors = { n: 4, position_mean: 0.3, position_worst: 1, score_mean: 5, score_worst: 9 };
const row = (phi: number, position: number): Record<string, number> => ({
  phi,
  n: 17,
  position_mean: position,
  position_worst: 2,
  score_mean: 6,
  score_worst: 20,
});
const projection = {
  method: 'ranks',
  target: { label: 'Présidentielle 2027', date: 2027.3 },
  data_end: '2024-07',
  min_history: 3,
  backtest: {
    parties: [row(0, 0.62), row(1, 0.81)],
    blocs: [row(0, 0.42), row(1, 0.51)],
    verdict: { trend_worse_position: true, trend_worse_score: true },
  },
  families: [
    {
      id: 'rn',
      label: 'Rassemblement national',
      color: '#123456',
      last_election: 'x',
      points: 7,
      still: { x: -1, y: -3 },
      trend: { x: 1, y: 2 },
      error: { still: errors, trend: { ...errors, n: 1 } },
    },
  ],
  blocs: [],
};

const plain = buildDataset(files);
const ds = buildDataset({ ...files, '_projection/ranks.json': projection });

function state(patch: Partial<AppState> = {}): AppState {
  return { ...defaultState(), ...patch };
}

describe('jeu de données', () => {
  it('lit la projection sans la prendre pour une méthode ou une élection', () => {
    expect(ds.warnings).toEqual(plain.warnings);
    expect(ds.projections.get('ranks')?.target.date).toBe(2027.3);
    expect(ds.methods.map((m) => m.id)).toEqual(plain.methods.map((m) => m.id));
    expect(ds.elections.map((e) => e.id)).toEqual(plain.elections.map((e) => e.id));
  });

  it('écarte un fichier invalide et le signale', () => {
    const broken = buildDataset({ ...files, '_projection/ranks.json': { method: 'ranks' } });
    expect(broken.projections.size).toBe(0);
    expect(broken.warnings.join(' ')).toContain('projection.schema.json');
  });
});

describe('étape de la projection', () => {
  it('n’existe que s’il y a une projection', () => {
    expect(resolveElection(ds, state({ election: PROJECTION_ID }))).toBe(PROJECTION_ID);
    expect(resolveElection(plain, state({ election: PROJECTION_ID }))).not.toBe(PROJECTION_ID);
  });

  it('montre les familles, avec une position et sans score', () => {
    const view = buildView(ds, state({ election: PROJECTION_ID, method: 'ranks' }));
    expect(view?.electionLabel).toBe('Projection 2027');
    expect(view?.projection?.method).toBe('ranks');
    expect(view?.model.candidates).toHaveLength(1);
    expect(view?.model.candidates[0]).toMatchObject({
      id: 'rn',
      label: 'Rassemblement national',
      x: -1,
      y: -3,
      share: null,
      composition: null,
    });
    expect(view?.notes).toEqual([]);
  });

  it('suit le scénario choisi', () => {
    const view = buildView(
      ds,
      state({ election: PROJECTION_ID, method: 'ranks', scenario: 'trend' }),
    );
    expect(view?.model.candidates[0]).toMatchObject({ x: 1, y: 2 });
    expect(view?.model.candidates[0]?.notes?.[1]).toContain('1 prédiction)');
  });

  it('garde les catégories et ajoute sa réserve à celles de la méthode', () => {
    const view = buildView(ds, state({ election: PROJECTION_ID, method: 'ranks' }));
    const reference = buildView(ds, state({ method: 'ranks' }));
    expect(view?.model.pcs).toHaveLength(reference?.model.pcs.length ?? -1);
    expect(view?.reserves[0]).toMatch(/^Projection 2027/);
    expect(view?.reserves.length).toBe((reference?.reserves.length ?? 0) + 1);
    expect(view?.reserveSummary).toContain('ne prévoit pas le résultat');
  });

  it('ne recalcule pas avec des poids modifiés', () => {
    const weights = { bac5: 1, bac3: 1, bac2: 1, bac: 1, cap: 1, brevet: 1, certif_aucun: 1 };
    const view = buildView(ds, state({ election: PROJECTION_ID, method: 'ranks', weights }));
    expect(view?.canRecompute).toBe(false);
    expect(view?.model.candidates[0]).toMatchObject({ x: -1, y: -3 });
    expect(view?.notes.join(' ')).toContain('sans effet');
  });

  it('n’apparaît pas sur les autres élections', () => {
    expect(buildView(ds, state())?.projection).toBeNull();
  });
});
