/**
 * Panneau du jeu, trois modes sur les mêmes données :
 * - « Qui est-ce ? » : un électorat est entouré, sa composition s'affiche sans son nom, à retrouver
 *   parmi trois noms. Tout ce qui donnerait la réponse est coupé : libellés, infobulles et sélection
 *   (l'inspecteur afficherait le nom). La réponse révèle les libellés.
 * - « Placez-le » : un nom, et un clic là où l'on pense trouver son électorat. Les électorats et leurs
 *   trajectoires sont masqués ; la réponse montre le vrai point, l'écart et les points gagnés.
 * - « Série du jour » : cinq manches, les mêmes pour tous ce jour-là, qui mêlent les deux.
 *
 * Chaque réponse cite son sondage. Le score reste en mémoire, le temps de la visite ; seul le meilleur
 * score du jour est gardé dans le navigateur, s'il le permet.
 */
import './facts.css';
import type { SaintChart } from '../../chart/chart.ts';
import { CHART_STYLE } from '../../chart/style.ts';
import { formatNumber, formatPct } from '../../core/format.ts';
import {
  dailySeries,
  dayKey,
  pickRound,
  placementPoints,
  PLACEMENT_ZERO_AT,
  ROUND_POINTS,
  roundKey,
  seriesResultText,
  type GameRound,
  type Rng,
  type RoundKind,
  type SeriesRound,
} from '../../core/game.ts';
import { GROUP_SHORT_NAMES } from '../../core/groups.ts';
import type { AppState } from '../../core/state.ts';
import type { Point } from '../../core/types.ts';
import type { Dataset } from '../../data/dataset.ts';
import type { ResolvedView } from '../../view.ts';
import type { AppActions, Feature } from '../actions.ts';
import { el } from '../dom.ts';
import { icon } from '../icons.ts';
import { sourceText } from '../sources.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Classe posée sur <body> pendant « Qui est-ce ? » : elle coupe les infobulles (voir facts.css). */
const ROUND_CLASS = 'sg-game-round';
/** Écart (px) entre le point de l'électorat et le cercle qui le désigne. */
const MARKER_GAP = 7;
const GUESS_RADIUS = 6;
const BEST_KEY = 'sg-serie-du-jour';

type GameMode = 'who' | 'place' | 'daily';

const MODES: readonly { id: GameMode; label: string }[] = [
  { id: 'who', label: 'Qui est-ce ?' },
  { id: 'place', label: 'Placez-le' },
  { id: 'daily', label: 'Série du jour' },
];

function readBest(day: string): number | null {
  try {
    const stored = window.localStorage.getItem(BEST_KEY);
    if (!stored) return null;
    const [storedDay, score] = stored.split('=');
    return storedDay === day && score ? Number(score) : null;
  } catch {
    return null;
  }
}

