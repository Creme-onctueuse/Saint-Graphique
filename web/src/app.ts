/**
 * Orchestration de l'application : l'état (src/core/state.ts) est la seule source de vérité, il est
 * reflété dans l'URL ; chaque action le modifie puis redessine la carte et l'interface.
 *
 * Ajouter une fonction : écrire une classe `Feature` (ui/actions.ts) et l'ajouter à `features`.
 * Elle reçoit la vue et l'état à chaque rendu, et modifie l'état par `actions.patch`.
 */
import { SaintChart, type Animation, type ChartView } from './chart/chart.ts';
import { Minimap } from './chart/layers/minimap.ts';
import { ProjectionLayer } from './chart/layers/projection.ts';
import { RingsLayer } from './chart/layers/rings.ts';
import { TrailsLayer } from './chart/layers/trails.ts';
import { Spokes } from './chart/layers/spokes.ts';
import { sameWeights } from './core/scores.ts';
import { selectionPatch } from './core/selection.ts';
import { parseState, serializeState, type AppState } from './core/state.ts';
import { carrySelection } from './core/timeline.ts';
import { loadDataset } from './data/load.ts';
import { initAbout } from './ui/about.ts';
import type { AppActions, Feature } from './ui/actions.ts';
import { Controls } from './ui/controls.ts';
import { byId, el } from './ui/dom.ts';
import { buildExportSvg, downloadBlob, pngBlob, svgBlob, type ExportMeta } from './ui/export.ts';
import { Filters } from './ui/filters.ts';
import { mountIcons } from './ui/icons.ts';
import { Legend } from './ui/legend.ts';
import { MethodPanel } from './ui/methodPanel.ts';
import { CrossPanel } from './ui/shell/crossPanel.ts';
import { Inspector } from './ui/shell/inspector.ts';
import { FactCard } from './ui/shell/factCard.ts';
import { Game } from './ui/shell/game.ts';
import { Keybar } from './ui/shell/keybar.ts';
import { ProjectionCard } from './ui/shell/projectionCard.ts';
import { RingsKey } from './ui/shell/ringsKey.ts';
import { Search } from './ui/shell/search.ts';
import { Shell } from './ui/shell/shell.ts';
import { Tour } from './ui/shell/tour.ts';
import { Timeline } from './ui/shell/timeline.ts';
import { sourceText } from './ui/sources.ts';
import { renderTables } from './ui/table.ts';
import { applyTheme, storedTheme, ThemeSwitch } from './ui/theme.ts';
import { buildView, type ResolvedView } from './view.ts';
import { effectiveSelection } from './viewCrossing.ts';

const SAMPLE_WARNING =
  'Données d’exemple entièrement fictives : ces positions ne représentent aucune réalité. Ne pas citer.';
const CREDIT =
  'Saint-Graphique original : Chris et la PaduTeam (revue Positions). Algorithme reconstruit par ' +
  'JnthnBS/saint-graphique. Reconstruction ouverte, projet non officiel, sans affiliation.';

/** Délai d'écriture de l'URL : les navigateurs limitent la fréquence de history.replaceState. */
const URL_WRITE_DELAY_MS = 200;
const HINT_STORAGE_KEY = 'sg-hint-seen';

