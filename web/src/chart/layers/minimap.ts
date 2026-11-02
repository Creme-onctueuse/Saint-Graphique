/**
 * Mini-carte : la carte entière et la partie visible, affichée dès que l'on a zoomé. Un clic y
 * recentre la vue. Hors du SVG principal : elle ne figure pas dans les exports.
 */
import type { ChartModel, SaintChart } from '../chart.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 160;
const HEIGHT = 96;

export class Minimap {
  private readonly chart: SaintChart;
  private readonly root: SVGSVGElement;
  private readonly dots: SVGGElement;
  private readonly frame: SVGRectElement;
  private modelKey: ChartModel | null = null;

  constructor(chart: SaintChart, host: HTMLElement) {
    this.chart = chart;
    this.root = document.createElementNS(SVG_NS, 'svg');
    this.root.setAttribute('class', 'sg-minimap');
    this.root.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
    this.root.setAttribute('role', 'img');
    this.root.setAttribute('aria-label', 'Mini-carte : partie visible de la carte');
    this.dots = document.createElementNS(SVG_NS, 'g');
    this.frame = document.createElementNS(SVG_NS, 'rect');
    this.frame.setAttribute('class', 'sg-minimap__frame');
    this.root.append(this.dots, this.frame);
    this.root.style.display = 'none';
    host.append(this.root);

    this.root.addEventListener('click', (e) => {
      const box = this.root.getBoundingClientRect();
      const { lo, span } = this.domain();
      chart.panTo({
        x: lo + ((e.clientX - box.left) / box.width) * span,
        y: lo + span - ((e.clientY - box.top) / box.height) * span,
      });
    });
    chart.onRender(() => this.render());
  }

  private domain(): { lo: number; span: number } {
    const [lo, hi] = this.chart.base().x.domain() as [number, number];
    return { lo, span: hi - lo };
  }

  private render(): void {
    const zoomed = this.chart.zoomLevel > 1.01;
    this.root.style.display = zoomed ? '' : 'none';
    if (!zoomed) return;
    const { lo, span } = this.domain();
    const px = (v: number): number => ((v - lo) / span) * WIDTH;
    const py = (v: number): number => HEIGHT - ((v - lo) / span) * HEIGHT;
    const model = this.chart.currentModel;
    if (model && model !== this.modelKey) {
      this.modelKey = model;
      this.dots.replaceChildren(
        ...model.pcs.map((p) => {
          const c = document.createElementNS(SVG_NS, 'circle');
          c.setAttribute('cx', String(px(p.x)));
          c.setAttribute('cy', String(py(p.y)));
          c.setAttribute('r', String(Math.max(1, Math.sqrt(p.weight) * 0.9)));
          c.style.fill = `var(--sg-group-${p.group}, ${p.color})`;
          return c;
        }),
      );
    }
    const { x, y } = this.chart.scales();
    const { width, height } = this.chart.geometry;
    const x0 = px(x.invert(0));
    const x1 = px(x.invert(width));
    const y0 = py(y.invert(0));
    const y1 = py(y.invert(height));
    this.frame.setAttribute('x', String(x0));
    this.frame.setAttribute('y', String(y0));
    this.frame.setAttribute('width', String(Math.max(2, x1 - x0)));
    this.frame.setAttribute('height', String(Math.max(2, y1 - y0)));
  }
}
