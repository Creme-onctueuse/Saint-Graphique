/**
 * Étapes antérieures à 2017, sur les données réellement synchronisées : ignoré sans ces données.
 * Vérifie ce que la page doit dire à ces étapes : leur source, la réserve, et les électorats absents.
 */
import { describe, expect, it } from 'vitest';
import { registeredShares, voteByGroup } from './core/crossing.ts';
import { defaultState, type AppState } from './core/state.ts';
import { stopsForFilter, sourceChangesUpTo, timelineStops, yearGroups } from './core/timeline.ts';
import { buildDataset } from './data/dataset.ts';
import { compactSources } from './ui/sources.ts';
import { buildView } from './view.ts';

const modules = import.meta.glob<unknown>('./data/computed/**/*.json', {
  eager: true,
  import: 'default',
});
const files: Record<string, unknown> = {};
for (const [path, value] of Object.entries(modules)) {
  files[path.replace('./data/computed/', '')] = value;
}
const ds = buildDataset(files);
const hasRealData = !ds.isSample && ds.families !== null && ds.rawElections.size > 0;

function state(patch: Partial<AppState> = {}): AppState {
  return { ...defaultState(), ...patch };
}

describe.skipIf(!hasRealData)('étapes antérieures à 2017', () => {
  const stops = timelineStops(ds);

  it('chaque scrutin connaît son institut', () => {
    const source = (id: string): string | null | undefined =>
      stops.find((s) => s.id === id)?.source;
    expect(source('1995_presidentielle_t1')).toBe('CSA');
    expect(source('2002_presidentielle_t1')).toBe('Ipsos');
    expect(source('2007_presidentielle_t1')).toBe('CSA-Cisco');
    expect(source('2012_presidentielle_t1')).toBe('Ifop-Fiducial');
    expect(source('2014_europeennes')).toBe('Ifop-Fiducial');
    expect(source('2022_presidentielle_t1')).toBe('Ifop-Fiducial');
    for (const stop of stops.filter((s) => !s.projection)) expect(stop.source).not.toBeNull();
  });

  it('la frise court de 1995 à 2027, sans étape sans date', () => {
    const groups = yearGroups(stops);
    expect(groups[0]?.year).toBe(1995);
    expect(groups.at(-1)?.year).toBe(2027);
    expect(groups.reduce((sum, g) => sum + g.gap, 0)).toBe(32);
  });

  it('avant 2017, le résumé et le détail disent que la carte est celle de 2026', () => {
    const view = buildView(ds, state({ election: '2002_presidentielle_t1' }));
    expect(view?.reserveSummary).toContain('Électorat de 2002');
    expect(view?.reserveSummary).toContain('2026');
    expect(view?.reserves[0]).toMatch(/^Étape ancienne/);
    expect(view?.reserves[0]).toContain('positions de 2026');
  });

  it('à partir de 2017, la réserve reste celle de la méthode', () => {
    const view = buildView(ds, state({ election: '2017_presidentielle_t1' }));
    expect(view?.reserveSummary).not.toContain('Électorat de');
    expect(view?.reserves.some((r) => r.startsWith('Étape ancienne'))).toBe(false);
  });

  it('les pointillés ne sont expliqués que si une source change avant l’étape affichée', () => {
    const presidential = stopsForFilter(stops, 'presidentielle');
    expect(sourceChangesUpTo(presidential, 1995.31)).toBe(false);
    expect(sourceChangesUpTo(presidential, 2002.3)).toBe(true);
    const at = (election: string): string[] => buildView(ds, state({ election }))?.reserves ?? [];
    expect(at('1995_presidentielle_t1').some((r) => r.startsWith('Trajectoires'))).toBe(false);
    expect(at('2022_presidentielle_t1').some((r) => r.startsWith('Trajectoires'))).toBe(true);
  });

  it('le poids des groupes reste sur 100 quand l’abstention n’est connue que par son taux', () => {
    const election = ds.rawElections.get('2012_presidentielle_t1');
    if (!election) throw new Error('élection absente');
    const { weights } = voteByGroup(election);
    expect([...weights.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect(registeredShares(election).get('abstention')).toBe(20.52);
  });

  it('un électorat sans composition garde son score mais n’a pas de point', () => {
    const election = ds.rawElections.get('2012_presidentielle_t1');
    const view = buildView(ds, state({ election: '2012_presidentielle_t1' }));
    expect(election?.candidates.some((c) => c.id === 'cheminade')).toBe(true);
    expect(view?.model.candidates.some((c) => c.id === 'cheminade')).toBe(false);
    expect(view?.model.candidates.some((c) => c.id === 'abstention')).toBe(false);
  });

  it('la ligne compacte cite le sondage, pas les résultats officiels ni les effectifs', () => {
    const view = buildView(ds, state({ election: '1995_presidentielle_t1' }));
    if (!view) throw new Error('vue absente');
    expect(view.sources.poll.map((s) => s.publisher)).toEqual([
      'CSA',
      'Conseil constitutionnel',
      'Insee',
    ]);
    const line = compactSources(view);
    expect(line).toContain('CSA 1995');
    expect(line).not.toContain('Conseil constitutionnel');
  });
});
