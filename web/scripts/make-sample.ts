/**
 * Génère la fixture d'exemple src/data/sample/ : données ENTIÈREMENT FICTIVES (archétypes de groupe
 * inventés, tirés par un générateur pseudo-aléatoire à graine fixe), conformes aux schémas du dépôt.
 * Aucun chiffre ne vient d'une source réelle ni d'un autre projet.
 * Elles servent au développement, aux tests et d'affichage de repli tant que data/computed/ est
 * vide. Ne pas citer.
 *
 * Usage : pnpm sample   (node --experimental-strip-types scripts/make-sample.ts)
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { compositionBarycenter, aggregateShares } from '../src/core/barycenter.ts';
import { computeLayout, type MethodParams } from '../src/core/methods.ts';
import { DEFAULT_Y_WEIGHTS } from '../src/core/scores.ts';
import {
  DIPLOMA_KEYS,
  type ComputedFile,
  type DiplomaShares,
  type Ellipse,
  type Point,
  type RawElection,
  type RawPcsData,
  type RawPcsItem,
  type SourceRef,
} from '../src/core/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const out = join(web, 'src', 'data', 'sample');
const GENERATED_AT = '2026-10-31T00:00:00Z';
const RANGE: [number, number] = [-10, 10];

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261031);
const jitter = (v: number, rel: number): number => v * (1 + rel * (2 * rand() - 1));
const gauss = (): number => {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};
const round = (v: number, d = 1): number => Math.round(v * 10 ** d) / 10 ** d;

// --- Métadonnées PCS : config/pcs.yaml (propriété du projet) ---------------------------------
interface PcsYaml {
  groups: Record<string, { label: string; color: string }>;
  items: { code: string; group: string; label: string; short: string }[];
}
const pcsYaml = parse(readFileSync(join(web, '..', 'config', 'pcs.yaml'), 'utf8')) as PcsYaml;
const methodsYaml = parse(readFileSync(join(web, '..', 'config', 'methods.yaml'), 'utf8')) as {
  axes: { x: { label: string; hint: string }; y: { label: string; hint: string } };
};

// --- Archétypes inventés, par groupe et en valeurs rondes : aucun chiffre n'est saisi par PCS ---
// Chaque PCS reçoit ensuite un tirage autour de l'archétype de son groupe. Aucune source réelle.
// Ordre des diplômes : bac5, bac3, bac2, bac, cap, brevet, certif_aucun.
interface GroupProfile {
  sharePct: number;
  niveauVie: number;
  patrimoine: number;
  diplomes: number[];
}
const GROUP_PROFILES: Record<string, GroupProfile> = {
  '1': { sharePct: 1, niveauVie: 2000, patrimoine: 500, diplomes: [5, 5, 10, 20, 30, 10, 20] },
  '2': { sharePct: 5, niveauVie: 2200, patrimoine: 600, diplomes: [10, 10, 10, 20, 25, 10, 15] },
  '3': { sharePct: 14, niveauVie: 3000, patrimoine: 450, diplomes: [40, 25, 15, 10, 5, 3, 2] },
  '4': { sharePct: 18, niveauVie: 2200, patrimoine: 250, diplomes: [10, 20, 25, 20, 15, 5, 5] },
  '5': { sharePct: 17, niveauVie: 1800, patrimoine: 150, diplomes: [3, 7, 10, 25, 30, 10, 15] },
  '6': { sharePct: 12, niveauVie: 1750, patrimoine: 120, diplomes: [1, 2, 5, 15, 35, 10, 32] },
  '7': { sharePct: 33, niveauVie: 1900, patrimoine: 250, diplomes: [5, 5, 5, 15, 25, 10, 35] },
};
const TOTAL_POPULATION = 30_000_000;

const FICTIONAL_SOURCE: SourceRef = {
  id: 'exemple-fictif',
  title: 'Données fictives de démonstration (générées par web/scripts/make-sample.ts)',
  url: '',
  accessed: GENERATED_AT.slice(0, 10),
  license: 'CC0-1.0',
  notes: 'Valeurs inventées pour le développement. Ne pas citer, ne représente aucune réalité.',
};

function diplomas(raw: number[]): DiplomaShares {
  const noisy = raw.map((v) => Math.max(0, jitter(v, 0.45)));
  const sum = noisy.reduce((a, b) => a + b, 0);
  const out = {} as DiplomaShares;
  DIPLOMA_KEYS.forEach((k, i) => (out[k] = round((100 * (noisy[i] ?? 0)) / sum)));
  return out;
}

/** Tirage de la part de chaque PCS dans son groupe (variance forte : petits et grands disques). */
const groupShares = new Map<string, number>();
for (const meta of pcsYaml.items) groupShares.set(meta.code, 0.05 + rand() ** 2);
const groupTotal = (group: string): number =>
  pcsYaml.items
    .filter((m) => m.group === group)
    .reduce((a, m) => a + (groupShares.get(m.code) ?? 0), 0);

