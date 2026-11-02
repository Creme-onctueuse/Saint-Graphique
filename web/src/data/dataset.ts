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
 */
import {
  DIPLOMA_KEYS,
  POPULATION_ID,
  type ComputedCandidate,
  type ComputedFile,
  type ComputedPcs,
  type DiplomaShares,
  type Ellipse,
  type RawCandidate,
  type RawElection,
  type RawPcsData,
  type RawPcsItem,
  type SourceRef,
} from '../core/types.ts';
import { asProjectionFile, type ProjectionFile } from '../core/projection.ts';

export interface MethodInfo {
  id: string;
  label: string;
  description: string;
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

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Rec => (isRec(v) ? v : {});

/** Libellés de repli des méthodes connues. */
const METHOD_LABELS: Record<string, string> = {
  read_positions: 'Positions lues (Chris)',
  ranks: 'Rangs reconstruits',
  continuous: 'Valeurs continues',
  mca: 'ACM (terciles)',
};

/** Méthodes exploratoires, en plus de celles que index.json marque `exploratory: true`. */
const EXPLORATORY_METHODS: ReadonlySet<string> = new Set(['mca']);
const EXPLORATORY_SUFFIX = ' (exploratoire)';

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

const NEUTRAL_COLOR = '#888888';

export function computedKey(method: string, election: string): string {
  return `${method}/${election}`;
}

/**
 * Liste normalisée d'entrées { id, rec } à partir d'un tableau de chaînes, d'un tableau d'objets
 * porteurs d'un `id`, ou d'un objet indexé par identifiant (valeur objet ou libellé).
 */
function entries(v: unknown): { id: string; rec: Rec }[] {
  const out: { id: string; rec: Rec }[] = [];
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === 'string') out.push({ id: item, rec: {} });
      else if (isRec(item)) {
        const id = str(item['id']) ?? str(item['code']);
        if (id) out.push({ id, rec: item });
      }
    }
  } else if (isRec(v)) {
    for (const [id, value] of Object.entries(v)) {
      if (isRec(value)) out.push({ id, rec: value });
      else if (typeof value === 'string') out.push({ id, rec: { label: value } });
      else out.push({ id, rec: {} });
    }
  }
  return out;
}

function asEllipse(v: unknown): Ellipse | undefined {
  if (!isRec(v)) return undefined;
  const rx = num(v['rx']);
  const ry = num(v['ry']);
  const angle = num(v['angle_deg']);
  if (rx === null || ry === null || angle === null || rx < 0 || ry < 0) return undefined;
  return { rx, ry, angle_deg: angle };
}

function asComputedPcs(v: unknown): ComputedPcs | null {
  if (!isRec(v)) return null;
  const code = str(v['code']) ?? (typeof v['code'] === 'number' ? String(v['code']) : null);
  const x = num(v['x']);
  const y = num(v['y']);
  if (code === null || x === null || y === null) return null;
  const pcs: ComputedPcs = {
    code,
    group: str(v['group']) ?? code.charAt(0),
    label: str(v['label']) ?? code,
    x,
    y,
    weight: num(v['weight']) ?? 0,
  };
  const short = str(v['short']);
  if (short) pcs.short = short;
  const note = str(v['note']);
  if (note) pcs.note = note;
  return pcs;
}

function asComputedCandidate(v: unknown): ComputedCandidate | null {
  if (!isRec(v)) return null;
  const id = str(v['id']);
  const x = num(v['x']);
  const y = num(v['y']);
  if (id === null || x === null || y === null) return null;
  const c: ComputedCandidate = {
    id,
    label: str(v['label']) ?? id,
    color: str(v['color']) ?? NEUTRAL_COLOR,
    x,
    y,
  };
  const share = num(v['national_share_pct']);
  if (share !== null) c.national_share_pct = share;
  if (v['is_abstention'] === true) c.is_abstention = true;
  const ellipse = asEllipse(v['ellipse']);
  if (ellipse) c.ellipse = ellipse;
  return c;
}

