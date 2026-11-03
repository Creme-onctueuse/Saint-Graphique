/**
 * Carte « Le saviez-vous ? » : un constat à la fois, calculé sur les données (core/facts.ts).
 *
 * La carte ne doit pas cacher de données. Elle se pose dans le coin haut gauche, le plus souvent vide,
 * puis dans le coin haut droit ; si des repères occupent les deux, elle se réduit à un bouton. Sur
 * téléphone, elle est réduite d'emblée : elle s'ouvre à la demande, par-dessus la carte.
 *
 * Elle s'efface aussi quand on explore : une sélection, un panneau ouvert, d'autres axes, les anneaux
 * ou la projection 2027 la réduisent à son bouton, sauf si elle a elle-même mené à cette sélection ou si la personne la rouvre.
 *
 * Fermée, elle ne revient pas de la session (sessionStorage, hors de l'URL : ce n'est pas un état
 * que l'on partage).
 */
import './facts.css';
import type { SaintChart } from '../../chart/chart.ts';
import { computeFacts, type Fact } from '../../core/facts.ts';
import type { AppState } from '../../core/state.ts';
import { PROJECTION_ID } from '../../core/types.ts';
import type { Dataset } from '../../data/dataset.ts';
import type { ResolvedView } from '../../view.ts';
import type { AppActions, Feature } from '../actions.ts';
import { el } from '../dom.ts';
import { icon } from '../icons.ts';
import { shortPublisher } from '../sources.ts';

const DISMISS_KEY = 'sg-fact-dismissed';
const PHONE_WIDTH = 720;
/** Délai après le dernier rendu : les repères ont fini de glisser quand on mesure (ms). */
const SETTLE_MS = 700;
const SLOTS = ['tl', 'tr'] as const;
type Slot = (typeof SLOTS)[number];

