import { describe, expect, it } from 'vitest';
import { defaultState, type AppState } from './core/state.ts';
import { asComputedFile, asRawElection, asRawPcs, buildDataset } from './data/dataset.ts';
import { availableMethods, buildView, defaultElection, effectiveParams } from './view.ts';
import { defaultParamsFor } from './core/methods.ts';
import { DEFAULT_Y_WEIGHTS } from './core/scores.ts';

// La fixture fictive a la même forme que la sortie de pipeline/build.py.
const modules = import.meta.glob<unknown>('./data/sample/**/*.json', {
  eager: true,
  import: 'default',
});
const files: Record<string, unknown> = {};
for (const [path, value] of Object.entries(modules)) {
  files[path.replace('./data/sample/', '')] = value;
}
const ds = buildDataset(files);

function state(patch: Partial<AppState> = {}): AppState {
  return { ...defaultState(), ...patch };
}

describe('jeu de données d’exemple', () => {
  it('est signalé comme fictif et complet', () => {
    expect(ds.isSample).toBe(true);
    expect(ds.warnings).toEqual([]);
    expect(ds.defaultMethod).toBe('ranks_jnthnbs');
    expect(ds.methods.map((m) => m.id)).toEqual(['ranks_jnthnbs', 'continuous']);
    expect(ds.elections.map((e) => e.id)).toEqual([
      'exemple_presidentielle',
      'exemple_europeennes',
    ]);
    expect(ds.populationLabel).toContain('fictive');
    expect(ds.groups.size).toBe(7);
    expect(ds.pcsMeta.get('10')?.short).toBe('Agriculteurs');
    expect(ds.rawPcs?.items).toHaveLength(30);
    expect(ds.rawElections.size).toBe(2);
    expect(ds.axes).toMatchObject({
      xLabel: 'Exploitation',
      yLabel: 'Domination',
      range: [-10, 10],
    });
  });

  it('a ses coordonnées précalculées cohérentes avec le calcul dans le navigateur', () => {
    for (const method of ['ranks_jnthnbs', 'continuous']) {
      for (const election of ['exemple_presidentielle', 'exemple_europeennes']) {
        const precomputed = buildView(ds, state({ method, election }));
        expect(precomputed?.source).toBe('precomputed');
        const params = precomputed?.defaults;
        // Un score imposé identique, mais passé par l'état, ne doit pas forcer le recalcul.
        const same = buildView(ds, state({ method, election, weights: { ...DEFAULT_Y_WEIGHTS } }));
        expect(same?.customized).toBe(false);
        expect(params).toBeDefined();
        const nudged = { ...DEFAULT_Y_WEIGHTS, bac5: 5 + 1e-12 };
        const client = buildView(ds, state({ method, election, weights: nudged }));
        expect(client?.source).toBe('client');
        const expected = new Map(precomputed?.model.candidates.map((c) => [c.id, c]));
        for (const c of client?.model.candidates ?? []) {
          expect(c.x).toBeCloseTo(expected.get(c.id)?.x ?? Number.NaN, 8);
          expect(c.y).toBeCloseTo(expected.get(c.id)?.y ?? Number.NaN, 8);
        }
      }
    }
  });
});

