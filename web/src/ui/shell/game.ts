/**
 * Mini-jeu « Qui est-ce ? » : un électorat est entouré sur la carte, sa composition s'affiche sans son
 * nom, et il faut le retrouver parmi trois noms. Le score reste en mémoire, le temps de la visite.
 *
 * Pendant une manche, tout ce qui donnerait la réponse est coupé : libellés, infobulles et sélection
 * (l'inspecteur afficherait le nom). La réponse révèle les libellés.
 */
import './facts.css';
import type { SaintChart } from '../../chart/chart.ts';
import { CHART_STYLE } from '../../chart/style.ts';
import { formatPct } from '../../core/format.ts';
import { pickRound, roundKey, type GameRound, type Rng } from '../../core/game.ts';
import { GROUP_SHORT_NAMES } from '../../core/groups.ts';
import type { AppState } from '../../core/state.ts';
import type { Dataset } from '../../data/dataset.ts';
import type { ResolvedView } from '../../view.ts';
import type { AppActions, Feature } from '../actions.ts';
import { el } from '../dom.ts';
import { icon } from '../icons.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Classe posée sur <body> pendant une manche : elle coupe les infobulles (voir facts.css). */
const ROUND_CLASS = 'sg-game-round';
/** Écart (px) entre le losange et le cercle qui le désigne. */
const MARKER_GAP = 7;

export class Game implements Feature {
  private readonly host: HTMLElement;
  private readonly ds: Dataset;
  private readonly actions: AppActions;
  private readonly chart: SaintChart;
  private readonly rng: Rng;
  private readonly marker: SVGCircleElement;
  private readonly played = new Set<string>();
  private active = false;
  private round: GameRound | null = null;
  private answered: string | null = null;
  private right = 0;
  private total = 0;
  /** Réglage des libellés à rétablir en quittant le jeu. */
  private savedLabels = true;
  private view: ResolvedView | null = null;
  private hiddenCandidates: readonly string[] = [];
  /** Premier rendu : si la page s'ouvre sur le jeu, l'URL porte les libellés coupés par le jeu. */
  private firstSync = true;
  /** Élection sans manche possible : on n'y relance pas de manche à chaque rendu. */
  private emptyFor: string | null = null;

  constructor(
    host: HTMLElement,
    ds: Dataset,
    actions: AppActions,
    chart: SaintChart,
    rng: Rng = Math.random,
  ) {
    this.host = host;
    this.ds = ds;
    this.actions = actions;
    this.chart = chart;
    this.rng = rng;
    this.marker = document.createElementNS(SVG_NS, 'circle');
    this.marker.setAttribute('class', 'sg-game-marker');

    // Le bouton n'apparaît que si les données permettent de jouer.
    const button = document.querySelector<HTMLButtonElement>('#sg-rail button[data-panel="game"]');
    if (button) button.hidden = pickRound(ds, () => 0) === null;
    chart.onRender(() => this.drawMarker());
  }

  sync(view: ResolvedView, state: AppState): void {
    this.view = view;
    this.hiddenCandidates = state.hiddenCandidates;
    const open = state.panel === 'game';
    if (open && !this.active) {
      this.active = true;
      this.savedLabels = this.firstSync ? true : state.showLabels;
      // Différé : on ne modifie pas l'état au milieu d'un rendu.
      queueMicrotask(() => this.startRound());
    } else if (!open && this.active) {
      this.active = false;
      queueMicrotask(() => this.leave());
    } else if (open) {
      const election = view.electionId;
      if (election !== (this.round?.electionId ?? null) && election !== this.emptyFor) {
        // Une autre élection choisie sur la frise : la manche continue dans celle-ci.
        queueMicrotask(() => this.startRound(election));
      } else if (this.round && this.answered === null && (state.selected || state.compared)) {
        // L'inspecteur afficherait le nom de l'électorat sélectionné.
        queueMicrotask(() => this.actions.patch({ selected: null, compared: null }, 'none'));
      }
    }
    this.firstSync = false;
    this.drawMarker();
  }

  private startRound(election?: string): void {
    if (!this.active) return;
    const round = pickRound(this.ds, this.rng, {
      ...(election ? { election } : {}),
      played: this.played,
    });
    if (!round) {
      this.round = null;
      this.answered = null;
      this.emptyFor = election ?? null;
      document.body.classList.remove(ROUND_CLASS);
      this.actions.patch({ showLabels: this.savedLabels }, 'fast');
      this.renderEmpty();
      return;
    }
    this.emptyFor = null;
    this.round = round;
    this.answered = null;
    document.body.classList.add(ROUND_CLASS);
    this.actions.patch(
      {
        election: round.electionId,
        selected: null,
        compared: null,
        showLabels: false,
        layout: 'map',
        hiddenCandidates: this.hiddenCandidates.filter((id) => id !== round.answerId),
      },
      'normal',
    );
    this.chart.fitElectorates();
    this.render();
  }

  private answer(id: string): void {
    const round = this.round;
    if (!round || this.answered !== null) return;
    this.answered = id;
    this.played.add(roundKey(round));
    this.total += 1;
    if (id === round.answerId) this.right += 1;
    document.body.classList.remove(ROUND_CLASS);
    this.actions.patch({ showLabels: this.savedLabels }, 'fast');
    this.render();
    // Sur téléphone, le verdict tombe sous les noms : il doit rester en vue.
    document.getElementById('sg-game-next')?.scrollIntoView({ block: 'nearest' });
  }

