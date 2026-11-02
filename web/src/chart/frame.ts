/**
 * Décor de la carte : fond et quadrants, grille, diagonale, axes, noms des quadrants. Le fond et la
 * grille débordent de la zone de tracé jusqu'aux bords de la fenêtre, comme sur une carte.
 */
import type { Selection } from 'd3-selection';
import { formatNumber } from '../core/format.ts';
import type { ChartGeometry, Scale } from './geometry.ts';
import { clamp } from './shapes.ts';
import { CHART_STYLE, CHART_TEXT } from './style.ts';

type G = Selection<SVGGElement, unknown, null, undefined>;

export interface FrameLayers {
  bg: Selection<SVGRectElement, unknown, null, undefined>;
  quads: G;
  grid: G;
  diagonal: Selection<SVGLineElement, unknown, null, undefined>;
  axes: G;
  regions: G;
}

interface Quadrant {
  k: 'tl' | 'tr' | 'bl' | 'br';
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Tick {
  key: string;
  value: number;
  pos: number;
  text: string;
}

function tickDigits(ticks: readonly number[]): number {
  if (ticks.length < 2) return 0;
  const step = Math.abs((ticks[1] ?? 0) - (ticks[0] ?? 0));
  return step >= 1 || step === 0 ? 0 : Math.ceil(-Math.log10(step) - 1e-9);
}

function toTicks(values: readonly number[], scale: Scale): Tick[] {
  const digits = tickDigits(values);
  return values.map((v) => ({
    key: String(v),
    value: v,
    pos: scale(v),
    text: formatNumber(v, digits),
  }));
}

export function drawFrame(
  layers: FrameLayers,
  geom: ChartGeometry,
  x: Scale,
  y: Scale,
  model: { xLabel: string; yLabel: string; range: [number, number] },
  showRegions: boolean,
): void {
  const { width, height, plot, small } = geom;
  layers.bg.attr('width', width).attr('height', height);

  const cx = clamp(x(0), 0, width);
  const cy = clamp(y(0), 0, height);
  const quads: Quadrant[] = [
    { k: 'tl', x: 0, y: 0, w: cx, h: cy },
    { k: 'tr', x: cx, y: 0, w: width - cx, h: cy },
    { k: 'bl', x: 0, y: cy, w: cx, h: height - cy },
    { k: 'br', x: cx, y: cy, w: width - cx, h: height - cy },
  ];
  layers.quads
    .selectAll<SVGRectElement, Quadrant>('rect')
    .data(quads, (d) => d.k)
    .join('rect')
    .attr('class', (d) => `sg-quadrant sg-quadrant--${d.k}`)
    .attr('x', (d) => d.x)
    .attr('y', (d) => d.y)
    .attr('width', (d) => Math.max(0, d.w))
    .attr('height', (d) => Math.max(0, d.h));

  const count = small ? 4 : CHART_STYLE.ticks;
  const xt = toTicks(x.ticks(count), x);
  const yt = toTicks(y.ticks(count), y);

  layers.grid
    .selectAll<SVGLineElement, Tick>('line.sg-grid-x')
    .data(xt, (d) => d.key)
    .join('line')
    .attr('class', (d) => (d.value === 0 ? 'sg-grid-x sg-zero' : 'sg-grid-x'))
    .attr('x1', (d) => d.pos)
    .attr('x2', (d) => d.pos)
    .attr('y1', 0)
    .attr('y2', height);
  layers.grid
    .selectAll<SVGLineElement, Tick>('line.sg-grid-y')
    .data(yt, (d) => d.key)
    .join('line')
    .attr('class', (d) => (d.value === 0 ? 'sg-grid-y sg-zero' : 'sg-grid-y'))
    .attr('x1', 0)
    .attr('x2', width)
    .attr('y1', (d) => d.pos)
    .attr('y2', (d) => d.pos);

  const [lo, hi] = model.range;
  layers.diagonal.attr('x1', x(lo)).attr('y1', y(lo)).attr('x2', x(hi)).attr('y2', y(hi));

  // Graduations et titres des axes, dans la bande réservée sous la zone de tracé et à sa gauche.
  const bottom = plot.y + plot.h;
  const inX = (p: number): boolean => p >= plot.x - 0.5 && p <= plot.x + plot.w + 0.5;
  const inY = (p: number): boolean => p >= plot.y - 0.5 && p <= bottom + 0.5;
  layers.axes
    .selectAll<SVGTextElement, Tick>('text.sg-tick-x')
    .data(
      xt.filter((t) => inX(t.pos)),
      (d) => d.key,
    )
    .join('text')
    .attr('class', 'sg-tick sg-tick-x')
    .attr('x', (d) => d.pos)
    .attr('y', bottom + 13)
    .attr('text-anchor', 'middle')
    .text((d) => d.text);
  layers.axes
    .selectAll<SVGTextElement, Tick>('text.sg-tick-y')
    .data(
      yt.filter((t) => inY(t.pos)),
      (d) => d.key,
    )
    .join('text')
    .attr('class', 'sg-tick sg-tick-y')
    .attr('x', plot.x - 6)
    .attr('y', (d) => d.pos)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'end')
    .text((d) => d.text);