const items: RawPcsItem[] = pcsYaml.items.map((meta) => {
  const p = GROUP_PROFILES[meta.group];
  if (!p) throw new Error(`Archétype manquant pour le groupe ${meta.group}`);
  const share = (p.sharePct * (groupShares.get(meta.code) ?? 0)) / groupTotal(meta.group);
  return {
    code: meta.code,
    group: meta.group,
    population: Math.round((share / 100) * TOTAL_POPULATION),
    niveau_vie_mensuel_eur: round(jitter(p.niveauVie, 0.25)),
    patrimoine_keur: round(jitter(p.patrimoine, 0.45)),
    diplomes: diplomas(p.diplomes),
    patrimoine_status: rand() < 0.4 ? 'imputed' : 'published',
    niveau_vie_status: rand() < 0.2 ? 'calculated' : 'published',
    source_refs: [FICTIONAL_SOURCE.id],
  };
});

// Ex æquo volontaire sur l'axe X, pour exercer la réserve correspondante.
const tiedA = items.find((it) => it.code === '62');
const tiedB = items.find((it) => it.code === '63');
if (tiedA && tiedB) {
  tiedB.niveau_vie_mensuel_eur = tiedA.niveau_vie_mensuel_eur;
  tiedB.patrimoine_keur = tiedA.patrimoine_keur;
}
const rawPcs: RawPcsData = {
  nomenclature: 'PCS2003-N2',
  reference_year: 2099,
  sources: [FICTIONAL_SOURCE],
  items,
};

// --- Élections fictives -----------------------------------------------------------------------
type Profile1 = Record<string, number>;
interface FakeCandidate {
  id: string;
  label: string;
  color: string;
  share: number;
  profile: Profile1;
  abstention?: boolean;
}

const PRESIDENTIAL: FakeCandidate[] = [
  {
    id: 'ambre',
    label: 'Candidate Ambre',
    color: '#e69f00',
    share: 27,
    profile: { '1': 2, '2': 6, '3': 16, '4': 15, '5': 10, '6': 6, '7': 40, '8': 5 },
  },
  {
    id: 'ardoise',
    label: 'Candidate Ardoise',
    color: '#4a5560',
    share: 24,
    profile: { '1': 3, '2': 7, '3': 5, '4': 12, '5': 22, '6': 21, '7': 24, '8': 6 },
  },
  {
    id: 'carmin',
    label: 'Candidate Carmin',
    color: '#c0392b',
    share: 21,
    profile: { '1': 1, '2': 4, '3': 12, '4': 19, '5': 20, '6': 16, '7': 18, '8': 10 },
  },
  {
    id: 'azur',
    label: 'Candidat Azur',
    color: '#0072b2',
    share: 9,
    profile: { '1': 4, '2': 10, '3': 12, '4': 9, '5': 8, '6': 5, '7': 48, '8': 4 },
  },
  {
    id: 'olive',
    label: 'Candidat Olive',
    color: '#5f8f2f',
    share: 8,
    profile: { '1': 2, '2': 5, '3': 22, '4': 24, '5': 14, '6': 5, '7': 18, '8': 10 },
  },
  {
    id: 'lilas',
    label: 'Candidate Lilas',
    color: '#9b72cf',
    share: 7,
    profile: { '1': 1, '2': 3, '3': 25, '4': 22, '5': 12, '6': 4, '7': 23, '8': 10 },
  },
  {
    id: 'safran',
    label: 'Candidat Safran',
    color: '#d4a017',
    share: 4,
    profile: { '1': 6, '2': 12, '3': 8, '4': 14, '5': 14, '6': 12, '7': 28, '8': 6 },
  },
  {
    id: 'abstention',
    label: 'Abstention',
    color: '#000000',
    share: 26,
    abstention: true,
    profile: { '1': 1, '2': 5, '3': 7, '4': 13, '5': 20, '6': 17, '7': 20, '8': 17 },
  },
];

