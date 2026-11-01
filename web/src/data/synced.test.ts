/**
 * Intégration avec le pipeline : vérifie les données réellement synchronisées dans src/data/computed/
 * (vraies données de data/computed/, ou fixture fictive en repli). Ignoré si `pnpm sync-data` n'a pas
 * encore été lancé, comme en CI où les tests précèdent le build.
 */
import { describe, expect, it } from 'vitest';
import { defaultState } from '../core/state.ts';
import { POPULATION_ID } from '../core/types.ts';
import { availableMethods, buildView } from '../view.ts';
import { buildDataset, computedKey } from './dataset.ts';

const modules = import.meta.glob<unknown>('./computed/**/*.json', {
  eager: true,
  import: 'default',
});
const files: Record<string, unknown> = {};
for (const [path, value] of Object.entries(modules)) {
  files[path.replace('./computed/', '')] = value;
}
const hasData = Object.keys(files).length > 0;

/** Les fichiers publiés sont arrondis à 1e-6. */
const PUBLISHED_TOLERANCE = 1e-5;

describe.skipIf(!hasData)('données synchronisées', () => {
  const ds = buildDataset(files);

  it('se chargent sans avertissement', () => {
    expect(ds.warnings).toEqual([]);
    expect(ds.computed.size).toBeGreaterThan(0);
    expect(availableMethods(ds).length).toBeGreaterThan(0);
    expect(ds.axes).toMatchObject({ xLabel: 'Exploitation', yLabel: 'Domination' });
  });

  it('couvrent chaque élection annoncée, pour chaque méthode', () => {
    for (const method of availableMethods(ds)) {
      for (const election of [POPULATION_ID, ...ds.elections.map((e) => e.id)]) {
        const view = buildView(ds, { ...defaultState(), method: method.id, election });
        expect(view?.source, `${method.id}/${election}`).toBe('precomputed');
        expect(view?.notes, `${method.id}/${election}`).toEqual([]);
        expect(view?.model.pcs.length).toBeGreaterThan(0);
        if (election !== POPULATION_ID) expect(view?.model.candidates.length).toBeGreaterThan(0);
      }
    }
  });

  it('donnent les mêmes coordonnées une fois recalculées dans le navigateur', () => {
    let checked = 0;
    for (const method of availableMethods(ds)) {
      for (const election of ds.elections) {
        const file = ds.computed.get(computedKey(method.id, election.id));
        const reference = buildView(ds, {
          ...defaultState(),
          method: method.id,
          election: election.id,
        });
        if (!file || !reference?.canRecompute) continue;
        // Un écart de poids négligeable force le recalcul sans changer aucun rang.
        const weights = {
          ...reference.defaults.y_weights,
          bac5: reference.defaults.y_weights.bac5 + 1e-13,
        };
        const client = buildView(ds, {
          ...defaultState(),
          method: method.id,
          election: election.id,
          weights,
        });
        expect(client?.source).toBe('client');
        const pcs = new Map(client?.model.pcs.map((p) => [p.code, p]));
        for (const p of file.pcs) {
          expect(Math.abs((pcs.get(p.code)?.x ?? NaN) - p.x)).toBeLessThan(PUBLISHED_TOLERANCE);
          expect(Math.abs((pcs.get(p.code)?.y ?? NaN) - p.y)).toBeLessThan(PUBLISHED_TOLERANCE);
        }
        const candidates = new Map(client?.model.candidates.map((c) => [c.id, c]));
        for (const c of file.candidates) {
          expect(Math.abs((candidates.get(c.id)?.x ?? NaN) - c.x)).toBeLessThan(
            PUBLISHED_TOLERANCE,
          );
          expect(Math.abs((candidates.get(c.id)?.y ?? NaN) - c.y)).toBeLessThan(
            PUBLISHED_TOLERANCE,
          );
        }
        checked++;
      }
    }
    // Sans données brutes, aucun recalcul n'est possible : rien à comparer.
    if (ds.rawPcs) expect(checked).toBeGreaterThan(0);
  });
});
