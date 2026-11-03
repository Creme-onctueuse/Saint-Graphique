/**
 * Cadre de l'application : rail et panneaux, bandeau de fin de page (réserves, sources, crédits),
 * état affiché dans la barre du haut. Le cadre mesure ce qu'il occupe et le communique à la carte,
 * qui glisse pour rester entièrement visible.
 */
import type { Insets } from '../../chart/geometry.ts';
import { PANELS, type AppState, type PanelId } from '../../core/state.ts';
import { shortMethodLabel } from '../../data/dataset.ts';
import type { ResolvedView } from '../../view.ts';
import type { AppActions, Feature } from '../actions.ts';
import { byId, el, PHONE_WIDTH } from '../dom.ts';
import { compactSources, renderSources, shortPublisher } from '../sources.ts';

const PANEL_TITLES: Record<PanelId, string> = {
  electorates: 'Électorats',
  categories: 'Catégories',
  cross: 'Croiser les données',
  game: 'Jeu',
  method: 'Méthode',
  data: 'Données',
};

/** En dessous de cette largeur (px), le rail passe en bas et les panneaux s'ouvrent par le bas. */
const INSET_GAP = 6;

type Drawer = 'reserves' | 'sources' | null;

function isPanel(v: string | undefined): v is PanelId {
  return PANELS.some((p) => p === v);
}

export class Shell implements Feature {
  private readonly actions: AppActions;
  private readonly onInsets: (insets: Insets) => void;
  private readonly top = byId('sg-top');
  private readonly rail = byId('sg-rail');
  private readonly panel = byId('sg-panel');
  private readonly panelTitle = byId('sg-panel-title');
  private readonly inspector = byId('sg-inspector');
  private readonly end = byId('sg-end');
  private readonly keybar = byId('sg-keybar');
  private readonly drawer = byId('sg-drawer');
  private readonly caveatToggle = byId<HTMLButtonElement>('sg-caveat-toggle');
  private readonly sourcesToggle = byId<HTMLButtonElement>('sg-sources-toggle');
  private readonly reserves = byId('sg-reserves');
  private readonly sources = byId('sg-sources');
  private readonly heading = byId('sg-chart-heading');
  private readonly methodChip = byId<HTMLButtonElement>('sg-method-chip');
  private readonly status = byId('sg-status');
  private readonly mapControls = document.querySelector<HTMLElement>('.sg-mapctl');
  private openDrawer: Drawer = null;

