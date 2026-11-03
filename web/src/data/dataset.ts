/**
 * Normalisation des fichiers de données embarqués (copie de data/computed/, voir
 * scripts/sync-data.mjs) en un jeu de données unique, tolérant aux variantes de index.json.
 *
 * Fichiers reconnus (chemins relatifs à src/data/computed/) :
 * - index.json : méthodes, élections, axes, groupes (pipeline/build.py, build_index) ; variantes
 *   tolérées (tableau d'objets ou objet indexé par identifiant) ;
 * - <méthode>/<élection>.json : coordonnées calculées (schemas/computed.schema.json) ;
 * - _raw/pcs.json, _raw/elections/<id>.json : données brutes (facultatives), copiées depuis data/
 *   ou référencées/incluses dans index.json (clé `raw`) ; elles permettent le recalcul client ;
 * - _config.json : config/*.yaml converti par sync-data (libellés courts, couleurs, paramètres).
 * - _pool.json : valeurs que les fichiers calculés ont en commun (voir unpack.ts).
 */
import {
  POPULATION_ID,
  type ComputedFile,
  type RawElection,
  type RawPcsData,
  type SourceRef,
} from '../core/types.ts';
import { asProjectionFile, type ProjectionFile } from '../core/projection.ts';
import {
  asComputedFile,
  asFamilyConfig,
  asMethodAxes,
  asRawElection,
  asRawPcs,
  asSources,
  entries,
  isRec,
  NEUTRAL_COLOR,
  num,
  rawElectionRefs,
  rec,
  resolveRef,
  str,
  type Rec,
} from './parse.ts';
import { unpackComputed } from './unpack.ts';

/** Axes propres à une méthode (config/methods.yaml, methods.<id>.axes). */
export interface MethodAxes {
  xLabel: string;
  yLabel: string;
  /** Textes des extrémités des axes. */
  ends: { xLow: string; xHigh: string; yLow: string; yHigh: string };
}

export interface MethodInfo {
  id: string;
  label: string;
  description: string;
  /** Null : la méthode garde les axes communs. */
  axes: MethodAxes | null;
  /** Paramètres par défaut (index.json ou config), sinon ceux du premier fichier calculé. */
  params: Record<string, unknown> | null;
  /** Méthode exploratoire : signalée comme telle dans l'interface. */
  exploratory: boolean;
  /** Élections disposant de coordonnées précalculées pour cette méthode. */
  elections: Set<string>;
}

export interface ElectionInfo {
  id: string;
  label: string;
  type: string | null;
  year: number | null;
  round: number | null;
}

export interface GroupInfo {
  code: string;
  label: string;
  /** Couleur des données (repli si le thème ne définit pas --sg-group-<code>). */
  color: string;
}

export interface PcsMeta {
  code: string;
  group: string;
  label: string;
  short: string;
}

export interface AxesInfo {
  xLabel: string;
  yLabel: string;
  xHint: string;
  yHint: string;
  range: [number, number];
}

/** Familles politiques et blocs (config/families.yaml) : ce qui relie les élections entre elles. */
export interface FamilyInfo {
  id: string;
  label: string;
  /** La famille entre dans le test sur le passé et la projection 2027. */
  projection: boolean;
  /** Électorat de la famille à chaque élection. Élection absente : un trou dans la trajectoire. */
  candidates: Map<string, string>;
}

export interface BlocInfo {
  id: string;
  label: string;
  candidates: Set<string>;
}

export interface FamilyConfig {
  /** Date de chaque scrutin, en années décimales. */
  dates: Map<string, number>;
  families: FamilyInfo[];
  blocs: BlocInfo[];
  unclassified: Set<string>;
}

export interface Dataset {
  isSample: boolean;
  generatedAt: string | null;
  axes: AxesInfo;
  methods: MethodInfo[];
  /** Méthode proposée par défaut (index.json, clé default_method). */
  defaultMethod: string | null;
  /** Élections réelles, sans l'entrée « population ». */
  elections: ElectionInfo[];
  populationLabel: string;
  groups: Map<string, GroupInfo>;
  pcsMeta: Map<string, PcsMeta>;
  /** Clé : `${méthode}/${élection}`. */
  computed: Map<string, ComputedFile>;
  rawPcs: RawPcsData | null;
  rawElections: Map<string, RawElection>;
  /** Null si config/families.yaml manque (données d'exemple). */
  families: FamilyConfig | null;
  /** Projection 2027, par méthode (_projection/<méthode>.json). Vide si absente. */
  projections: Map<string, ProjectionFile>;
  sources: SourceRef[];
  warnings: string[];
}