describe('buildView', () => {
  it('choisit la méthode et l’élection par défaut', () => {
    const view = buildView(ds, state());
    expect(view?.method.id).toBe('ranks_jnthnbs');
    expect(view?.electionId).toBe('exemple_presidentielle');
    expect(defaultElection(ds)).toBe('exemple_presidentielle');
    expect(view?.source).toBe('precomputed');
    expect(view?.hasEllipses).toBe(true);
    expect(view?.model.pcs).toHaveLength(30);
    expect(view?.model.candidates.find((c) => c.id === 'abstention')?.isAbstention).toBe(true);
    expect(view?.model.pcs.find((p) => p.code === '7')?.short).toBe('Retraités');
  });

  it('remplace une élection ou une méthode inconnue (URL périmée) par le défaut', () => {
    const view = buildView(ds, state({ election: 'inconnue', method: 'inconnue' }));
    expect(view?.electionId).toBe('exemple_presidentielle');
    expect(view?.method.id).toBe('ranks_jnthnbs');
  });

  it('affiche la population sans électorat', () => {
    const view = buildView(ds, state({ election: 'population' }));
    expect(view?.isPopulation).toBe(true);
    expect(view?.model.candidates).toEqual([]);
    expect(view?.model.pcs).toHaveLength(30);
  });

  it('recalcule et masque les ellipses quand les poids changent', () => {
    const view = buildView(
      ds,
      state({ weights: { ...DEFAULT_Y_WEIGHTS, bac5: -5, certif_aucun: 5 } }),
    );
    expect(view?.source).toBe('client');
    expect(view?.customized).toBe(true);
    expect(view?.hasEllipses).toBe(false);
    expect(view?.notes.join(' ')).toMatch(/recalculées/);
    const reference = buildView(ds, state());
    const moved = view?.model.pcs.filter(
      (p) => p.y !== reference?.model.pcs.find((q) => q.code === p.code)?.y,
    );
    expect(moved?.length).toBeGreaterThan(0);
  });

  it('recalcule quand le score des retraités change', () => {
    const off = buildView(ds, state({ retired: 'off' }));
    expect(off?.params.retired_y_override).toBeNull();
    expect(off?.source).toBe('client');
    const value = buildView(ds, state({ retired: 50 }));
    expect(value?.params.retired_y_override).toEqual({ code: '7', score: 50 });
    const same = buildView(ds, state({ retired: -180 }));
    expect(same?.customized).toBe(false);
    expect(same?.source).toBe('precomputed');
  });

  it('donne la composition de l’électorat par groupe, y compris au niveau 2', () => {
    const presidential = buildView(ds, state());
    const level1 = presidential?.model.candidates[0]?.composition;
    expect(level1?.[0]?.label).toBeTruthy();
    const european = buildView(ds, state({ election: 'exemple_europeennes' }));
    const level2 = european?.model.candidates[0]?.composition ?? [];
    expect(level2.length).toBeGreaterThan(0);
    expect(level2.length).toBeLessThanOrEqual(8);
    expect(level2[0]?.share).toBeGreaterThanOrEqual(level2.at(-1)?.share ?? 0);
  });
});

describe('sans données brutes (index.json de WP3 seul)', () => {
  const withoutRaw: Record<string, unknown> = Object.fromEntries(
    Object.entries(files).filter(([k]) => !k.startsWith('_raw/')),
  );
  const index = withoutRaw['index.json'] as Record<string, unknown>;
  const lean = { ...index };
  delete lean['raw'];
  withoutRaw['index.json'] = lean;
  const dsLean = buildDataset(withoutRaw);

  it('affiche les coordonnées précalculées et bloque les réglages', () => {
    expect(dsLean.rawPcs).toBeNull();
    const view = buildView(dsLean, state({ weights: { ...DEFAULT_Y_WEIGHTS, bac5: 0 } }));
    expect(view?.source).toBe('precomputed');
    expect(view?.canRecompute).toBe(false);
    expect(view?.recomputeBlock).toMatch(/brutes/);
    expect(view?.reserves[1]).toContain('statut inconnu');
    expect(view?.sources).toEqual({ poll: [], pcs: [], positions: [] });
    expect(view?.hasEllipses).toBe(true);
    expect(view?.model.candidates[0]?.composition).toBeNull();
  });

  it('ne propose que les méthodes disposant de fichiers', () => {
    const noFiles = buildDataset({
      'index.json': { methods: [{ id: 'mca', label: 'ACM' }], elections: [] },
    });
    expect(availableMethods(noFiles)).toEqual([]);
    expect(buildView(noFiles, state())).toBeNull();
  });
});

describe('recalcul quand le fichier précalculé manque', () => {
  it('calcule dans le navigateur si les données brutes sont là', () => {
    const partial = Object.fromEntries(
      Object.entries(files).filter(([k]) => !k.startsWith('continuous/')),
    );
    const dsPartial = buildDataset(partial);
    const view = buildView(dsPartial, state({ method: 'continuous' }));
    expect(view?.source).toBe('client');
    expect(view?.customized).toBe(false);
    expect(view?.model.candidates.length).toBeGreaterThan(0);
  });
});