/** Repères et éléments d'interface que la carte ne doit pas recouvrir. */
const OBSTACLES =
  '.sg-pcs:not(.sg-dim), .sg-cand:not(.sg-dim), .sg-label:not([opacity="0"]):not(.sg-dim), #sg-panel:not([hidden]), #sg-inspector:not([hidden]), #sg-projection:not([hidden]), #sg-rings-key:not([hidden]), #sg-lens-banner:not([hidden]), .sg-mapctl, #sg-keybar, .sg-minimap';

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export class FactCard implements Feature {
  private readonly host: HTMLElement;
  private readonly ds: Dataset;
  private readonly actions: AppActions;
  private readonly chart: SaintChart;
  private readonly text = el('p', { class: 'sg-fact__text' });
  private readonly caveat = el('p', { class: 'sg-fact__caveat' });
  private readonly scope = el('p', { class: 'sg-fact__scope' });
  private readonly nextButton: HTMLButtonElement;
  private readonly card: HTMLDivElement;
  private readonly pill: HTMLButtonElement;
  private facts: Fact[] = [];
  private factsKey = '';
  private index = 0;
  private dismissed = readDismissed();
  /** La personne a ouvert la carte : elle reste ouverte, même au-dessus de repères. */
  private opened = false;
  private blocked = false;
  private settleTimer: number | undefined;
  private placed = false;
  private hiddenCandidates: readonly string[] = [];
  /** On explore autre chose : la carte se réduit à son bouton. */
  private exploring = false;
  private ringsShown = false;
  /** Repère mis en avant par « Voir sur la carte » : il ne compte pas comme une exploration. */
  private shownKey: string | null = null;
  private lastSelected: string | null = null;

  constructor(host: HTMLElement, ds: Dataset, actions: AppActions, chart: SaintChart) {
    this.host = host;
    this.ds = ds;
    this.actions = actions;
    this.chart = chart;

    const close = el(
      'button',
      {
        class: 'sg-iconbtn sg-fact__close',
        attrs: { type: 'button', 'aria-label': 'Fermer', title: 'Fermer', id: 'sg-fact-close' },
      },
      icon('close'),
    );
    close.addEventListener('click', () => this.dismiss());

    this.nextButton = el(
      'button',
      { class: 'sg-btn sg-fact__btn', attrs: { type: 'button', id: 'sg-fact-next' } },
      icon('shuffle'),
      'Une autre',
    );
    this.nextButton.addEventListener('click', () => this.next());

    const show = el(
      'button',
      { class: 'sg-btn sg-fact__btn', attrs: { type: 'button', id: 'sg-fact-show' } },
      icon('target'),
      'Voir sur la carte',
    );
    show.addEventListener('click', () => this.showOnMap());

    this.card = el(
      'div',
      { class: 'sg-fact__card' },
      el(
        'div',
        { class: 'sg-fact__head' },
        el('span', { class: 'sg-fact__icon' }, icon('idea')),
        el('h2', { class: 'sg-fact__title', text: 'Le saviez-vous ?' }),
        close,
      ),
      this.text,
      this.caveat,
      this.scope,
      el('div', { class: 'sg-fact__actions' }, this.nextButton, show),
    );

    this.pill = el(
      'button',
      {
        class: 'sg-fact__pill',
        attrs: { type: 'button', id: 'sg-fact-open', 'aria-label': 'Le saviez-vous ?' },
      },
      icon('idea'),
      el('span', { text: 'Le saviez-vous ?' }),
    );
    this.pill.addEventListener('click', () => {
      this.opened = true;
      this.place();
    });

    host.append(this.card, this.pill);
    chart.onRender(() => this.schedulePlace());
    window.addEventListener('resize', () => this.schedulePlace());
  }

  sync(view: ResolvedView, state: AppState): void {
    // Avec des poids modifiés, les positions ne sont plus celles sur lesquelles le constat a été établi.
    const key = `${view.method.id}|${view.customized}`;
    if (key !== this.factsKey) {
      this.factsKey = key;
      const all = computeFacts(this.ds, view.method.id);
      this.facts = view.customized ? all.filter((f) => !f.usesPositions) : all;
      this.index = 0;
      this.renderFact();
    }
    // Pendant le jeu, un constat pourrait donner la réponse.
    this.blocked = state.panel === 'game';
    this.hiddenCandidates = state.hiddenCandidates;
    this.ringsShown = state.showRings;
    if (state.selected !== this.lastSelected) {
      this.lastSelected = state.selected;
      if (state.selected !== this.shownKey) this.opened = false;
    }
    const selectedElsewhere = state.selected !== null && state.selected !== this.shownKey;
    const wasExploring = this.exploring;
    this.exploring =
      view.electionId === PROJECTION_ID ||
      state.showRings ||
      state.panel !== null ||
      (view.crossing?.mode ?? 'map') !== 'map' ||
      selectedElsewhere;
    if (!this.updatePresence()) return;
    if (this.placed && this.exploring !== wasExploring) {
      // Se réduire tout de suite : attendre la fin du glissement laisserait la carte sur les repères.
      this.place();
    } else if (this.placed) {
      this.schedulePlace();
    } else {
      this.placed = true;
      this.place();
    }
  }

  private renderFact(): void {
    const fact = this.facts[this.index % Math.max(1, this.facts.length)];
    if (!fact) return;
    this.text.textContent = fact.text;
    this.caveat.textContent = fact.caveat;
    this.scope.textContent = this.scopeText(fact);
    this.host.dataset['fact'] = fact.id;
    this.nextButton.hidden = this.facts.length < 2;
  }

  private scopeText(fact: Fact): string {
    const count = fact.scope.elections.length;
    const elections =
      count === 1
        ? (this.ds.elections.find((e) => e.id === fact.scope.elections[0])?.label ?? '')
        : `${count} scrutins`;
    const publishers = new Set(
      fact.scope.elections.flatMap((id) =>
        (this.ds.rawElections.get(id)?.sources.slice(0, 1) ?? []).flatMap((s) =>
          s.publisher ? [shortPublisher(s.publisher)] : [],
        ),
      ),
    );
    return [elections, [...publishers].join(', ')].filter(Boolean).join(' · ');
  }

  private next(): void {
    if (this.facts.length === 0) return;
    this.index = (this.index + 1) % this.facts.length;
    this.renderFact();
    this.place();
  }

  private showOnMap(): void {
    const fact = this.facts[this.index];
    if (!fact) return;
    const { election, selected, compared, box } = fact.target;
    this.shownKey = selected;
    const keys = [selected, compared].filter((k): k is string => k !== null);
    this.actions.patch(
      {
        election,
        selected,
        compared,
        layout: 'map',
        // Les repères du constat doivent être affichés, même si on les avait masqués.
        hiddenCandidates: this.hiddenCandidates.filter((id) => !keys.includes(`c:${id}`)),
      },
      'normal',
    );
    if (box) this.chart.fitTo(box);
  }

  private dismiss(): void {
    this.dismissed = true;
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Sans stockage, la carte reviendra à la prochaine visite.
    }
    this.place();
  }

  /** Mesure seulement une fois les repères arrivés : en plein glissement, le résultat serait faux. */
  private schedulePlace(): void {
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.place(), SETTLE_MS);
  }

  /** Affiche ou masque la carte ; faux si elle n'a pas à s'afficher. */
  private updatePresence(): boolean {
    const absent = this.dismissed || this.blocked || this.facts.length === 0;
    this.host.hidden = absent;
    return !absent;
  }

  private covers(): boolean {
    const box = this.card.getBoundingClientRect();
    for (const node of document.querySelectorAll(OBSTACLES)) {
      if (overlaps(box, node.getBoundingClientRect())) return true;
    }
    return false;
  }

  private setSlot(slot: Slot): void {
    this.host.classList.toggle('sg-fact--tl', slot === 'tl');
    this.host.classList.toggle('sg-fact--tr', slot === 'tr');
  }

  /** Choisit l'emplacement : le premier coin libre, sinon le bouton réduit. */
  private place(): void {
    if (!this.updatePresence()) return;

    const phone = window.innerWidth < PHONE_WIDTH;
    this.host.classList.toggle('sg-fact--phone', phone);
    if (phone) {
      this.setCompact(!this.opened);
      this.setSlot('tl');
      return;
    }
    if (this.exploring && !this.opened) {
      // Les anneaux ont leur légende dans le coin haut gauche : le bouton passe de l'autre côté.
      this.setSlot(this.ringsShown ? 'tr' : 'tl');
      this.setCompact(true);
      return;
    }
    this.setCompact(false);
    let free: Slot | null = null;
    for (const slot of SLOTS) {
      this.setSlot(slot);
      if (!this.covers()) {
        free = slot;
        break;
      }
    }
    if (free) {
      this.setSlot(free);
      return;
    }
    this.setSlot('tl');
    this.setCompact(!this.opened);
  }

  private setCompact(compact: boolean): void {
    this.host.classList.toggle('sg-fact--compact', compact);
    this.card.hidden = compact;
    this.pill.hidden = !compact;
  }
}
