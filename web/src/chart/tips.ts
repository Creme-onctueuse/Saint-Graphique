/** Contenu des infobulles de la carte. Fonctions pures. */
import { formatNumber, formatPct } from '../core/format.ts';
import { formatStatus } from '../core/reserves.ts';
import type { Point } from '../core/types.ts';
import type { TooltipContent } from './tooltip.ts';
import type { ChartCandidate, ChartModel, ChartPcs } from './types.ts';

/** Valeur à afficher pour une position : la valeur réelle si les axes sont libres. */
function axisText(m: ChartModel | null, axis: 'x' | 'y', position: number): string {
  return m?.axes?.text?.[axis](position) ?? formatNumber(position);
}

/** Lignes des coordonnées : aucune sur une carte sans axes. */
function coordinateRows(m: ChartModel | null, d: Point): [string, string][] {
  if (m?.axes?.none) return [];
  return [
    [m?.xLabel ?? 'x', axisText(m, 'x', d.x)],
    [m?.yLabel ?? 'y', axisText(m, 'y', d.y)],
  ];
}

/** Coordonnées en toutes lettres, pour les lecteurs d'écran. */
export function coordinatesText(m: ChartModel | null, d: Point): string {
  return coordinateRows(m, d)
    .map(([label, value]) => `${label} ${value}`)
    .join(', ');
}

export function pcsTip(d: ChartPcs, m: ChartModel | null): TooltipContent {
  return {
    title: d.label,
    subtitle: `${d.groupLabel} · code ${d.code}`,
    rows: [
      ['Part de la population', formatPct(d.weight)],
      ...coordinateRows(m, d),
      ...(d.status
        ? ([
            ['Patrimoine', formatStatus(d.status.patrimoine)],
            ['Niveau de vie', formatStatus(d.status.niveauVie)],
          ] as [string, string][])
        : []),
    ],
    notes: d.notes,
  };
}

export function candTip(
  d: ChartCandidate,
  m: ChartModel | null,
  showEllipses: boolean,
): TooltipContent {
  const content: TooltipContent = {
    title: d.label,
    rows: [
      ...(d.share !== null
        ? [[d.isAbstention ? 'Part des inscrits' : 'Score', formatPct(d.share)] as [string, string]]
        : []),
      ...(d.registeredShare !== undefined && d.registeredShare !== null && !d.isAbstention
        ? [['Part des inscrits', formatPct(d.registeredShare)] as [string, string]]
        : []),
      ...(d.sizeShare !== undefined && d.sizeShare !== null
        ? [[d.sizeLabel ?? 'Vote du groupe', formatPct(d.sizeShare)] as [string, string]]
        : []),
      ...coordinateRows(m, d),
    ],
  };
  if (d.notes) content.notes = d.notes;
  if (d.ellipse && showEllipses) content.subtitle = 'Ellipse : intervalle de confiance à 95 %';
  if (d.composition && d.composition.length > 0) {
    content.barsTitle = 'Composition de l’électorat';
    content.bars = d.composition.map((c) => ({
      label: c.label,
      value: c.share,
      display: formatPct(c.share, 0),
    }));
  }
  return content;
}

export function baryTip(d: Point, m: ChartModel | null): TooltipContent {
  return {
    title: 'Barycentre de la population',
    subtitle: 'Moyenne des PCS pondérée par leurs effectifs',
    rows: coordinateRows(m, d),
  };
}
