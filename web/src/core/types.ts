/**
 * Types partagés : contrats de données (voir schemas/*.schema.json à la racine du dépôt)
 * et petites structures géométriques. Aucun code exécutable hormis des constantes.
 */

/** Clés de diplôme de schemas/pcs.schema.json, du plus élevé au plus faible (ordre fixe). */
export const DIPLOMA_KEYS = [
  'bac5',
  'bac3',
  'bac2',
  'bac',
  'cap',
  'brevet',
  'certif_aucun',
] as const;
export type DiplomaKey = (typeof DIPLOMA_KEYS)[number];
/** Répartition (%) du plus haut diplôme. */
export type DiplomaShares = Record<DiplomaKey, number>;
/** Poids appliqués à chaque part de diplôme pour le score Y. */
export type DiplomaWeights = Record<DiplomaKey, number>;

export interface Point {
  x: number;
  y: number;
}

/** Bornes [min, max] d'un axe. */
export type Range = readonly [number, number];

/** schemas/source.schema.json */
export interface SourceRef {
  id: string;
  title: string;
  url: string;
  accessed: string;
  publisher?: string;
  license?: string;
  notes?: string;
}

/** Un item de data/pcs.json (schemas/pcs.schema.json). */
export interface RawPcsItem {
  code: string;
  /** PCS de niveau 1 ("1" à "8"). */
  group: string;
  /** Effectif France entière (personnes). */
  population: number;
  niveau_vie_mensuel_eur: number;
  patrimoine_keur: number;
  diplomes: DiplomaShares;
  /** Statut de la valeur : published, imputed ou calculated (schemas/pcs.schema.json). */
  niveau_vie_status?: string;
  patrimoine_status?: string;
  source_refs?: string[];
  notes?: string;
}

/** data/pcs.json */
export interface RawPcsData {
  nomenclature: string;
  reference_year: number;
  sources: SourceRef[];
  items: RawPcsItem[];
}

export interface RawCandidate {
  id: string;
  label: string;
  color: string;
  national_share_pct?: number;
  is_abstention?: boolean;
}

/** composition[candidat][code PCS] = part (%) de l'électorat du candidat issue de cette PCS. */
export type Composition = Record<string, Record<string, number>>;

/** data/elections/<id>.json (schemas/election.schema.json). */
export interface RawElection {
  id: string;
  type: string;
  year: number;
  round?: number;
  label: string;
  pcs_level: 1 | 2;
  sources: SourceRef[];
  margin_pts?: number;
  candidates: RawCandidate[];
  composition: Composition;
}

/** Ellipse de confiance à 95 % : demi-axes en unités du graphique, angle en degrés (sens trigonométrique, Y vers le haut). */
export interface Ellipse {
  rx: number;
  ry: number;
  angle_deg: number;
}

export interface ComputedPcs {
  code: string;
  group: string;
  label: string;
  /** Libellé court (champ facultatif ajouté par pipeline/build.py). */
  short?: string;
  x: number;
  y: number;
  /** Part de la population (%). */
  weight: number;
  /** Provenance propre à ce point (positions lues). */
  note?: string;
}

export interface ComputedCandidate {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  national_share_pct?: number;
  is_abstention?: boolean;
  ellipse?: Ellipse;
}

export interface ComputedAxes {
  x_label: string;
  y_label: string;
  range: [number, number];
}

/** data/computed/<method>/<election_id>.json (schemas/computed.schema.json). */
export interface ComputedFile {
  method: string;
  params: Record<string, unknown>;
  election_id: string;
  generated_at?: string;
  axes: ComputedAxes;
  pcs: ComputedPcs[];
  candidates: ComputedCandidate[];
  population_barycenter: Point;
  /** Sources propres à la méthode (positions lues). */
  sources?: SourceRef[];
}

/** Identifiant réservé aux fichiers sans électorat (population seule). */
export const POPULATION_ID = 'population';

/** Identifiant réservé à la projection 2027 : une étape de la frise, pas une élection. */
export const PROJECTION_ID = 'projection_2027';