describe('positions lues', () => {
  const source = { id: 'video', title: 'Vidéo', url: 'https://youtu.be/x' };
  const reading = {
    method: 'read_positions',
    params: {},
    election_id: 'population',
    axes: { x_label: 'Exploitation', y_label: 'Domination', range: [-10, 10] },
    pcs: [
      {
        code: '75',
        group: '7',
        label: 'Anciennes professions intermédiaires',
        x: 5,
        y: -5,
        weight: 6.6,
        note: 'Position et poids lus sur le graphique de Chris.',
      },
    ],
    candidates: [],
    population_barycenter: { x: 5, y: -5 },
    sources: [source],
  };
  const withReading = buildDataset({ ...files, 'read_positions/population.json': reading });
  const view = buildView(withReading, state({ method: 'read_positions', election: 'population' }));

  it('remplace les réserves sur le patrimoine par celle des positions lues', () => {
    expect(view?.reserves).toHaveLength(1);
    expect(view?.reserves[0]).toMatch(/^Positions lues/);
    expect(view?.reserves[0]).not.toContain('composition du patrimoine');
  });

  it('ne prête aucun statut de patrimoine à une position lue', () => {
    expect(view?.model.pcs[0]?.status).toBeNull();
  });

  it('donne la provenance dans l’infobulle et cite les vidéos', () => {
    expect(view?.model.pcs[0]?.notes).toEqual(['Position et poids lus sur le graphique de Chris.']);
    expect(view?.sources.positions.map((s) => s.url)).toEqual(['https://youtu.be/x']);
  });

  it('ne se recalcule pas dans le navigateur', () => {
    expect(view?.canRecompute).toBe(false);
  });
});

describe('réserves de la page', () => {
  it('compte les statuts de la fixture et signale les valeurs imputées', () => {
    const view = buildView(ds, state());
    expect(view?.reserves[1]).toMatch(/axe Exploitation : \d+ valeurs? imputées?/);
    const p = view?.model.pcs[0];
    expect(['published', 'imputed']).toContain(p?.status?.patrimoine);
  });

  it('calcule les ex æquo depuis les scores, avec un ordre arbitraire pour les rangs', () => {
    const view = buildView(ds, state());
    const reserve = view?.reserves.find((r) => r.startsWith('Ex æquo'));
    expect(reserve).toContain('axe Exploitation');
    expect(reserve).toContain('OQ industriels');
    expect(reserve).toContain('OQ artisanaux');
    expect(reserve).toContain('arbitraire (départage par code PCS)');
    const tied = view?.model.pcs.find((p) => p.code === '63');
    expect(tied?.notes[0]).toContain('OQ industriels');
    expect(tied?.notes[0]).toContain('arbitraire');
    expect(view?.model.pcs.find((p) => p.code === '10')?.notes).toEqual([]);
  });

  it('n’annonce pas d’ordre arbitraire pour une méthode sans rangs', () => {
    const view = buildView(ds, state({ method: 'continuous' }));
    const reserve = view?.reserves.find((r) => r.startsWith('Ex æquo'));
    expect(reserve).toContain('même position');
    expect(reserve).not.toContain('arbitraire');
  });

  it('recalcule les ex æquo avec les poids de l’utilisateur', () => {
    const nul = { bac5: 0, bac3: 0, bac2: 0, bac: 0, cap: 0, brevet: 0, certif_aucun: 0 };
    const view = buildView(ds, state({ weights: nul }));
    expect(view?.reserves.some((r) => r.includes('axe Domination'))).toBe(true);
  });

  it('expose les sources du sondage et celles des PCS, lues dans les données', () => {
    const view = buildView(ds, state());
    expect(view?.sources.poll.length).toBeGreaterThan(0);
    expect(view?.sources.pcs.length).toBeGreaterThan(0);
    expect(buildView(ds, state({ election: 'population' }))?.sources.poll).toEqual([]);
  });

  it('garde la définition de l’axe X et retire la réserve si tout est publié', () => {
    const raw = files['_raw/pcs.json'] as { items: Record<string, unknown>[] };
    const withStatus = (niveauVie: string): ReturnType<typeof buildView> =>
      buildView(
        buildDataset({
          ...files,
          '_raw/pcs.json': {
            ...raw,
            items: raw.items.map((it) => ({
              ...it,
              patrimoine_status: 'published',
              niveau_vie_status: niveauVie,
            })),
          },
        }),
        state(),
      );
    const published = withStatus('published');
    expect(published?.reserves[0]).toContain('composition du patrimoine');
    expect(published?.reserves.some((r) => r.startsWith('Réserve'))).toBe(false);
    const calculated = withStatus('calculated');
    expect(calculated?.reserves.some((r) => r.startsWith('Réserve'))).toBe(true);
    expect(calculated?.model.pcs[0]?.status?.niveauVie).toBe('calculated');
  });

  it('signale « statut inconnu » tant que les champs manquent, sans rien inventer', () => {
    const raw = files['_raw/pcs.json'] as { items: Record<string, unknown>[] };
    const bare = {
      ...raw,
      items: raw.items.map(({ patrimoine_status: _p, niveau_vie_status: _n, ...rest }) => rest),
    };
    const view = buildView(buildDataset({ ...files, '_raw/pcs.json': bare }), state());
    expect(view?.reserves[1]).toContain('statut inconnu');
    expect(view?.model.pcs[0]?.status).toEqual({ patrimoine: 'unknown', niveauVie: 'unknown' });
  });

  it('marque l’ACM « exploratoire » dans son libellé', () => {
    const d = buildDataset({ 'index.json': { methods: [{ id: 'mca', label: 'ACM (terciles)' }] } });
    const mca = d.methods.find((m) => m.id === 'mca');
    expect(mca?.label).toBe('ACM (terciles) (exploratoire)');
    expect(mca?.exploratory).toBe(true);
    expect(ds.methods.find((m) => m.id === 'ranks_jnthnbs')?.exploratory).toBe(false);
  });
});

