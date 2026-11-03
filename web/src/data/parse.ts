/**
 * Lecture tolérante des fichiers de données : chaque fonction rend une valeur sûre, ou null si le
 * fichier ne convient pas. buildDataset (dataset.ts) en fait le jeu de données de la page.
 */
import {
  DIPLOMA_KEYS,
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
import type { BlocInfo, FamilyConfig, FamilyInfo, MethodAxes } from './dataset.ts';

export type Rec = Record<string, unknown>;

export const isRec = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;
export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
export const rec = (v: unknown): Rec => (isRec(v) ? v : {});

export const NEUTRAL_COLOR = '#888888';

/**
 * Liste normalisée d'entrées { id, rec } à partir d'un tableau de chaînes, d'un tableau d'objets
 * porteurs d'un `id`, ou d'un objet indexé par identifiant (valeur objet ou libellé).
 */
export function entries(v: unknown): { id: string; rec: Rec }[] {
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

export function asSources(v: unknown): SourceRef[] {
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
    if (isRec(it['patrimoine_composition'])) {
      const composition: Record<string, number> = {};
      for (const [key, value] of Object.entries(it['patrimoine_composition'])) {
        const share = num(value);
        if (share !== null) composition[key] = share;
      }
      item.patrimoine_composition = composition;
    }
    const compositionStatus = str(it['patrimoine_composition_status']);
    if (compositionStatus) item.patrimoine_composition_status = compositionStatus;
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
export function resolveRef(ref: unknown, files: Readonly<Record<string, unknown>>): unknown {
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
export function rawElectionRefs(v: unknown): { id: string | null; ref: unknown }[] {
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

/** Lit methods.<id>.axes ; null s'il manque un libellé ou une extrémité. */
export function asMethodAxes(v: unknown): MethodAxes | null {
  const x = rec(rec(v)['x']);
  const y = rec(rec(v)['y']);
  const xLabel = str(x['label']);
  const yLabel = str(y['label']);
  const xLow = str(x['low']);
  const xHigh = str(x['high']);
  const yLow = str(y['low']);
  const yHigh = str(y['high']);
  if (!xLabel || !yLabel || !xLow || !xHigh || !yLow || !yHigh) return null;
  return { xLabel, yLabel, ends: { xLow, xHigh, yLow, yHigh } };
}