/** Valide un fichier calculé ; les items invalides sont écartés. */
export function asComputedFile(v: unknown, warnings: string[] = []): ComputedFile | null {
  if (!isRec(v)) return null;
  const method = str(v['method']);
  const election = str(v['election_id']);
  if (!method || !election || !Array.isArray(v['pcs']) || !Array.isArray(v['candidates'])) {
    return null;
  }
  const pcs = v['pcs'].map(asComputedPcs).filter((p): p is ComputedPcs => p !== null);
  const candidates = v['candidates']
    .map(asComputedCandidate)
    .filter((c): c is ComputedCandidate => c !== null);
  const dropped = v['pcs'].length - pcs.length + (v['candidates'].length - candidates.length);
  if (dropped > 0)
    warnings.push(`${method}/${election} : ${dropped} élément(s) invalide(s) ignoré(s)`);
  if (pcs.length === 0) return null;

  const axes = rec(v['axes']);
  const range = Array.isArray(axes['range']) ? axes['range'].map(num) : [];
  const lo = range[0];
  const hi = range[1];
  const bary = rec(v['population_barycenter']);
  const bx = num(bary['x']);
  const by = num(bary['y']);
  let population_barycenter = bx !== null && by !== null ? { x: bx, y: by } : null;
  if (!population_barycenter) {
    const total = pcs.reduce((a, p) => a + p.weight, 0);
    population_barycenter =
      total > 0
        ? {
            x: pcs.reduce((a, p) => a + p.weight * p.x, 0) / total,
            y: pcs.reduce((a, p) => a + p.weight * p.y, 0) / total,
          }
        : { x: 0, y: 0 };
  }
  const file: ComputedFile = {
    method,
    params: rec(v['params']),
    election_id: election,
    axes: {
      x_label: str(axes['x_label']) ?? 'Exploitation',
      y_label: str(axes['y_label']) ?? 'Domination',
      range: typeof lo === 'number' && typeof hi === 'number' && hi > lo ? [lo, hi] : [-10, 10],
    },
    pcs,
    candidates,
    population_barycenter,
  };
  const generated = str(v['generated_at']);
  if (generated) file.generated_at = generated;
  const sources = asSources(v['sources']);
  if (sources.length > 0) file.sources = sources;
  return file;
}

/** Lit la section « families » de _config.json. */
export function asFamilyConfig(v: unknown): FamilyConfig | null {
  if (!isRec(v) || !isRec(v['families']) || !isRec(v['blocs'])) return null;
  const dates = new Map<string, number>();
  for (const [id, value] of Object.entries(rec(v['dates']))) {
    const date = num(value);
    if (date !== null) dates.set(id, date);
  }
  const families: FamilyInfo[] = Object.entries(v['families']).flatMap(([id, value]) => {
    if (!isRec(value)) return [];
    const candidates = new Map<string, string>();
    for (const [election, candidate] of Object.entries(rec(value['candidates']))) {
      const cid = str(candidate);
      if (cid) candidates.set(election, cid);
    }
    return [
      {
        id,
        label: str(value['label']) ?? id,
        projection: value['projection'] === true,
        candidates,
      },
    ];
  });
  const stringsOf = (list: unknown): string[] =>
    Array.isArray(list) ? list.map(str).filter((s): s is string => s !== null) : [];
  const blocs: BlocInfo[] = Object.entries(v['blocs']).flatMap(([id, value]) =>
    isRec(value)
      ? [
          {
            id,
            label: str(value['label']) ?? id,
            candidates: new Set(stringsOf(value['candidates'])),
          },
        ]
      : [],
  );
  return { dates, families, blocs, unclassified: new Set(stringsOf(v['unclassified'])) };
}

function asSources(v: unknown): SourceRef[] {
  if (!Array.isArray(v)) return [];
  const out: SourceRef[] = [];
  for (const s of v) {
    if (!isRec(s)) continue;
    const title = str(s['title']);
    if (!title) continue;
    const ref: SourceRef = {
      id: str(s['id']) ?? title,
      title,
      url: str(s['url']) ?? '',
      accessed: str(s['accessed']) ?? '',
    };
    const publisher = str(s['publisher']);
    if (publisher) ref.publisher = publisher;
    const license = str(s['license']);
    if (license) ref.license = license;
    const notes = str(s['notes']);
    if (notes) ref.notes = notes;
    out.push(ref);
  }
  return out;
}

function asDiplomas(v: unknown): DiplomaShares | null {
  if (!isRec(v)) return null;
  const out = {} as DiplomaShares;
  for (const k of DIPLOMA_KEYS) {
    const n = num(v[k]);
    if (n === null) return null;
    out[k] = n;
  }
  return out;
}