describe('effectiveParams', () => {
  const defaults = defaultParamsFor('ranks_jnthnbs');

  it('laisse les paramètres intacts par défaut', () => {
    const { params, customized } = effectiveParams(defaults, { weights: null, retired: 'default' });
    expect(customized).toBe(false);
    expect(params.retired_y_override).toEqual({ code: '7', score: -180 });
  });

  it('active un score imposé sur une méthode qui n’en a pas', () => {
    const { params, customized } = effectiveParams(defaultParamsFor('continuous'), {
      weights: null,
      retired: -100,
    });
    expect(customized).toBe(true);
    expect(params.retired_y_override).toEqual({ code: '7', score: -100 });
  });
});

describe('normalisation de index.json et des fichiers', () => {
  it('accepte les variantes (objets indexés, tableaux de chaînes)', () => {
    const file = {
      method: 'm',
      election_id: 'e',
      params: {},
      axes: { x_label: 'X', y_label: 'Y', range: [-1, 1] },
      pcs: [{ code: '10', group: '1', label: 'L', x: 0, y: 0, weight: 100 }],
      candidates: [],
      population_barycenter: { x: 0, y: 0 },
    };
    const d = buildDataset({
      'index.json': {
        methods: { m: { label: 'Méthode' } },
        elections: ['e'],
        groups: { '1': 'Groupe un' },
        axes: { x: { label: 'Ex', hint: 'h' }, y: { label: 'Ey' }, range: [-1, 1] },
      },
      'm/e.json': file,
    });
    expect(d.methods[0]?.label).toBe('Méthode');
    expect(d.elections[0]?.id).toBe('e');
    expect(d.groups.get('1')?.label).toBe('Groupe un');
    expect(d.axes.xLabel).toBe('Ex');
    expect(d.axes.xHint).toBe('h');
  });

  it('écarte les fichiers non conformes en le signalant', () => {
    const d = buildDataset({ 'm/e.json': { method: 'm' } });
    expect(d.computed.size).toBe(0);
    expect(d.warnings.join(' ')).toMatch(/m\/e\.json/);
  });

  it('écarte les éléments invalides d’un fichier calculé', () => {
    const warnings: string[] = [];
    const f = asComputedFile(
      {
        method: 'm',
        election_id: 'e',
        pcs: [{ code: '10', x: 0, y: 0, weight: 100 }, { code: '11' }],
        candidates: [{ id: 'a', x: 1, y: 1, ellipse: { rx: -1, ry: 0, angle_deg: 0 } }],
      },
      warnings,
    );
    expect(f?.pcs).toHaveLength(1);
    expect(f?.candidates[0]?.ellipse).toBeUndefined();
    expect(warnings[0]).toMatch(/1 élément/);
    expect(f?.population_barycenter).toEqual({ x: 0, y: 0 });
  });

  it('refuse des données brutes partielles, qui fausseraient les rangs', () => {
    expect(asRawPcs({ items: [{ code: '10' }] })).toBeNull();
    expect(asRawPcs({ items: [] })).toBeNull();
  });

  it('déduit le niveau d’une composition absent du fichier', () => {
    const base = { id: 'e', candidates: [{ id: 'a' }] };
    expect(asRawElection({ ...base, composition: { a: { '21': 1 } } })?.pcs_level).toBe(2);
    expect(asRawElection({ ...base, composition: { a: { '2': 1 } } })?.pcs_level).toBe(1);
  });
});
