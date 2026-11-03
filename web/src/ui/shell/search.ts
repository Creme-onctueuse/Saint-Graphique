/**
 * Champ de recherche de la barre du haut : un métier, une catégorie ou un électorat. Le choix
 * sélectionne le repère, ce qui ouvre son détail. Raccourci : la touche « / ».
 */
import './search.css';
import type { SaintChart } from '../../chart/chart.ts';
import {
  searchItems,
  searchItemsOf,
  type SearchItem,
  type SearchResult,
} from '../../core/search.ts';
import type { AppState } from '../../core/state.ts';
import type { ResolvedView } from '../../view.ts';
import type { AppActions, Feature } from '../actions.ts';
import { el } from '../dom.ts';
import { icon } from '../icons.ts';

export class Search implements Feature {
  private readonly actions: AppActions;
  private readonly chart: SaintChart;
  private readonly input = el('input', {
    class: 'sg-search__input',
    attrs: {
      id: 'sg-search-input',
      type: 'search',
      placeholder: 'Un métier, un candidat…',
      'aria-label': 'Chercher un métier, une catégorie ou un électorat',
      autocomplete: 'off',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-controls': 'sg-search-list',
      'aria-autocomplete': 'list',
    },
  });
  private readonly list = el('ul', {
    class: 'sg-search__list sg-float',
    attrs: { id: 'sg-search-list', role: 'listbox', 'aria-label': 'Résultats' },
  });
  private items: SearchItem[] = [];
  private results: SearchResult[] = [];
  private active = 0;

  constructor(host: HTMLElement, actions: AppActions, chart: SaintChart) {
    this.actions = actions;
    this.chart = chart;
    this.list.hidden = true;
    host.append(
      el('span', { class: 'sg-search__icon sg-icon' }, icon('search')),
      this.input,
      this.list,
    );

    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('focus', () => this.update());
    this.input.addEventListener('blur', () => {
      // Laisse au clic sur un résultat le temps d'arriver.
      window.setTimeout(() => this.close(), 150);
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, select, textarea, dialog')) return;
      e.preventDefault();
      this.input.focus();
      this.input.select();
    });
  }

  sync(view: ResolvedView, _state: AppState): void {
    this.items = searchItemsOf(view.model);
    if (document.activeElement === this.input) this.update();
  }

  private update(): void {
    this.results = searchItems(this.items, this.input.value);
    this.active = 0;
    this.render();
  }

  private close(): void {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }

  private render(): void {
    const query = this.input.value.trim();
    if (query === '') {
      this.close();
      return;
    }
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    if (this.results.length === 0) {
      this.list.replaceChildren(
        el('li', { class: 'sg-search__empty', text: 'Rien de tel sur cette carte.' }),
      );
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    this.list.replaceChildren(
      ...this.results.map((r, i) => {
        const option = el(
          'li',
          {
            class: 'sg-search__item',
            attrs: {
              id: `sg-search-option-${i}`,
              role: 'option',
              'aria-selected': String(i === this.active),
              'data-key': r.key,
            },
          },
          el('span', { class: 'sg-search__label', text: r.label }),
          el('span', {
            class: 'sg-search__detail',
            text: r.matched ? `« ${r.matched} » · ${r.detail}` : r.detail,
          }),
        );
        // Avant la perte du focus : sinon le clic arriverait sur une liste déjà fermée.
        option.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.choose(r);
        });
        return option;
      }),
    );
    this.input.setAttribute('aria-activedescendant', `sg-search-option-${this.active}`);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.input.value = '';
      this.close();
      this.input.blur();
      return;
    }
    if (this.results.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      this.active = (this.active + step + this.results.length) % this.results.length;
      this.render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = this.results[this.active];
      if (result) this.choose(result);
    }
  }

  private choose(result: SearchResult): void {
    this.input.value = '';
    this.close();
    this.input.blur();
    this.actions.patch({ selected: result.key, compared: null }, 'normal');
    if (this.chart.zoomLevel > 1.01) this.chart.panTo({ x: result.x, y: result.y });
  }
}
