/** Modèle affiché par la carte. Aucun code exécutable. */
import type { ValueStatus } from '../core/reserves.ts';
import type { Ellipse, Point } from '../core/types.ts';

export interface ChartPcs {
  code: string;
  group: string;
  label: string;
  short: string;
  groupLabel: string;
  /** Couleur de repli si le thème ne définit pas --sg-group-<groupe>. */
  color: string;
  x: number;
  y: number;
  /** Part de la population (%). */
  weight: number;
  /** Statut des valeurs qui fondent l'axe X ; null si la position n'en dépend pas (position lue). */
  status: { patrimoine: ValueStatus; niveauVie: ValueStatus } | null;
  /** Réserves propres à cette PCS (ex æquo), affichées dans l'infobulle. */
  notes: string[];
}

export interface ChartCandidate {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  /** Score national (%), ou null s'il est inconnu. */
  share: number | null;
  /** Taille du losange (%) quand elle diffère du score (vue depuis un groupe). */
  sizeShare?: number | null;
  isAbstention: boolean;
  ellipse: Ellipse | null;
  /** Composition sociale de l'électorat, si les données brutes sont disponibles. */
  composition: { label: string; share: number }[] | null;
}

export interface ChartModel {
  /** Titre accessible du graphique. */
  title: string;
  description: string;
  xLabel: string;
  yLabel: string;
  range: [number, number];
  pcs: ChartPcs[];
  candidates: ChartCandidate[];
  barycenter: Point | null;
}

export interface ChartView {
  hiddenGroups: ReadonlySet<string>;
  hiddenCandidates: ReadonlySet<string>;
  showLabels: boolean;
  showEllipses: boolean;
  /** Territoires et noms de régions. */
  showTerritories: boolean;
  /** Repères mis en avant (clés `p:…` ou `c:…`) ; les autres s'estompent. Null : aucun estompage. */
  focus: ReadonlySet<string> | null;
  /** Repères sélectionnés : leur contour et leur libellé restent visibles. */
  selected: ReadonlySet<string>;
  /** Proportions d'origine : zone de tracé carrée, mêmes échelles sur les deux axes. */
  square: boolean;
}

export type Animation = 'none' | 'fast' | 'normal';