  private leave(): void {
    document.body.classList.remove(ROUND_CLASS);
    this.round = null;
    this.answered = null;
    this.emptyFor = null;
    this.marker.remove();
    this.actions.patch({ showLabels: this.savedLabels }, 'fast');
    this.chart.resetZoom();
  }

  private drawMarker(): void {
    const round = this.round;
    const candidate = round
      ? this.view?.model.candidates.find((c) => c.id === round.answerId)
      : undefined;
    if (!this.active || !candidate || this.view?.electionId !== round?.electionId) {
      this.marker.remove();
      return;
    }
    if (this.marker.parentNode !== this.chart.layerOver) this.chart.layerOver.append(this.marker);
    const { x, y } = this.chart.scales();
    const half =
      CHART_STYLE.candidateHalfDiagonalPerSqrtPct *
      this.chart.geometry.unit *
      Math.sqrt(Math.max(0, candidate.share ?? CHART_STYLE.candidateDefaultShare));
    const r = Math.max(CHART_STYLE.candidateMinHalfDiagonal, half) + MARKER_GAP;
    this.marker.setAttribute('cx', String(x(candidate.x)));
    this.marker.setAttribute('cy', String(y(candidate.y)));
    this.marker.setAttribute('r', String(r));
  }

  private renderEmpty(): void {
    this.host.replaceChildren(
      el('p', {
        class: 'sg-note',
        text: 'Choisissez une élection sur la frise pour jouer : celle-ci ne s’y prête pas.',
      }),
    );
  }

  private bars(round: GameRound): HTMLElement {
    const max = Math.max(...round.bars.flatMap((b) => [b.share, b.reference]), 1);
    return el(
      'ul',
      { class: 'sg-game__bars', attrs: { id: 'sg-game-bars' } },
      ...round.bars.map((b) => {
        const fill = el('span', { class: 'sg-game__fill' });
        fill.style.width = `${(100 * b.share) / max}%`;
        fill.style.setProperty('--sg-bar', `var(--sg-group-${b.group}, var(--sg-text-muted))`);
        const tick = el('span', { class: 'sg-game__tick' });
        tick.style.left = `${(100 * b.reference) / max}%`;
        return el(
          'li',
          { class: 'sg-game__bar' },
          el('span', {
            class: 'sg-game__name',
            text: GROUP_SHORT_NAMES[b.group] ?? b.group,
          }),
          el('span', { class: 'sg-game__track' }, fill, tick),
          el('span', { class: 'sg-game__value', text: formatPct(b.share, 0) }),
        );
      }),
    );
  }

  private render(): void {
    const round = this.round;
    if (!round) return;
    const done = this.answered !== null;
    const options = round.options.map((option) => {
      const isAnswer = option.id === round.answerId;
      const chosen = option.id === this.answered;
      const button = el(
        'button',
        {
          class: 'sg-game__option',
          attrs: { type: 'button', 'data-game-option': option.id },
        },
        el('span', { class: 'sg-game__label', text: option.label }),
        done && isAnswer ? el('span', { class: 'sg-game__mark', text: 'Bonne réponse' }) : null,
        done && chosen && !isAnswer
          ? el('span', { class: 'sg-game__mark', text: 'Votre choix' })
          : null,
      );
      button.disabled = done;
      button.classList.toggle('sg-game__option--right', done && isAnswer);
      button.classList.toggle('sg-game__option--wrong', done && chosen && !isAnswer);
      button.addEventListener('click', () => this.answer(option.id));
      return button;
    });

    const correct = done && this.answered === round.answerId;
    const feedback = el('p', {
      class: 'sg-game__feedback',
      attrs: { id: 'sg-game-feedback', 'aria-live': 'polite', role: 'status' },
      text: done
        ? correct
          ? `Bravo : c’était bien ${round.answerLabel}.`
          : `Raté : c’était ${round.answerLabel}.`
        : '',
    });

    const nextButton = el(
      'button',
      { class: 'sg-btn sg-game__next', attrs: { type: 'button', id: 'sg-game-next' } },
      icon('shuffle'),
      done ? 'Manche suivante' : 'Passer',
    );
    nextButton.addEventListener('click', () => {
      if (!done) this.played.add(roundKey(round));
      this.startRound();
    });

    this.host.replaceChildren(
      el('p', {
        class: 'sg-note',
        text: `${round.electionLabel}. L’électorat entouré sur la carte a cette composition : à qui est-il ?`,
      }),
      this.bars(round),
      el('p', {
        class: 'sg-game__legend',
        text: 'Trait : part du groupe parmi les inscrits. Les agriculteurs comptent avec les indépendants.',
      }),
      el('div', { class: 'sg-game__options' }, ...options),
      feedback,
      el(
        'div',
        { class: 'sg-game__foot' },
        el('span', {
          class: 'sg-game__score',
          attrs: { id: 'sg-game-score' },
          text: `Score : ${this.right} sur ${this.total}`,
        }),
        nextButton,
      ),
    );
  }
}