  constructor(actions: AppActions, onInsets: (insets: Insets) => void) {
    this.actions = actions;
    this.onInsets = onInsets;

    for (const button of this.rail.querySelectorAll<HTMLButtonElement>('button[data-panel]')) {
      button.addEventListener('click', () => {
        const id = button.dataset['panel'];
        if (isPanel(id)) this.togglePanel(id);
      });
    }
    byId('sg-panel-close').addEventListener('click', () =>
      this.actions.patch({ panel: null }, 'fast'),
    );
    this.methodChip.addEventListener('click', () =>
      this.actions.patch({ panel: 'method' }, 'fast'),
    );
    this.caveatToggle.addEventListener('click', () => this.toggleDrawer('reserves'));
    this.sourcesToggle.addEventListener('click', () => this.toggleDrawer('sources'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.openDrawer) this.toggleDrawer(this.openDrawer);
    });

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.measure());
      for (const node of [this.top, this.rail, this.panel, this.inspector, this.end, this.keybar]) {
        observer.observe(node);
      }
    }
    window.addEventListener('resize', () => this.measure());
  }

  private current: PanelId | null = null;

  private togglePanel(id: PanelId): void {
    this.actions.patch({ panel: this.current === id ? null : id }, 'fast');
  }

  private toggleDrawer(which: Exclude<Drawer, null>): void {
    this.openDrawer = this.openDrawer === which ? null : which;
    this.applyDrawer();
  }

  private applyDrawer(): void {
    this.drawer.hidden = this.openDrawer === null;
    this.reserves.hidden = this.openDrawer !== 'reserves';
    this.sources.hidden = this.openDrawer !== 'sources';
    this.caveatToggle.setAttribute('aria-expanded', String(this.openDrawer === 'reserves'));
    this.sourcesToggle.setAttribute('aria-expanded', String(this.openDrawer === 'sources'));
  }

  sync(view: ResolvedView, state: AppState): void {
    this.current = state.panel;
    for (const button of this.rail.querySelectorAll<HTMLButtonElement>('button[data-panel]')) {
      const active = button.dataset['panel'] === state.panel;
      button.setAttribute('aria-pressed', String(active));
    }
    this.panel.hidden = state.panel === null;
    for (const section of this.panel.querySelectorAll<HTMLElement>('[data-panel-body]')) {
      section.hidden = section.dataset['panelBody'] !== state.panel;
    }
    if (state.panel) this.panelTitle.textContent = PANEL_TITLES[state.panel];

    const pollster = view.rawElection?.sources[0]?.publisher;
    this.heading.replaceChildren(
      view.electionLabel,
      ...(pollster
        ? [
            el('span', {
              class: 'sg-chart-heading__source',
              text: ` · ${shortPublisher(pollster)}`,
            }),
          ]
        : []),
    );
    this.methodChip.textContent = shortMethodLabel(view.method.label);
    this.methodChip.title = `${view.method.label} : changer de méthode`;

    byId('sg-caveat-text').textContent = view.reserveSummary;
    byId('sg-sources-text').textContent = compactSources(view);
    this.reserves.replaceChildren(...view.reserves.map((text) => el('p', { text })));
    renderSources(this.sources, view);
    this.applyDrawer();

    this.status.textContent = view.notes.join(' ');
    this.measure();
  }

  /** Mesure l'espace pris par l'interface et le réserve sur la carte. */
  measure(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const phone = width < PHONE_WIDTH;
    const topRect = this.top.getBoundingClientRect();
    const endRect = this.end.getBoundingClientRect();
    const railRect = this.rail.getBoundingClientRect();
    const panelOpen = !this.panel.hidden;
    const inspectorOpen = !this.inspector.hidden;
    const panelRect = panelOpen ? this.panel.getBoundingClientRect() : null;
    const inspectorRect = inspectorOpen ? this.inspector.getBoundingClientRect() : null;

    // La légende a sa propre ligne, sous la carte : elle ne recouvre aucun repère.
    const keyRect = this.keybar.hidden ? null : this.keybar.getBoundingClientRect();
    let bottom = height - (keyRect && keyRect.height > 0 ? keyRect.top : endRect.top);
    let left = railRect.right;
    let right = 0;
    if (phone) {
      left = 0;
      bottom = height - Math.min(endRect.top, railRect.top);
      if (panelRect) bottom = Math.max(bottom, height - panelRect.top);
      if (inspectorRect) bottom = Math.max(bottom, height - inspectorRect.top);
    } else {
      if (panelRect) left = panelRect.right;
      if (inspectorRect) right = width - inspectorRect.left;
    }
    // Bord du cadre fixe, pour une carte placée à côté de lui ; elle peut ensuite réserver sa place.
    document.documentElement.style.setProperty('--sg-chrome-left', `${Math.round(left)}px`);
    const reserved = document.querySelector<HTMLElement>('[data-sg-reserve]:not([hidden])');
    if (reserved) {
      const rect = reserved.getBoundingClientRect();
      if (phone) bottom = Math.max(bottom, height - rect.top);
      else left = Math.max(left, rect.right);
    }
    const insets: Insets = {
      top: Math.round(topRect.bottom + INSET_GAP),
      right: Math.round(right + INSET_GAP),
      bottom: Math.round(bottom + INSET_GAP),
      left: Math.round(left + INSET_GAP),
    };
    const root = document.documentElement.style;
    root.setProperty('--sg-inset-top', `${insets.top}px`);
    root.setProperty('--sg-inset-right', `${insets.right}px`);
    root.setProperty('--sg-inset-bottom', `${insets.bottom}px`);
    root.setProperty('--sg-inset-left', `${insets.left}px`);
    // Sur grand écran, les boutons de la carte ont leur colonne : ils ne cachent aucun repère.
    const gutter = phone ? 0 : (this.mapControls?.offsetWidth ?? 0) + INSET_GAP;
    this.onInsets({ ...insets, right: insets.right + gutter });
  }
}