const EUROPEAN: FakeCandidate[] = [
  {
    id: 'liste-brune',
    label: 'Liste Brune',
    color: '#8d5524',
    share: 30,
    profile: { '1': 3, '2': 7, '3': 5, '4': 12, '5': 20, '6': 19, '7': 30, '8': 4 },
  },
  {
    id: 'liste-orange',
    label: 'Liste Orange',
    color: '#f28e2b',
    share: 15,
    profile: { '1': 2, '2': 4, '3': 14, '4': 13, '5': 9, '6': 3, '7': 50, '8': 5 },
  },
  {
    id: 'liste-rose',
    label: 'Liste Rose',
    color: '#e377c2',
    share: 14,
    profile: { '1': 1, '2': 2, '3': 17, '4': 16, '5': 12, '6': 6, '7': 40, '8': 6 },
  },
  {
    id: 'liste-rouge',
    label: 'Liste Rouge',
    color: '#d62728',
    share: 10,
    profile: { '1': 1, '2': 4, '3': 11, '4': 15, '5': 17, '6': 15, '7': 12, '8': 25 },
  },
  {
    id: 'liste-bleue',
    label: 'Liste Bleue',
    color: '#1f5fa8',
    share: 8,
    profile: { '1': 5, '2': 7, '3': 14, '4': 15, '5': 11, '6': 5, '7': 39, '8': 4 },
  },
  {
    id: 'liste-verte',
    label: 'Liste Verte',
    color: '#2ca02c',
    share: 6,
    profile: { '1': 2, '2': 6, '3': 18, '4': 22, '5': 14, '6': 7, '7': 19, '8': 12 },
  },
  {
    id: 'divers',
    label: 'Divers',
    color: '#7f7f7f',
    share: 17,
    profile: { '1': 4, '2': 6, '3': 10, '4': 15, '5': 16, '6': 18, '7': 20, '8': 11 },
  },
  {
    id: 'abstention',
    label: 'Abstention',
    color: '#000000',
    share: 49,
    abstention: true,
    profile: { '1': 1, '2': 6, '3': 8, '4': 15, '5': 17, '6': 14, '7': 20, '8': 19 },
  },
];

/** Composition de niveau 1, bruitée puis normalisée à 100. */
function level1(profile: Profile1): Record<string, number> {
  const noisy = Object.entries(profile).map(([g, v]) => [g, Math.max(0, jitter(v, 0.1))] as const);
  const sum = noisy.reduce((a, [, v]) => a + v, 0);
  return Object.fromEntries(noisy.map(([g, v]) => [g, round((100 * v) / sum, 2)]));
}

