/**
 * Infobulle HTML accessible : role="tooltip", reliée au repère survolé ou focalisé par
 * aria-describedby, masquée par Échap. Contenu construit en DOM (jamais d'innerHTML).
 */

export interface TooltipContent {
  title: string;
  subtitle?: string;
  rows: [string, string][];
  /** Mini-barres (ex. composition d'un électorat). */
  bars?: { label: string; value: number; display: string }[];
  barsTitle?: string;
}

/** Rectangle du repère, en coordonnées de l'élément hôte. */
export interface AnchorBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

let counter = 0;

export class Tooltip {
  readonly el: HTMLDivElement;
  private readonly host: HTMLElement;
  private owner: Element | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    this.el = document.createElement('div');
    this.el.className = 'sg-tooltip';
    this.el.id = `sg-tooltip-${++counter}`;
    this.el.setAttribute('role', 'tooltip');
    this.el.hidden = true;
    host.append(this.el);
  }

  /** Affiche le contenu à côté du repère `anchor`. */
  show(content: TooltipContent, anchor: AnchorBox, owner: Element): void {
    this.render(content);
    if (this.owner && this.owner !== owner) this.owner.removeAttribute('aria-describedby');
    this.owner = owner;
    owner.setAttribute('aria-describedby', this.el.id);
    this.el.hidden = false;
    this.position(anchor);
  }

  hide(): void {
    this.el.hidden = true;
    this.owner?.removeAttribute('aria-describedby');
    this.owner = null;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  get currentOwner(): Element | null {
    return this.owner;
  }

  private render(c: TooltipContent): void {
    const title = document.createElement('p');
    title.className = 'sg-tooltip__title';
    title.textContent = c.title;
    const nodes: Node[] = [title];
    if (c.subtitle) {
      const sub = document.createElement('p');
      sub.className = 'sg-tooltip__subtitle';
      sub.textContent = c.subtitle;
      nodes.push(sub);
    }
    if (c.rows.length > 0) {
      const dl = document.createElement('dl');
      dl.className = 'sg-tooltip__rows';
      for (const [k, v] of c.rows) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        dl.append(dt, dd);
      }
      nodes.push(dl);
    }
    if (c.bars && c.bars.length > 0) {
      if (c.barsTitle) {
        const bt = document.createElement('p');
        bt.className = 'sg-tooltip__section';
        bt.textContent = c.barsTitle;
        nodes.push(bt);
      }
      const list = document.createElement('ul');
      list.className = 'sg-tooltip__bars';
      const max = Math.max(...c.bars.map((b) => b.value), 1e-9);
      for (const b of c.bars) {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.className = 'sg-tooltip__bar-label';
        label.textContent = b.label;
        const track = document.createElement('span');
        track.className = 'sg-tooltip__bar-track';
        const fill = document.createElement('span');
        fill.className = 'sg-tooltip__bar-fill';
        fill.style.width = `${Math.max(2, (100 * b.value) / max)}%`;
        track.append(fill);
        const value = document.createElement('span');
        value.className = 'sg-tooltip__bar-value';
        value.textContent = b.display;
        li.append(label, track, value);
        list.append(li);
      }
      nodes.push(list);
    }
    this.el.replaceChildren(...nodes);
  }

  private position(a: AnchorBox): void {
    const gap = 10;
    const hostW = this.host.clientWidth;
    const hostH = this.host.clientHeight;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let left = a.right + gap;
    if (left + w > hostW - 4) left = a.left - gap - w;
    if (left < 4) left = Math.max(4, Math.min(hostW - w - 4, (a.left + a.right) / 2 - w / 2));
    let top = (a.top + a.bottom) / 2 - h / 2;
    if (left === Math.max(4, Math.min(hostW - w - 4, (a.left + a.right) / 2 - w / 2))) {
      // Pas de place sur les côtés : au-dessus ou au-dessous du repère.
      top = a.top - gap - h >= 4 ? a.top - gap - h : a.bottom + gap;
    }
    top = Math.max(4, Math.min(top, Math.max(4, hostH - h - 4)));
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }
}
