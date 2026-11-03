/**
 * Accès au clavier : un seul repère par groupe est atteignable par Tab (tabindex itinérant), et les
 * flèches parcourent le groupe de gauche à droite.
 */
import type { Point } from '../core/types.ts';
import type { G } from './motion.ts';
import { clamp } from './shapes.ts';
import type { ChartCandidate, ChartPcs } from './types.ts';

export class PointFocus {
  /** Éléments des repères affichés, par clé. */
  readonly elements = new Map<string, SVGElement>();
  private readonly root: G;
  private pcsOrder: string[] = [];
  private candOrder: string[] = [];
  private focused: string | null = null;

  constructor(root: G) {
    this.root = root;
  }

  /** Relève les repères après un rendu. */
  refresh(pcs: readonly ChartPcs[], cands: readonly ChartCandidate[]): void {
    this.elements.clear();
    this.root.selectAll<SVGElement, unknown>('.sg-point').each((_d, i, nodes) => {
      const el = nodes[i];
      const key = el?.getAttribute('data-key');
      if (el && key && !el.classList.contains('sg-exiting')) this.elements.set(key, el);
    });
    const byXY = (a: Point, b: Point): number => a.x - b.x || b.y - a.y;
    this.pcsOrder = [...pcs].sort(byXY).map((p) => `p:${p.code}`);
    this.candOrder = [...cands].sort(byXY).map((c) => `c:${c.id}`);
    this.applyRoving();
  }

  setFocused(key: string): void {
    this.focused = key;
    this.applyRoving();
  }

  onKey(event: KeyboardEvent, key: string): void {
    const order = key.startsWith('p:') ? this.pcsOrder : key.startsWith('c:') ? this.candOrder : [];
    const i = order.indexOf(key);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = i + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = i - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = order.length - 1;
        break;
      default:
        return;
    }
    if (order.length === 0) return;
    event.preventDefault();
    const target = order[clamp(next, 0, order.length - 1)];
    if (target) this.elements.get(target)?.focus();
  }

  private applyRoving(): void {
    for (const order of [this.pcsOrder, this.candOrder]) {
      const current = this.focused && order.includes(this.focused) ? this.focused : order[0];
      for (const key of order) {
        this.elements.get(key)?.setAttribute('tabindex', key === current ? '0' : '-1');
      }
    }
  }
}