/** Composition de niveau 2 : la part de chaque groupe est répartie entre ses PCS (bruitée). */
function level2(profile: Profile1): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [g, share] of Object.entries(level1(profile))) {
    const members = items.filter((it) => it.group === g);
    if (members.length === 0) {
      out[g] = share; // « 8 » : pas de PCS correspondante, ignoré au placement
      continue;
    }
    const w = members.map((m) => jitter(m.population, 0.3));
    const sw = w.reduce((a, b) => a + b, 0);
    members.forEach((m, i) => (out[m.code] = round((share * (w[i] ?? 0)) / sw, 2)));
  }
  return out;
}

function election(
  id: string,
  label: string,
  type: string,
  year: number,
  level: 1 | 2,
  cands: FakeCandidate[],
): RawElection {
  return {
    id,
    type,
    year,
    round: 1,
    label,
    pcs_level: level,
    sources: [FICTIONAL_SOURCE],
    margin_pts: 2.5,
    candidates: cands.map((c) => ({
      id: c.id,
      label: c.label,
      color: c.color,
      national_share_pct: c.share,
      ...(c.abstention ? { is_abstention: true } : {}),
    })),
    composition: Object.fromEntries(
      cands.map((c) => [c.id, level === 1 ? level1(c.profile) : level2(c.profile)]),
    ),
  };
}

const elections: RawElection[] = [
  election(
    'exemple_presidentielle',
    'Présidentielle fictive (exemple)',
    'presidentielle',
    2099,
    1,
    PRESIDENTIAL,
  ),
  election(
    'exemple_europeennes',
    'Européennes fictives (exemple)',
    'europeennes',
    2098,
    2,
    EUROPEAN,
  ),
];

// --- Méthodes et calcul -----------------------------------------------------------------------
const METHODS: { id: string; label: string; description: string; params: MethodParams }[] = [
  {
    id: 'ranks',
    label: 'Rangs reconstruits',
    description:
      'Rangs 1..N normalisés sur [-10, 10] (graphique original de Chris et de la PaduTeam)',
    params: {
      x_score: 'patrimoine_over_niveau_vie',
      y_weights: { ...DEFAULT_Y_WEIGHTS },
      retired_y_override: { code: '7', score: -180 },
      candidate_pcs_level: 1,
      range: RANGE,
    },
  },
  {
    id: 'continuous',
    label: 'Valeurs continues',
    description: 'Valeurs continues standardisées (z-scores) puis remises à l’échelle [-10, 10]',
    params: {
      x_score: 'patrimoine_over_niveau_vie',
      y_weights: { ...DEFAULT_Y_WEIGHTS },
      retired_y_override: null,
      candidate_pcs_level: 1,
      range: RANGE,
    },
  },
];