function writeBest(day: string, score: number): void {
  try {
    window.localStorage.setItem(BEST_KEY, `${day}=${score}`);
  } catch {
    // Sans stockage, le meilleur score ne dure que la partie.
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, cls: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  node.setAttribute('class', cls);
  return node;
}

export class Game implements Feature {
  private readonly ds: Dataset;
  private readonly actions: AppActions;
  private readonly chart: SaintChart;
  private readonly rng: Rng;
  private readonly today: () => Date;
  private readonly marker = svgEl('circle', 'sg-game-marker');
  private readonly guessMark = svgEl('g', 'sg-game-guess');
  private readonly guessLine = svgEl('line', 'sg-game-guess__line');
  private readonly guessDot = svgEl('circle', 'sg-game-guess__dot');
  private readonly body = el('div', { class: 'sg-game__body' });
  private readonly modeInputs = new Map<GameMode, HTMLInputElement>();
  private readonly played = new Set<string>();
  private mode: GameMode = 'who';
  private active = false;
  private round: GameRound | null = null;
  private kind: RoundKind = 'who';
  /** « Qui est-ce ? » : le nom choisi. */
  private answered: string | null = null;
  /** « Placez-le » : la marque posée, et ce qu'elle a donné. */
  private guess: Point | null = null;
  private placed: { distance: number; points: number } | null = null;
  private right = 0;
  private total = 0;
  private placedRounds = 0;
  private placedPoints = 0;
  private series: SeriesRound[] | null = null;
  private seriesIndex = 0;
  private seriesScores: number[] = [];
  private seriesDone = false;
  /** Réglages à rétablir en quittant le jeu. */
  private saved: Pick<AppState, 'showLabels' | 'showTrails' | 'showRings' | 'hiddenCandidates'> = {
    showLabels: true,
    showTrails: true,
    showRings: false,
    hiddenCandidates: [],
  };
  private view: ResolvedView | null = null;
  /** Premier rendu : si la page s'ouvre sur le jeu, l'URL porte les réglages coupés par le jeu. */
  private firstSync = true;
  /** Élection sans manche possible : on n'y relance pas de manche à chaque rendu. */
  private emptyFor: string | null = null;

  constructor(
    host: HTMLElement,
    ds: Dataset,
    actions: AppActions,
    chart: SaintChart,
    rng: Rng = Math.random,
    today: () => Date = () => new Date(),
  ) {
    this.ds = ds;
    this.actions = actions;
    this.chart = chart;
    this.rng = rng;
    this.today = today;
    this.guessMark.append(this.guessLine, this.guessDot);

    const switcher = el('div', {
      class: 'sg-segmented sg-segmented--small',
      attrs: { role: 'radiogroup', 'aria-label': 'Mode de jeu', id: 'sg-game-mode' },
    });
    for (const mode of MODES) {
      const input = el('input', {
        class: 'sg-sr-only',
        attrs: { type: 'radio', name: 'sg-game-mode', value: mode.id },
      });
      input.checked = mode.id === this.mode;
      input.addEventListener('change', () => {
        if (input.checked) this.setMode(mode.id);
      });
      this.modeInputs.set(mode.id, input);
      switcher.append(el('label', {}, input, el('span', { text: mode.label })));
    }
    host.append(switcher, this.body);

    // Le bouton n'apparaît que si les données permettent de jouer.
    const button = document.querySelector<HTMLButtonElement>('#sg-rail button[data-panel="game"]');
    if (button) button.hidden = pickRound(ds, () => 0) === null;
    chart.onRender(() => this.drawMarks());
  }

  sync(view: ResolvedView, state: AppState): void {
    this.view = view;
    const open = state.panel === 'game';
    if (open && !this.active) {
      this.active = true;
      this.saved = this.firstSync
        ? { showLabels: true, showTrails: true, showRings: false, hiddenCandidates: [] }
        : {
            showLabels: state.showLabels,
            showTrails: state.showTrails,
            showRings: state.showRings,
            hiddenCandidates: state.hiddenCandidates,
          };
      // Différé : on ne modifie pas l'état au milieu d'un rendu.
      queueMicrotask(() => this.startRound());
    } else if (!open && this.active) {
      this.active = false;
      queueMicrotask(() => this.leave());
    } else if (open && !this.seriesDone) {
      const election = view.electionId;
      if (election !== (this.round?.electionId ?? null) && election !== this.emptyFor) {
        if (this.mode === 'daily' && this.round) {
          // La série garde ses manches : elle revient à la sienne.
          const id = this.round.electionId;
          queueMicrotask(() => this.actions.patch({ election: id }, 'normal'));
        } else {
          // Une autre élection choisie sur la frise : la manche continue dans celle-ci.
          queueMicrotask(() => this.startRound(election));
        }
      } else if (this.round && !this.isDone() && (state.selected || state.compared)) {
        // L'inspecteur afficherait le nom de l'électorat sélectionné.
        queueMicrotask(() => this.actions.patch({ selected: null, compared: null }, 'none'));
      }
    }
    this.firstSync = false;
    this.drawMarks();
  }

  private isDone(): boolean {
    return this.answered !== null || this.placed !== null;
  }

  private setMode(mode: GameMode): void {
    this.mode = mode;
    this.series = null;
    this.seriesDone = false;
    this.startRound();
  }

  /** Remet la carte comme avant le jeu, sans quitter le panneau. */
  private resetMap(): void {
    document.body.classList.remove(ROUND_CLASS);
    this.chart.pickPoint(null);
    this.marker.remove();
    this.guessMark.remove();
    this.round = null;
    this.answered = null;
    this.guess = null;
    this.placed = null;
  }

  private nextRound(election?: string): { round: GameRound; kind: RoundKind } | null {
    if (this.mode === 'daily') {
      if (!this.series) {
        this.series = dailySeries(this.ds, dayKey(this.today()));
        this.seriesIndex = 0;
        this.seriesScores = [];
      }
      return this.series[this.seriesIndex] ?? null;
    }
    const round = pickRound(this.ds, this.rng, {
      ...(election ? { election } : {}),
      played: this.played,
    });
    return round ? { round, kind: this.mode === 'place' ? 'place' : 'who' } : null;
  }

  private startRound(election?: string): void {
    if (!this.active) return;
    this.resetMap();
    const next = this.nextRound(election);
    if (!next) {
      this.emptyFor = election ?? null;
      this.actions.patch(this.saved, 'fast');
      if (this.mode === 'daily' && (this.series?.length ?? 0) > 0) this.renderSeriesEnd();
      else this.renderEmpty();
      return;
    }
    this.emptyFor = null;
    this.round = next.round;
    this.kind = next.kind;
    const raw = this.ds.rawElections.get(next.round.electionId);
    const common = {
      election: next.round.electionId,
      selected: null,
      compared: null,
      layout: 'map' as const,
    };
    if (next.kind === 'who') {
      document.body.classList.add(ROUND_CLASS);
      this.actions.patch(
        {
          ...this.saved,
          ...common,
          showLabels: false,
          hiddenCandidates: this.saved.hiddenCandidates.filter((id) => id !== next.round.answerId),
        },
        'normal',
      );
      this.chart.fitElectorates();
    } else {
      this.actions.patch(
        {
          ...this.saved,
          ...common,
          showTrails: false,
          showRings: false,
          hiddenCandidates: [
            ...this.saved.hiddenCandidates,
            ...(raw?.candidates.map((c) => c.id) ?? []),
          ],
        },
        'normal',
      );
      this.chart.resetZoom();
      this.chart.pickPoint((point) => this.place(point));
    }
    this.render();
  }

  private scoreRound(points: number): void {
    if (this.mode === 'daily') this.seriesScores.push(points);
  }

  private answer(id: string): void {
    const round = this.round;
    if (!round || this.isDone()) return;
    this.answered = id;
    this.played.add(roundKey(round));
    this.total += 1;
    const right = id === round.answerId;
    if (right) this.right += 1;
    this.scoreRound(right ? ROUND_POINTS : 0);
    document.body.classList.remove(ROUND_CLASS);
    this.actions.patch({ showLabels: this.saved.showLabels }, 'fast');
    this.render();
    // Sur téléphone, le verdict tombe sous les noms : il doit rester en vue.
    document.getElementById('sg-game-next')?.scrollIntoView({ block: 'nearest' });
  }

  private place(point: Point): void {
    const round = this.round;
    const truth = this.view?.model.candidates.find((c) => c.id === round?.answerId);
    if (!round || this.isDone() || !truth) return;
    const distance = Math.hypot(point.x - truth.x, point.y - truth.y);
    const points = placementPoints(distance);
    this.guess = point;
    this.placed = { distance, points };
    this.played.add(roundKey(round));
    this.placedRounds += 1;
    this.placedPoints += points;
    this.scoreRound(points);
    this.chart.pickPoint(null);
    // Seul cet électorat réapparaît : les autres resteraient autant de réponses pour les manches à venir.
    const raw = this.ds.rawElections.get(round.electionId);
    this.actions.patch(
      {
        hiddenCandidates: [
          ...this.saved.hiddenCandidates,
          ...(raw?.candidates.map((c) => c.id).filter((id) => id !== round.answerId) ?? []),
        ],
      },
      'fast',
    );
    this.render();
    document.getElementById('sg-game-next')?.scrollIntoView({ block: 'nearest' });
  }

  private leave(): void {
    this.resetMap();
    this.emptyFor = null;
    this.seriesDone = false;
    this.series = null;
    this.actions.patch(this.saved, 'fast');
    this.chart.resetZoom();
  }

  private drawMarks(): void {
    const round = this.round;
    const candidate = round
      ? this.view?.model.candidates.find((c) => c.id === round.answerId)
      : undefined;
    const here = this.active && candidate && this.view?.electionId === round?.electionId;
    if (!here || this.kind !== 'who') {
      this.marker.remove();
    } else {
      if (this.marker.parentNode !== this.chart.layerOver) {
        this.chart.layerOver.append(this.marker);
      }
      const { x, y } = this.chart.scales();
      this.marker.setAttribute('cx', String(x(candidate.x)));
      this.marker.setAttribute('cy', String(y(candidate.y)));
      this.marker.setAttribute('r', String(CHART_STYLE.candidateDotRadius + MARKER_GAP));
    }
    const guess = this.guess;
    if (!here || !guess) {
      this.guessMark.remove();
      return;
    }
    if (this.guessMark.parentNode !== this.chart.layerOver) {
      this.chart.layerOver.append(this.guessMark);
    }
    const { x, y } = this.chart.scales();
    this.guessLine.setAttribute('x1', String(x(guess.x)));
    this.guessLine.setAttribute('y1', String(y(guess.y)));
    this.guessLine.setAttribute('x2', String(x(candidate.x)));
    this.guessLine.setAttribute('y2', String(y(candidate.y)));
    this.guessDot.setAttribute('cx', String(x(guess.x)));
    this.guessDot.setAttribute('cy', String(y(guess.y)));
    this.guessDot.setAttribute('r', String(GUESS_RADIUS));
  }

  private renderEmpty(): void {
    this.body.replaceChildren(
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

  /** Le sondage de la manche : rien n'est affirmé sans sa source. */
  private source(round: GameRound): HTMLElement | null {
    const source = round.source;
    if (!source) return null;
    return el(
      'p',
      { class: 'sg-game__source', attrs: { id: 'sg-game-source' } },
      'Source : ',
      el('a', {
        text: sourceText(source),
        attrs: { href: source.url, target: '_blank', rel: 'noopener noreferrer' },
      }),
    );
  }

  private scoreText(): string {
    if (this.mode === 'daily') {
      const sum = this.seriesScores.reduce((a, b) => a + b, 0);
      return `Manche ${this.seriesIndex + 1} sur ${this.series?.length ?? 0} · ${sum} points`;
    }
    if (this.mode === 'place') {
      return `Score : ${this.placedPoints} points en ${this.placedRounds} manche${this.placedRounds > 1 ? 's' : ''}`;
    }
    return `Score : ${this.right} sur ${this.total}`;
  }

  private foot(round: GameRound): HTMLElement {
    const done = this.isDone();
    const lastOfSeries =
      this.mode === 'daily' && this.seriesIndex + 1 >= (this.series?.length ?? 0);
    const label = !done ? 'Passer' : lastOfSeries ? 'Voir le résultat' : 'Manche suivante';
    const nextButton = el(
      'button',
      { class: 'sg-btn sg-game__next', attrs: { type: 'button', id: 'sg-game-next' } },
      icon('shuffle'),
      label,
    );
    nextButton.addEventListener('click', () => {
      if (!done) {
        this.played.add(roundKey(round));
        this.scoreRound(0);
      }
      if (this.mode === 'daily') this.seriesIndex += 1;
      this.startRound();
    });
    return el(
      'div',
      { class: 'sg-game__foot' },
      el('span', {
        class: 'sg-game__score',
        attrs: { id: 'sg-game-score' },
        text: this.scoreText(),
      }),
      nextButton,
    );
  }

  private render(): void {
    const round = this.round;
    if (!round) return;
    if (this.kind === 'place') this.renderPlace(round);
    else this.renderWho(round);
  }

  private renderWho(round: GameRound): void {
    const done = this.isDone();
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

    this.body.replaceChildren(
      el('p', {
        class: 'sg-note',
        attrs: { id: 'sg-game-question' },
        text: `${round.electionLabel}. L’électorat entouré sur la carte a cette composition : à qui est-il ?`,
      }),
      this.bars(round),
      el('p', {
        class: 'sg-game__legend',
        text: round.legend,
      }),
      el('div', { class: 'sg-game__options' }, ...options),
      feedback,
      ...(done ? [this.source(round)].filter((n) => n !== null) : []),
      this.foot(round),
    );
  }

  private renderPlace(round: GameRound): void {
    const result = this.placed;
    const feedback = el('p', {
      class: 'sg-game__feedback',
      attrs: { id: 'sg-game-feedback', 'aria-live': 'polite', role: 'status' },
      text: result
        ? `À ${formatNumber(result.distance)} unité${result.distance >= 2 ? 's' : ''} de la carte : ${result.points} points sur ${ROUND_POINTS}.`
        : '',
    });
    this.body.replaceChildren(
      el('p', {
        class: 'sg-note',
        attrs: { id: 'sg-game-question' },
        text: `${round.electionLabel}. Où placez-vous l’électorat de ${round.answerLabel} ?`,
      }),
      el('p', {
        class: 'sg-game__legend',
        text: result
          ? 'Sa place est le centre de gravité des groupes sociaux qui le composent, d’après ce sondage : elle ne mesure pas des opinions.'
          : `Cliquez sur la carte, ou au clavier, Tab jusqu’à une catégorie puis Entrée. ${ROUND_POINTS} points sur place, plus rien à ${PLACEMENT_ZERO_AT} unités ou plus.`,
      }),
      feedback,
      ...(result ? [this.source(round)].filter((n) => n !== null) : []),
      this.foot(round),
    );
  }

  private renderSeriesEnd(): void {
    this.seriesDone = true;
    const day = dayKey(this.today());
    const series = this.series ?? [];
    const total = this.seriesScores.reduce((a, b) => a + b, 0);
    const best = Math.max(total, readBest(day) ?? 0);
    writeBest(day, best);
    const result = seriesResultText(day, this.seriesScores);
    const copied = el('span', {
      class: 'sg-game__score',
      attrs: { id: 'sg-series-copied', 'aria-live': 'polite' },
    });
    const copy = el('button', {
      class: 'sg-btn',
      text: 'Copier le résultat',
      attrs: { type: 'button', id: 'sg-series-copy' },
    });
    copy.addEventListener('click', () => {
      const failed = (): void => {
        copied.textContent = `À copier : ${result}`;
      };
      if (!navigator.clipboard) {
        failed();
        return;
      }
      navigator.clipboard
        .writeText(result)
        .then(() => {
          copied.textContent = 'Copié.';
        })
        .catch(failed);
    });
    const again = el('button', {
      class: 'sg-btn',
      text: 'Rejouer',
      attrs: { type: 'button', id: 'sg-series-again' },
    });
    again.addEventListener('click', () => this.setMode('daily'));
    this.body.replaceChildren(
      el('p', {
        class: 'sg-game__total',
        attrs: { id: 'sg-series-result' },
        text: `${total} points sur ${this.seriesScores.length * ROUND_POINTS}`,
      }),
      el('p', {
        class: 'sg-note',
        text: `Série du jour : les mêmes manches pour tous aujourd’hui. Votre meilleur score du jour : ${best}.`,
      }),
      el(
        'ol',
        { class: 'sg-game__rows', attrs: { id: 'sg-series-rows' } },
        ...series.map((entry, i) =>
          el(
            'li',
            {},
            el('span', { text: `${entry.round.answerLabel}, ${entry.round.electionLabel}` }),
            el('span', { class: 'sg-num', text: String(this.seriesScores[i] ?? 0) }),
          ),
        ),
      ),
      el('div', { class: 'sg-game__foot' }, copy, again),
      copied,
    );
  }
}