/** Libellés de repli des méthodes connues. */
const METHOD_LABELS: Record<string, string> = {
  read_positions: 'Positions lues (Chris)',
  ranks: 'Rangs reconstruits',
  continuous: 'Valeurs continues',
  mca: 'ACM (terciles)',
  espace_social: 'Espace social',
  acm_individus: 'ACM individus',
};

/** Méthodes exploratoires, en plus de celles que index.json marque `exploratory: true`. */
const EXPLORATORY_METHODS: ReadonlySet<string> = new Set(['mca', 'acm_individus']);
const EXPLORATORY_SUFFIX = ' (exploratoire)';

/** Libellé pour l'en-tête, où la place manque : la réserve figure déjà dans le bandeau du bas. */
export function shortMethodLabel(label: string): string {
  return label.endsWith(EXPLORATORY_SUFFIX) ? label.slice(0, -EXPLORATORY_SUFFIX.length) : label;
}

const DEFAULT_GROUP_LABELS: Record<string, string> = {
  '1': 'Agriculteurs exploitants',
  '2': "Artisans, commerçants et chefs d'entreprise",
  '3': 'Cadres et professions intellectuelles supérieures',
  '4': 'Professions intermédiaires',
  '5': 'Employés',
  '6': 'Ouvriers',
  '7': 'Retraités',
  '8': 'Autres personnes sans activité professionnelle',
};

export function computedKey(method: string, election: string): string {
  return `${method}/${election}`;
}

