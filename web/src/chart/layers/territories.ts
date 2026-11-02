/**
 * Territoires : un halo doux autour des catégories de chaque groupe, comme les teintes d'une carte.
 * Dégradés radiaux plutôt que flou : le rendu reste fluide pendant le zoom et s'exporte tel quel.
 * Retraités et autres inactifs en sont exclus : ces catégories s'étalent sur toute la carte, et leur
 * teinte recouvrirait les autres sans rien montrer.
 */
import type { Selection } from 'd3-selection';
import type { Scale } from '../geometry.ts';
import type { ChartPcs } from '../types.ts';

type G = Selection<SVGGElement, unknown, null, undefined>;

const EXCLUDED: ReadonlySet<string> = new Set(['7', '8']);

/** Rayon du halo : celui du disque, plus une fraction de l'unité de la carte. */
const HALO_SPREAD = 0.1;

function gradientId(group: string): string {
  return `sg-halo-${group}`;
}

export function drawTerritories(
  layer: G,
  pcs: readonly ChartPcs[],
  x: Scale,
  y: Scale,
  radius: (p: ChartPcs) => number,
  unit: number,
): void {
  const shown = pcs.filter((p) => !EXCLUDED.has(p.group));
  const groups = [...new Map(shown.map((p) => [p.group, p])).values()];

  let defs = layer.select<SVGDefsElement>('defs');
  if (defs.empty()) defs = layer.append('defs');
  const gradients = defs
    .selectAll<SVGRadialGradientElement, ChartPcs>('radialGradient')
    .data(groups, (d) => d.group)
    .join((enter) => {
      const g = enter.append('radialGradient').attr('id', (d) => gradientId(d.group));
      g.append('stop').attr('offset', '0%').attr('class', 'sg-halo-stop sg-halo-stop--in');
      g.append('stop').attr('offset', '100%').attr('class', 'sg-halo-stop sg-halo-stop--out');
      return g;
    });
  gradients
    .selectAll<SVGStopElement, ChartPcs>('stop')
    .data((d) => [d, d])
    .style('stop-color', (d) => `var(--sg-group-${d.group}, ${d.color})`);

  layer
    .selectAll<SVGCircleElement, ChartPcs>('circle.sg-territory')
    .data(shown, (d) => d.code)
    .join('circle')
    .attr('class', 'sg-territory')
    .attr('cx', (d) => x(d.x))
    .attr('cy', (d) => y(d.y))
    .attr('r', (d) => radius(d) + HALO_SPREAD * unit)
    .style('fill', (d) => `url(#${gradientId(d.group)})`);
}