function readState(): AppState {
  const state = parseState(window.location.hash);
  if (!/(^#|&)t=/.test(window.location.hash)) state.theme = storedTheme();
  return state;
}

function toggled(list: readonly string[], id: string, visible: boolean): string[] {
  return visible ? list.filter((v) => v !== id) : [...list, id];
}

/** Petite aide affichée à la première visite, jusqu'au premier geste sur la carte. */
function installHint(): void {
  const hint = byId('sg-hint');
  try {
    if (window.localStorage.getItem(HINT_STORAGE_KEY)) return;
  } catch {
    // Stockage indisponible (navigation privée, file://) : l'aide reste affichée à chaque visite.
  }
  hint.hidden = false;
  const dismiss = (): void => {
    hint.hidden = true;
    try {
      window.localStorage.setItem(HINT_STORAGE_KEY, '1');
    } catch {
      // Sans stockage, l'aide réapparaîtra à la prochaine visite.
    }
  };
  document.addEventListener('pointerdown', dismiss, { once: true });
  document.addEventListener('wheel', dismiss, { once: true, passive: true });
  document.addEventListener('keydown', dismiss, { once: true });
}

export function startApp(): void {
  mountIcons();
  const ds = loadDataset();
  for (const w of ds.warnings) console.warn(`[données] ${w}`);

  let state = readState();
  let view: ResolvedView | null = null;
  let writtenHash = window.location.hash.replace(/^#/, '');
  let urlTimer: number | undefined;

  const chartHost = byId('sg-chart-host');
  const banner = byId('sg-banner');
  const status = byId('sg-status');
  const live = byId('sg-live');
  const tables = byId('sg-data-tables');

  banner.textContent = SAMPLE_WARNING;
  banner.hidden = !ds.isSample;

  const chart = new SaintChart(chartHost);
  new Minimap(chart, byId('sg-minimap-host'));

  const writeUrl = (): void => {
    window.clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      const hash = serializeState(state);
      if (hash === writtenHash) return;
      writtenHash = hash;
      const base = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', hash ? `#${hash}` : base);
    }, URL_WRITE_DELAY_MS);
  };

  const chartView = (): ChartView => ({
    hiddenGroups: new Set(state.hiddenGroups),
    hiddenCandidates: new Set(state.hiddenCandidates),
    showLabels: state.showLabels,
    showEllipses: state.showEllipses,
    focus: view?.crossing?.focus ?? null,
    selected: new Set(view?.crossing?.keys ?? []),
    square: state.square || view?.crossing?.mode === 'proximity',
  });

  const actions: AppActions = {
    patch(patch, animation = 'fast') {
      update(patch, animation);
    },
    setElection(id) {
      update({ election: id, selected: carrySelection(ds.families, id, state.selected) }, 'normal');
    },
    setMethod(id) {
      update({ method: id }, 'normal');
    },
    setCandidateVisible(id, visible) {
      update({ hiddenCandidates: toggled(state.hiddenCandidates, id, visible) }, 'fast');
    },
    setGroupVisible(code, visible) {
      update({ hiddenGroups: toggled(state.hiddenGroups, code, visible) }, 'fast');
    },
    setCandidatesVisible(ids, visible) {
      const rest = state.hiddenCandidates.filter((id) => !ids.includes(id));
      update({ hiddenCandidates: visible ? rest : [...rest, ...ids] }, 'fast');
    },
    setShowLabels(show) {
      update({ showLabels: show }, 'fast');
    },
    setShowEllipses(show) {
      update({ showEllipses: show }, 'fast');
    },
    setWeight(key, value) {
      if (!view) return;
      const next = { ...view.params.y_weights, [key]: value };
      update({ weights: sameWeights(next, view.defaults.y_weights) ? null : next }, 'fast');
    },
    setRetired(value) {
      if (!view) return;
      const base = view.defaults.retired_y_override;
      const isDefault = value === 'off' ? base === null : base !== null && base.score === value;
      update({ retired: isDefault ? 'default' : value }, 'fast');
    },
    resetParams() {
      update({ weights: null, retired: 'default' }, 'normal');
    },
    setTheme(theme) {
      update({ theme }, 'none');
    },
  };

  const controls = new Controls(ds, actions);
  const methodPanel = new MethodPanel(byId('sg-method-panel'), actions);
  const themeSwitch = new ThemeSwitch(actions);
  initAbout(ds);

  const features: Feature[] = [
    new Search(byId('sg-search'), actions, chart),
    new Tour(actions, chart),
    new Timeline(byId('sg-timeline'), ds, actions, chart),
    new TrailsLayer(chart, ds),
    new RingsLayer(chart, ds),
    new ProjectionLayer(chart),
    new ProjectionCard(actions),
    new RingsKey(ds),
    new Keybar(byId('sg-keybar'), actions),
    new Legend(
      byId('sg-legend-groups'),
      byId('sg-legend-candidates'),
      byId('sg-legend-keys'),
      actions,
    ),
    new Filters(
      {
        electorates: byId('sg-options-electorates'),
        categories: byId('sg-options-categories'),
        method: byId('sg-options-method'),
      },
      actions,
    ),
    new CrossPanel(byId('sg-cross-panel'), ds, actions, () => chart.resetZoom()),
    new Inspector(byId('sg-inspector'), ds, actions),
    new Spokes(chart),
    new Game(byId('sg-game-panel'), ds, actions, chart),
    new Shell(actions, (insets) => chart.setInsets(insets)),
    new FactCard(byId('sg-fact'), ds, actions, chart),
  ];

  function render(animation: Animation): void {
    applyTheme(state.theme);
    themeSwitch.sync(state.theme);
    const next = buildView(ds, state);
    if (!next) {
      chartHost.replaceChildren(
        el('p', {
          class: 'sg-error',
          text: 'Aucune donnée à afficher : relancez « pnpm sync-data » puis rechargez la page.',
        }),
      );
      return;
    }
    const selectionChanged =
      view?.electionId !== next.electionId || view?.method.id !== next.method.id;
    view = next;
    chart.update(next.model, chartView(), animation);
    controls.sync(next);
    methodPanel.sync(next, state);
    renderTables(tables, next);
    for (const feature of features) feature.sync(next, state);
    if (selectionChanged) live.textContent = `Affichage : ${next.model.title}.`;
    writeUrl();
  }

  function update(patch: Partial<AppState>, animation: Animation): void {
    state = { ...state, ...patch };
    render(animation);
  }

  chart.onSelect((key, additive) => {
    if (key === null && !state.selected) return;
    update(selectionPatch(effectiveSelection(view, state), key, additive), 'fast');
  });

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash === writtenHash) return;
    writtenHash = hash;
    state = readState();
    render('normal');
  });

  byId('sg-zoom-in').addEventListener('click', () => chart.zoomBy(1.6));
  byId('sg-zoom-out').addEventListener('click', () => chart.zoomBy(1 / 1.6));
  byId('sg-zoom-reset').addEventListener('click', () => chart.resetZoom());
  byId('sg-zoom-electorates').addEventListener('click', () => chart.fitElectorates());

  const shareButton = byId<HTMLButtonElement>('sg-share');
  shareButton.addEventListener('click', () => {
    const url = window.location.href;
    const done = (message: string): void => {
      status.textContent = message;
      window.setTimeout(() => {
        if (status.textContent === message) status.textContent = '';
      }, 2500);
    };
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(url)
        .then(() => done('Lien de cette vue copié.'))
        .catch(() => done('Copie impossible : copiez l’adresse de la page.'));
    } else {
      done('Copie impossible : copiez l’adresse de la page.');
    }
  });

  const exportMeta = (current: ResolvedView): ExportMeta => {
    const hiddenGroups = new Set(state.hiddenGroups);
    const hiddenCandidates = new Set(state.hiddenCandidates);
    const groups = new Map(current.model.pcs.map((p) => [p.group, p]));
    return {
      title: `Le Saint-Graphique : ${current.electionLabel}`,
      subtitle: `Méthode : ${current.method.label}${current.customized ? ' (poids modifiés)' : ''}`,
      warning: ds.isSample ? SAMPLE_WARNING : null,
      credit: CREDIT,
      notes: [
        ...current.reserves,
        ...[
          ...current.sources.poll,
          ...(current.sources.positions.length > 0
            ? current.sources.positions
            : current.sources.pcs),
        ].map((s) => `Source : ${sourceText(s)}`),
      ],
      legend: [
        ...[...groups.values()]
          .filter((p) => !hiddenGroups.has(p.group))
          .sort((a, b) => a.group.localeCompare(b.group))
          .map((p) => ({
            label: p.groupLabel,
            color: `var(--sg-group-${p.group}, ${p.color})`,
            shape: 'disc' as const,
          })),
        ...current.model.candidates
          .filter((c) => !hiddenCandidates.has(c.id))
          .sort((a, b) => (b.share ?? 0) - (a.share ?? 0))
          .map((c) => ({
            label: c.label,
            color: c.isAbstention ? `var(--sg-abstention, ${c.color})` : c.color,
            shape: 'bubble' as const,
          })),
      ],
    };
  };

  const exportName = (current: ResolvedView, extension: string): string =>
    `saint-graphique_${current.electionId}_${current.method.id}.${extension}`;

  byId('sg-export-svg').addEventListener('click', () => {
    if (!view) return;
    chart.clearHover();
    downloadBlob(svgBlob(buildExportSvg(chart.svg, exportMeta(view))), exportName(view, 'svg'));
  });
  byId('sg-export-png').addEventListener('click', () => {
    const current = view;
    if (!current) return;
    chart.clearHover();
    pngBlob(buildExportSvg(chart.svg, exportMeta(current)))
      .then((blob) => downloadBlob(blob, exportName(current, 'png')))
      .catch((err: unknown) => {
        console.error(err);
        status.textContent = 'Export PNG impossible dans ce navigateur : essayez l’export SVG.';
      });
  });

  render('none');
  installHint();

  // Mode calque : réservé au développement, absent du build de production.
  if (import.meta.env.DEV) {
    void import('./ui/overlay.ts').then(({ installOverlay }) => installOverlay(chart));
  }
}