  const titleY = bottom + (small ? 24 : 27);
  const yTitleX = plot.x - (small ? 20 : 28);
  const titles = [
    {
      key: 'x',
      cls: 'sg-axis-title',
      x: plot.x + plot.w / 2,
      y: titleY,
      rotate: 0,
      anchor: 'middle',
      text: model.xLabel,
    },
    {
      key: 'x-lo',
      cls: 'sg-axis-end',
      x: plot.x,
      y: titleY,
      rotate: 0,
      anchor: 'start',
      text: `← ${CHART_TEXT.xLow}`,
    },
    {
      key: 'x-hi',
      cls: 'sg-axis-end',
      x: plot.x + plot.w,
      y: titleY,
      rotate: 0,
      anchor: 'end',
      text: `${CHART_TEXT.xHigh} →`,
    },
    {
      key: 'y',
      cls: 'sg-axis-title',
      x: yTitleX,
      y: plot.y + plot.h / 2,
      rotate: -90,
      anchor: 'middle',
      text: model.yLabel,
    },
    {
      key: 'y-lo',
      cls: 'sg-axis-end',
      x: yTitleX,
      y: bottom,
      rotate: -90,
      anchor: 'start',
      text: `← ${CHART_TEXT.yLow}`,
    },
    {
      key: 'y-hi',
      cls: 'sg-axis-end',
      x: yTitleX,
      y: plot.y,
      rotate: -90,
      anchor: 'end',
      text: `${CHART_TEXT.yHigh} →`,
    },
  ];
  layers.axes
    .selectAll<SVGTextElement, (typeof titles)[number]>('text.sg-axis-label')
    .data(titles, (d) => d.key)
    .join('text')
    .attr('class', (d) => `sg-axis-label ${d.cls}`)
    .attr('text-anchor', (d) => d.anchor)
    .attr('transform', (d) => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
    .attr('dy', (d) => (d.rotate === 0 ? '0' : '0.35em'))
    .text((d) => d.text);

  // Noms discrets des quatre régions, fixes à l'écran. Masqués sur téléphone, faute de place.
  const pad = 14;
  const right = plot.x + plot.w - pad;
  // En bas à droite, le nom laisse la place aux boutons de la carte.
  const rightBottom = right - CHART_STYLE.mapControlsGutter;
  const regions =
    showRegions && !small
      ? [
          {
            key: 'tl',
            x: plot.x + pad,
            y: plot.y + 22,
            anchor: 'start',
            text: 'Travail · dominant',
          },
          { key: 'tr', x: right, y: plot.y + 22, anchor: 'end', text: 'Capital · dominant' },
          {
            key: 'bl',
            x: plot.x + pad,
            y: bottom - pad,
            anchor: 'start',
            text: 'Travail · dominé',
          },
          { key: 'br', x: rightBottom, y: bottom - pad, anchor: 'end', text: 'Capital · dominé' },
        ]
      : [];
  layers.regions
    .selectAll<SVGTextElement, (typeof regions)[number]>('text.sg-region')
    .data(regions, (d) => d.key)
    .join('text')
    .attr('class', 'sg-region')
    .attr('x', (d) => d.x)
    .attr('y', (d) => d.y)
    .attr('text-anchor', (d) => d.anchor)
    .text((d) => d.text);
}