function humanize(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Construit le jeu de données à partir des fichiers embarqués (clé = chemin relatif). */
export function buildDataset(embedded: Readonly<Record<string, unknown>>): Dataset {
  const files = unpackComputed(embedded);
  const warnings: string[] = [];
  const index = rec(files['index.json']);
  const config = rec(files['_config.json']);
  const configPcs = rec(config['pcs']);
  const configMethods = rec(config['methods']);
  const configElections = rec(config['elections']);
  const labelsBlock = rec(index['labels']);

  // Fichiers calculés
  const computed = new Map<string, ComputedFile>();
  for (const [path, value] of Object.entries(files)) {
    if (!/^[^_][^/]*\/[^/]+\.json$/.test(path)) continue;
    const file = asComputedFile(value, warnings);
    if (!file) {
      warnings.push(`Fichier ignoré (non conforme à computed.schema.json) : ${path}`);
      continue;
    }
    computed.set(computedKey(file.method, file.election_id), file);
  }
  const firstFile = computed.values().next().value;

  // Projection 2027 : hors du motif ci-dessus, car un dossier « _ » n'est pas une méthode.
  const projections = new Map<string, ProjectionFile>();
  for (const [path, value] of Object.entries(files)) {
    if (!/^_projection\/[^/]+\.json$/.test(path)) continue;
    const file = asProjectionFile(value);
    if (file) projections.set(file.method, file);
    else warnings.push(`Fichier ignoré (non conforme à projection.schema.json) : ${path}`);
  }

  // Données brutes
  const rawBlock = rec(index['raw'] ?? index['inputs']);
  let rawPcs = asRawPcs(resolveRef(rawBlock['pcs'] ?? index['pcs_data'], files));
  rawPcs ??= asRawPcs(files['_raw/pcs.json']);
  const rawElections = new Map<string, RawElection>();
  for (const { id, ref } of rawElectionRefs(rawBlock['elections'])) {
    const e = asRawElection(resolveRef(ref, files), id ?? undefined);
    if (e) rawElections.set(e.id, e);
  }
  for (const [path, value] of Object.entries(files)) {
    const m = /^_raw\/elections\/([^/]+)\.json$/.exec(path);
    if (!m?.[1]) continue;
    const e = asRawElection(value, m[1]);
    if (e && !rawElections.has(e.id)) rawElections.set(e.id, e);
  }

  // Axes
  const ia = rec(index['axes']);
  const ca = rec(configMethods['axes']);
  const pickRange = (...candidates: unknown[]): [number, number] | null => {
    for (const r of candidates) {
      if (Array.isArray(r) && r.length === 2) {
        const lo = num(r[0]);
        const hi = num(r[1]);
        if (lo !== null && hi !== null && hi > lo) return [lo, hi];
      }
    }
    return null;
  };
  const axes: AxesInfo = {
    xLabel:
      str(ia['x_label']) ??
      str(rec(ia['x'])['label']) ??
      str(rec(ca['x'])['label']) ??
      firstFile?.axes.x_label ??
      'Exploitation',
    yLabel:
      str(ia['y_label']) ??
      str(rec(ia['y'])['label']) ??
      str(rec(ca['y'])['label']) ??
      firstFile?.axes.y_label ??
      'Domination',
    xHint: str(ia['x_hint']) ?? str(rec(ia['x'])['hint']) ?? str(rec(ca['x'])['hint']) ?? '',
    yHint: str(ia['y_hint']) ?? str(rec(ia['y'])['hint']) ?? str(rec(ca['y'])['hint']) ?? '',
    range: pickRange(ia['range'], ca['range'], firstFile?.axes.range) ?? [-10, 10],
  };

  // Méthodes
  const methodMap = new Map<string, MethodInfo>();
  const ensureMethod = (id: string): MethodInfo => {
    let m = methodMap.get(id);
    if (!m) {
      m = {
        id,
        label: METHOD_LABELS[id] ?? humanize(id),
        description: '',
        axes: null,
        params: null,
        exploratory: EXPLORATORY_METHODS.has(id),
        elections: new Set(),
      };
      methodMap.set(id, m);
    }
    return m;
  };
  // index.json est lu après la config : ses valeurs l'emportent.
  const describe = (m: MethodInfo, r: Rec): void => {
    const label = str(r['label']) ?? str(r['name']);
    if (label) m.label = label;
    const description = str(r['description']);
    if (description) m.description = description;
    m.axes = asMethodAxes(r['axes']) ?? m.axes;
    if (r['exploratory'] === true) m.exploratory = true;
    if (isRec(r['params'])) m.params = r['params'];
    else if ('y_weights' in r || 'x_score' in r) m.params = r;
  };
  const configMethodEntries = entries(configMethods['methods']);
  const indexMethodEntries = entries(index['methods']);
  for (const { id, rec: r } of configMethodEntries) describe(ensureMethod(id), r);
  for (const { id, rec: r } of indexMethodEntries) describe(ensureMethod(id), r);
  for (const file of computed.values()) {
    const m = ensureMethod(file.method);
    m.elections.add(file.election_id);
    if (!m.params && Object.keys(file.params).length > 0) m.params = file.params;
  }
  for (const m of methodMap.values()) {
    if (m.exploratory && !m.label.includes('exploratoire')) m.label += EXPLORATORY_SUFFIX;
  }
  const declared = new Set(indexMethodEntries.map((e) => e.id));
  const methods = [...methodMap.values()].sort((a, b) => {
    // Ordre : index.json, puis config, puis fichiers.
    const rank = (m: MethodInfo): number => {
      const i = indexMethodEntries.findIndex((e) => e.id === m.id);
      if (i >= 0) return i;
      const j = configMethodEntries.findIndex((e) => e.id === m.id);
      return j >= 0 ? 1000 + j : 2000;
    };
    return rank(a) - rank(b);
  });
  if (declared.size > 0) {
    for (const m of methods) {
      if (!declared.has(m.id) && m.elections.size > 0) {
        warnings.push(`Méthode ${m.id} présente dans les fichiers mais absente de index.json`);
      }
    }
  }

  // Élections
  const electionMap = new Map<string, ElectionInfo>();
  const describeElection = (id: string, r: Rec): void => {
    const prev = electionMap.get(id);
    electionMap.set(id, {
      id,
      label: str(r['label']) ?? prev?.label ?? humanize(id),
      type: str(r['type']) ?? prev?.type ?? null,
      year: num(r['year']) ?? prev?.year ?? null,
      round: num(r['round']) ?? prev?.round ?? null,
    });
  };
  const configElectionEntries = entries(configElections['elections']);
  const indexElectionEntries = entries(index['elections']);
  for (const { id, rec: r } of configElectionEntries) describeElection(id, r);
  for (const { id, rec: r } of indexElectionEntries) describeElection(id, r);
  for (const e of rawElections.values()) {
    if (!electionMap.has(e.id)) {
      describeElection(e.id, { label: e.label, type: e.type, year: e.year, round: e.round });
    }
  }
  const available = new Set<string>();
  for (const file of computed.values()) available.add(file.election_id);
  for (const id of rawElections.keys()) if (rawPcs) available.add(id);
  for (const id of available) if (!electionMap.has(id)) describeElection(id, {});
  const order = [
    ...indexElectionEntries.map((e) => e.id),
    ...configElectionEntries.map((e) => e.id),
  ];
  const elections = [...electionMap.values()]
    .filter((e) => e.id !== POPULATION_ID && available.has(e.id))
    .sort((a, b) => {
      const ia2 = order.indexOf(a.id);
      const ib2 = order.indexOf(b.id);
      return (ia2 < 0 ? 1e6 : ia2) - (ib2 < 0 ? 1e6 : ib2) || a.id.localeCompare(b.id);
    });

  // Groupes PCS niveau 1
  const groups = new Map<string, GroupInfo>();
  const groupSources = [
    configPcs['groups'],
    index['groups'] ?? index['pcs_groups'] ?? labelsBlock['groups'],
  ];
  for (const src of groupSources) {
    for (const { id, rec: r } of entries(src)) {
      const prev = groups.get(id);
      groups.set(id, {
        code: id,
        label: str(r['label']) ?? prev?.label ?? DEFAULT_GROUP_LABELS[id] ?? `Groupe ${id}`,
        color: str(r['color']) ?? prev?.color ?? NEUTRAL_COLOR,
      });
    }
  }

  // Libellés des PCS
  const pcsMeta = new Map<string, PcsMeta>();
  const setMeta = (code: string, r: Rec): void => {
    const prev = pcsMeta.get(code);
    const label = str(r['label']) ?? prev?.label ?? code;
    pcsMeta.set(code, {
      code,
      group: str(r['group']) ?? prev?.group ?? code.charAt(0),
      label,
      short: str(r['short']) ?? prev?.short ?? label,
    });
  };
  if (firstFile) {
    for (const p of firstFile.pcs) {
      setMeta(p.code, { label: p.label, group: p.group, ...(p.short ? { short: p.short } : {}) });
    }
  }
  for (const { id, rec: r } of entries(configPcs['items'])) setMeta(id, r);
  for (const { id, rec: r } of entries(index['pcs'] ?? labelsBlock['pcs'])) setMeta(id, r);
  for (const meta of pcsMeta.values()) {
    if (!groups.has(meta.group)) {
      groups.set(meta.group, {
        code: meta.group,
        label: DEFAULT_GROUP_LABELS[meta.group] ?? `Groupe ${meta.group}`,
        color: NEUTRAL_COLOR,
      });
    }
  }

  // Sources (dédoublonnées)
  const sources: SourceRef[] = [];
  const seen = new Set<string>();
  for (const s of [
    ...asSources(index['sources']),
    ...(rawPcs?.sources ?? []),
    ...[...rawElections.values()].flatMap((e) => e.sources),
  ]) {
    const key = `${s.id}|${s.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(s);
  }

  return {
    isSample: index['sample'] === true || index['is_sample'] === true,
    generatedAt: str(index['generated_at']),
    axes,
    methods,
    defaultMethod: str(index['default_method']),
    elections,
    populationLabel: electionMap.get(POPULATION_ID)?.label ?? 'Population (sans élection)',
    groups,
    pcsMeta,
    computed,
    rawPcs,
    rawElections,
    // Les familles nomment de vrais candidats : elles ne s'appliquent pas aux données fictives.
    families:
      index['sample'] === true || index['is_sample'] === true
        ? null
        : asFamilyConfig(config['families']),
    projections,
    sources,
    warnings,
  };
}
