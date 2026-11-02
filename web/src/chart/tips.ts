/** Contenu des infobulles de la carte. Fonctions pures. */
import { formatNumber, formatPct } from '../core/format.ts';
import { formatStatus } from '../core/reserves.ts';
import type { Point } from '../core/types.ts';
import type { TooltipContent } from './tooltip.ts';
import type { ChartCandidate, ChartModel, ChartPcs } from './types.ts';

export function pcsTip(d: ChartPcs, m: ChartModel | null): TooltipContent {
  return {
    title: d.label,
    subtitle: `${d.groupLabel} · code ${d.code}`,
    rows: [
      ['Part de la population', formatPct(d.weight)],
      [m?.xLabel ?? 'x', formatNumber(d.x)],
      [m?.yLabel ?? 'y', formatNumber(d.y)],
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
      [m?.xLabel ?? 'x', formatNumber(d.x)],
      [m?.yLabel ?? 'y', formatNumber(d.y)],
    ],
  };
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
    rows: [
      [m?.xLabel ?? 'x', formatNumber(d.x)],
      [m?.yLabel ?? 'y', formatNumber(d.y)],
    ],
  };
}
