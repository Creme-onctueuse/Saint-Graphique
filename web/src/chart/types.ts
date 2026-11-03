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
  /** Couleur imposée (variable de couleur) ; sinon, celle du groupe. */
  fill?: string;
}

export interface ChartCandidate {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  /** Score national (%), ou null s'il est inconnu. */
  share: number | null;
  /** Part des inscrits (%) : l'aire de la bulle, sur la même échelle que les disques. */
  registeredShare?: number | null;
  /** Aire de la bulle (%) quand on la croise avec autre chose (vue depuis un groupe, panneau Croiser). */
  sizeShare?: number | null;
  /** Ce que mesure `sizeShare`, pour l'infobulle. */
  sizeLabel?: string;
  /** Identité d'une élection à l'autre (famille politique) : le repère glisse au lieu de s'effacer. */
  trackKey?: string;
  /** Nom de cette identité, affiché pendant la lecture de la frise. */
  trackLabel?: string;
  /** Opacité pendant la lecture : un électorat sans équivalent apparaît ou s'efface. */
  alpha?: number;
  isAbstention: boolean;
  ellipse: Ellipse | null;
  /** Composition sociale de l'électorat, si les données brutes sont disponibles. */
  composition: { label: string; share: number }[] | null;
  /** Précisions affichées en fin d'infobulle. */
  notes?: string[];
}

/** Quand les axes ne sont pas ceux du Saint-Graphique. */
export interface ChartAxes {
  /** Ni diagonale ni noms de régions. */
  plain?: boolean;
  /** Aucun axe : ni graduation, ni titre, ni grille, ni quadrants. */
  none?: boolean;
  /** Textes des extrémités des axes. */
  ends?: { xLow: string; xHigh: string; yLow: string; yHigh: string };
  /** Position sur la carte → valeur réelle à afficher. */
  text?: { x: (position: number) => string; y: (position: number) => string };
  /** Graduations imposées pour un domaine ; null : à intervalles réguliers. */
  ticks?: {
    x: (domain: readonly number[], count: number) => number[] | null;
    y: (domain: readonly number[], count: number) => number[] | null;
  };
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
  axes?: ChartAxes;
}

export interface ChartView {
  hiddenGroups: ReadonlySet<string>;
  hiddenCandidates: ReadonlySet<string>;
  showLabels: boolean;
  showEllipses: boolean;
  /** Repères mis en avant (clés `p:…` ou `c:…`) ; les autres s'estompent. Null : aucun estompage. */
  focus: ReadonlySet<string> | null;
  /** Repères sélectionnés : leur contour et leur libellé restent visibles. */
  selected: ReadonlySet<string>;
  /** Proportions d'origine : zone de tracé carrée, mêmes échelles sur les deux axes. */
  square: boolean;
}

export type Animation = 'none' | 'fast' | 'normal';