/** Ellipse de confiance à 95 % d'un nuage de points (covariance, χ²(2) = 5,991). */
function ellipseOf(points: Point[]): Ellipse {
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  sxx /= n - 1;
  syy /= n - 1;
  sxy /= n - 1;
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(0, tr / 2 - disc);
  // Vecteur propre du grand axe : (sxy, l1 − sxx) ; angle ramené dans ]−90°, 90°].
  let angle =
    Math.abs(sxy) < 1e-15 ? (sxx >= syy ? 0 : 90) : (Math.atan2(l1 - sxx, sxy) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const k = 5.991;
  return {
    rx: round(Math.sqrt(k * l1), 4),
    ry: round(Math.sqrt(k * l2), 4),
    angle_deg: round(angle, 2),
  };
}

/** Bootstrap : parts perturbées de ±margin (IC 95 %), positions recalculées. */
function bootstrapEllipses(
  e: RawElection,
  coords: { byGroup: Map<string, Point>; groupOf: Map<string, string> },
): Map<string, Ellipse> {
  const sd = (e.margin_pts ?? 2.5) / 1.96;
  const out = new Map<string, Ellipse>();
  for (const c of e.candidates) {
    const shares = e.composition[c.id] ?? {};
    const pts: Point[] = [];
    for (let b = 0; b < 400; b++) {
      const s: Record<string, number> = {};
      for (const [k, v] of Object.entries(shares)) s[k] = Math.max(0, v + sd * gauss());
      const lvl1 = e.pcs_level === 2 ? aggregateShares(s, coords.groupOf) : s;
      const p = compositionBarycenter(lvl1, coords.byGroup);
      if (p) pts.push(p);
    }
    out.set(c.id, ellipseOf(pts));
  }
  return out;
}

const labelOf = new Map(pcsYaml.items.map((m) => [m.code, m.label]));
const shortOf = new Map(pcsYaml.items.map((m) => [m.code, m.short]));
const POPULATION_LABEL = 'Population fictive (sans élection)';
const files: Record<string, unknown> = {};

for (const m of METHODS) {
  for (const target of [null, ...elections]) {
    const layout = computeLayout(m.id, m.params, { pcs: items, election: target });
    const groupOf = new Map(layout.pcs.map((p) => [p.code, p.group]));
    const ellipses = target ? bootstrapEllipses(target, { byGroup: layout.groups, groupOf }) : null;
    const file: ComputedFile = {
      method: m.id,
      params: { ...m.params },
      election_id: target ? target.id : 'population',
      generated_at: GENERATED_AT,
      axes: { x_label: methodsYaml.axes.x.label, y_label: methodsYaml.axes.y.label, range: RANGE },
      pcs: layout.pcs.map((p) => ({
        code: p.code,
        group: p.group,
        label: labelOf.get(p.code) ?? p.code,
        short: shortOf.get(p.code) ?? p.code,
        x: p.x,
        y: p.y,
        weight: p.weight,
      })),
      candidates: layout.candidates.map((lc) => {
        const c = target?.candidates.find((cc) => cc.id === lc.id);
        const ellipse = ellipses?.get(lc.id);
        return {
          id: lc.id,
          label: c?.label ?? lc.id,
          color: c?.color ?? '#888888',
          x: lc.x,
          y: lc.y,
          ...(c?.national_share_pct !== undefined
            ? { national_share_pct: c.national_share_pct }
            : {}),
          ...(c?.is_abstention ? { is_abstention: true } : {}),
          ...(ellipse ? { ellipse } : {}),
        };
      }),
      population_barycenter: layout.population_barycenter,
    };
    files[`${m.id}/${file.election_id}.json`] = file;
  }
}

files['_raw/pcs.json'] = rawPcs;
for (const e of elections) files[`_raw/elections/${e.id}.json`] = e;
files['index.json'] = {
  sample: true,
  description:
    'Données FICTIVES de démonstration (web/scripts/make-sample.ts). Ne pas citer : elles ne représentent aucune réalité.',
  generated_at: GENERATED_AT,
  axes: {
    x_label: methodsYaml.axes.x.label,
    y_label: methodsYaml.axes.y.label,
    x_hint: methodsYaml.axes.x.hint,
    y_hint: methodsYaml.axes.y.hint,
    range: RANGE,
  },
  path_template: '{method}/{election}.json',
  default_method: 'ranks',
  methods: METHODS.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    ellipses: true,
    elections: ['population', ...elections.map((e) => e.id)],
  })),
  elections: [
    { id: 'population', label: POPULATION_LABEL, type: 'population', year: 2099 },
    ...elections.map((e) => ({
      id: e.id,
      label: e.label,
      type: e.type,
      year: e.year,
      round: e.round,
    })),
  ],
  groups: Object.entries(pcsYaml.groups).map(([code, g]) => ({
    code,
    label: g.label,
    color: g.color,
  })),
  raw: {
    pcs: '_raw/pcs.json',
    elections: Object.fromEntries(elections.map((e) => [e.id, `_raw/elections/${e.id}.json`])),
  },
  sources: [FICTIONAL_SOURCE],
};

rmSync(out, { recursive: true, force: true });
for (const [path, value] of Object.entries(files)) {
  const target = join(out, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
console.log(`Fixture d'exemple écrite : ${Object.keys(files).length} fichiers dans ${out}`);