/** Valide data/pcs.json ; tout ou rien (des données partielles fausseraient les rangs). */
export function asRawPcs(v: unknown): RawPcsData | null {
  if (!isRec(v) || !Array.isArray(v['items']) || v['items'].length === 0) return null;
  const items: RawPcsItem[] = [];
  for (const it of v['items']) {
    if (!isRec(it)) return null;
    const code = str(it['code']);
    const group = str(it['group']);
    const population = num(it['population']);
    const nv = num(it['niveau_vie_mensuel_eur']);
    const pat = num(it['patrimoine_keur']);
    const diplomes = asDiplomas(it['diplomes']);
    if (!code || !group || population === null || nv === null || pat === null || !diplomes) {
      return null;
    }
    const item: RawPcsItem = {
      code,
      group,
      population,
      niveau_vie_mensuel_eur: nv,
      patrimoine_keur: pat,
      diplomes,
    };
    const nvStatus = str(it['niveau_vie_status']);
    if (nvStatus) item.niveau_vie_status = nvStatus;
    const patStatus = str(it['patrimoine_status']);
    if (patStatus) item.patrimoine_status = patStatus;
    items.push(item);
  }
  return {
    nomenclature: str(v['nomenclature']) ?? '',
    reference_year: num(v['reference_year']) ?? 0,
    sources: asSources(v['sources']),
    items,
  };
}

/** Valide data/elections/<id>.json. */
export function asRawElection(v: unknown, fallbackId?: string): RawElection | null {
  if (!isRec(v)) return null;
  const id = str(v['id']) ?? fallbackId ?? null;
  if (!id || !Array.isArray(v['candidates']) || !isRec(v['composition'])) return null;
  const candidates: RawCandidate[] = [];
  for (const c of v['candidates']) {
    if (!isRec(c)) continue;
    const cid = str(c['id']);
    if (!cid) continue;
    const cand: RawCandidate = {
      id: cid,
      label: str(c['label']) ?? cid,
      color: str(c['color']) ?? NEUTRAL_COLOR,
    };
    const share = num(c['national_share_pct']);
    if (share !== null) cand.national_share_pct = share;
    if (c['is_abstention'] === true) cand.is_abstention = true;
    candidates.push(cand);
  }
  const composition: Record<string, Record<string, number>> = {};
  for (const [cid, shares] of Object.entries(v['composition'])) {
    if (!isRec(shares)) continue;
    const clean: Record<string, number> = {};
    for (const [code, share] of Object.entries(shares)) {
      const n = num(share);
      if (n !== null && n >= 0) clean[code] = n;
    }
    composition[cid] = clean;
  }
  const level = v['pcs_level'];
  // Niveau absent : déduit des clés (les codes de groupe sont des chiffres seuls).
  const keys = Object.values(composition).flatMap((s) => Object.keys(s));
  const election: RawElection = {
    id,
    type: str(v['type']) ?? '',
    year: num(v['year']) ?? 0,
    label: str(v['label']) ?? id,
    pcs_level: level === 1 || level === 2 ? level : keys.some((k) => k.length > 1) ? 2 : 1,
    sources: asSources(v['sources']),
    candidates,
    composition,
  };
  const round = num(v['round']);
  if (round !== null) election.round = round;
  const margin = num(v['margin_pts']);
  if (margin !== null) election.margin_pts = margin;
  return election;
}

/** Résout une référence de index.json : objet inclus ou chemin vers un fichier embarqué. */
function resolveRef(ref: unknown, files: Readonly<Record<string, unknown>>): unknown {
  if (isRec(ref)) return ref;
  const path = str(ref);
  if (!path) return undefined;
  const clean = path.replace(/^(\.\.?\/)+/, '').replace(/^data\//, '');
  const base = clean.split('/').pop() ?? clean;
  const stem = base.replace(/\.json$/, '');
  return (
    files[clean] ??
    files[`_raw/${clean}`] ??
    files[`_raw/${base}`] ??
    files[`_raw/elections/${stem}.json`]
  );
}

/** Références aux élections brutes dans index.json (`raw.elections`) : chemins ou objets inclus. */
function rawElectionRefs(v: unknown): { id: string | null; ref: unknown }[] {
  const out: { id: string | null; ref: unknown }[] = [];
  const pick = (r: Rec): unknown => ('candidates' in r ? r : (r['path'] ?? r['file']));
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === 'string') out.push({ id: null, ref: item });
      else if (isRec(item)) out.push({ id: str(item['id']), ref: pick(item) });
    }
  } else if (isRec(v)) {
    for (const [id, value] of Object.entries(v)) {
      if (typeof value === 'string') out.push({ id, ref: value });
      else if (isRec(value)) out.push({ id, ref: pick(value) });
    }
  }
  return out;
}

function humanize(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Construit le jeu de données à partir des fichiers embarqués (clé = chemin relatif). */
export function buildDataset(files: Readonly<Record<string, unknown>>): Dataset {
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
    families: asFamilyConfig(config['families']),
    projections,
    sources,
    warnings,
  };
}
