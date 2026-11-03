/**
 * Test de fumée dans un vrai navigateur : ouvre dist/index.html en file:// (ou --url), pilote Edge
 * ou Chrome en mode headless par le protocole DevTools, sans dépendance, et vérifie que l'application
 * fonctionne : aucune erreur console, aucune requête réseau, interactions, exports, 400 px de large.
 *
 * La page est une carte plein écran : le test vérifie aussi qu'elle remplit la fenêtre, sans défilement.
 *
 * Usage : pnpm smoke [--url http://localhost:5173/ --dev] [--out DOSSIER]   (captures dans DOSSIER)
 * Navigateur : variable CHROME_PATH, sinon emplacements habituels.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const devMode = argv.includes('--dev');
const outDir = option('--out');
const target = option('--url') ?? pathToFileURL(join(web, 'dist', 'index.html')).href;
const port = 9300 + Math.floor(Math.random() * 500);

/**
 * Limites de lisibilité par élection, à 1912 px. La carte étirée dégage le centre : aucun nom ne
 * mord plus un disque, et une ou deux lignes de rappel seulement en traversent un.
 */
const LABEL_DISC_TOLERANCE = 4;
const LEADERS_THROUGH_DISCS_TOLERANCE = 3;

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) {
  console.error('[smoke] aucun navigateur trouvé : définissez CHROME_PATH.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Connexion minimale au protocole DevTools. */
function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else ok(msg.result);
    } else if (msg.method) {
      for (const fn of handlers.get(msg.method) ?? []) fn(msg.params);
    }
  });
  return new Promise((ready, fail) => {
    ws.addEventListener('error', () => fail(new Error('connexion DevTools impossible')));
    ws.addEventListener('open', () =>
      ready({
        send: (method, params = {}) =>
          new Promise((ok, reject) => {
            const id = nextId++;
            pending.set(id, { resolve: ok, reject });
            ws.send(JSON.stringify({ id, method, params }));
          }),
        on: (method, fn) => {
          handlers.set(method, [...(handlers.get(method) ?? []), fn]);
        },
        close: () => ws.close(),
      }),
    );
  });
}

const failures = [];
const passes = [];
function check(name, ok, detail = '') {
  if (ok) passes.push(name);
  else failures.push(`${name}${detail ? ` : ${detail}` : ''}`);
}

const profile = mkdtempSync(join(tmpdir(), 'sg-smoke-'));
const browser = spawn(
  browserPath,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu',
    '--force-color-profile=srgb',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function pageTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      // Le navigateur démarre encore.
    }
    await sleep(100);
  }
  throw new Error('navigateur injoignable');
}

async function main() {
  const cdp = await connect((await pageTarget()).webSocketDebuggerUrl);
  const problems = [];
  const requests = [];
  cdp.on('Runtime.exceptionThrown', (p) => {
    problems.push(
      `exception : ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`,
    );
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'warning') {
      problems.push(`console.${p.type} : ${p.args.map((a) => a.value ?? a.description).join(' ')}`);
    }
  });
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error') problems.push(`journal : ${p.entry.text} ${p.entry.url ?? ''}`);
  });
  cdp.on('Network.requestWillBeSent', (p) => requests.push(p.request.url));

  await Promise.all(
    ['Runtime.enable', 'Log.enable', 'Network.enable', 'Page.enable'].map((m) => cdp.send(m)),
  );
  // Sans fenêtre active, element.focus() ne déclenche aucun événement : les vérifications au clavier
  // ne passeraient que dans les navigateurs qui ont pris le focus par hasard.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const emulateScheme = (value) =>
    cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value }],
    });
  await emulateScheme('light');
  const setViewport = (width, height) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`${expression.slice(0, 80)} : ${r.exceptionDetails.exception?.description}`);
    }
    return r.result.value;
  };
  const shot = async (name, wholePage = true) => {
    if (!outDir) return;
    mkdirSync(outDir, { recursive: true });
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: wholePage,
    });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
  };
  /** Capture agrandie d'un élément, pour juger la lisibilité. */
  const shotOf = async (name, selector, scale) => {
    if (!outDir) return;
    const clip = await evaluate(`(() => {
      const r = document.querySelector('${selector}').getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
    })()`);
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { ...clip, scale },
    });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const navigate = async (url) => {
    const loaded = new Promise((ok) => cdp.on('Page.loadEventFired', ok));
    await cdp.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(5000)]);
    await sleep(devMode ? 800 : 150);
  };
  /** Laisse finir les transitions et l'écriture différée de l'URL. */
  const settle = () => sleep(800);
  const chooseElection = async (id) => {
    await evaluate(`document.querySelector('#sg-timeline input[value="${id}"]').click()`);
    await settle();
  };
  /** Ouvre un panneau du rail, ou le referme. */
  const openPanel = async (id) => {
    await evaluate(`document.querySelector('#sg-rail button[data-panel="${id}"]').click()`);
    // La carte glisse pendant 180 ms.
    await sleep(320);
  };
  /** La carte remplit la fenêtre, et la page ne défile dans aucun sens. */
  const fillsWindow = () =>
    evaluate(`(() => {
      const r = document.querySelector('.sg-svg').getBoundingClientRect();
      const root = document.documentElement;
      return {
        width: r.width,
        height: r.height,
        fills: r.width >= innerWidth - 1 && r.height >= innerHeight - 1,
        scrolls: root.scrollWidth > innerWidth || root.scrollHeight > innerHeight,
      };
    })()`);
  const chooseMethod = async (id) => {
    await evaluate(`(() => {
      const m = document.getElementById('sg-method');
      m.value = ${JSON.stringify(id)};
      m.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await settle();
  };

  await setViewport(1280, 800);
  await navigate(target);

  // --- Rendu initial ---------------------------------------------------------------------------
  const initial = await evaluate(`({
    pcs: document.querySelectorAll('.sg-pcs').length,
    cands: document.querySelectorAll('.sg-cand').length,
    bary: document.querySelectorAll('.sg-bary').length,
    ellipses: document.querySelectorAll('.sg-ellipse').length,
    labels: [...document.querySelectorAll('.sg-label')].filter((l) => l.getAttribute('opacity') !== '0').length,
    diagonal: !!document.querySelector('.sg-diagonal'),
    quadrants: document.querySelectorAll('.sg-quadrant').length,
    elections: document.querySelectorAll('#sg-timeline input[type="radio"]').length,
    methods: document.querySelectorAll('#sg-method option').length,
    legend: document.querySelectorAll('.sg-chip').length,
    rows: document.querySelectorAll('.sg-table tbody tr').length,
    banner: !document.getElementById('sg-banner').hidden,
    overlay: !!document.querySelector('.sg-devoverlay'),
  })`);
  check('disques PCS', initial.pcs === 41 || initial.pcs === 30, String(initial.pcs));
  check('bulles des électorats', initial.cands > 0, String(initial.cands));
  check('barycentre de la population', initial.bary === 1);
  check('diagonale et quadrants', initial.diagonal && initial.quadrants === 4);
  check('libellés visibles', initial.labels >= 15, String(initial.labels));
  check('frise et méthodes remplies', initial.elections > 0 && initial.methods > 0);
  check('légende', initial.legend >= initial.cands + 2);
  check('tableaux non construits, panneau fermé', initial.rows === 0, String(initial.rows));
  await openPanel('data');
  const tableRows = await evaluate(`document.querySelectorAll('.sg-table tbody tr').length`);
  check(
    'tableaux de données, panneau ouvert',
    tableRows === initial.pcs + initial.cands,
    String(tableRows),
  );
  await openPanel('data');
  check(
    devMode ? 'mode calque présent en dev' : 'mode calque absent du build',
    initial.overlay === devMode,
  );
  await shot('01-clair');

  // --- La carte remplit l'écran ---------------------------------------------------------------------
  for (const [width, height] of [
    [1912, 948],
    [1280, 800],
    [400, 800],
  ]) {
    await setViewport(width, height);
    await settle();
    const filled = await fillsWindow();
    check(`carte plein écran à ${width}×${height}`, filled.fills, JSON.stringify(filled));
    check(`aucun défilement à ${width}×${height}`, !filled.scrolls, JSON.stringify(filled));
  }
  await setViewport(1280, 800);
  await settle();

  // --- Réserve et sources en bas de page : une ligne visible, le détail à l'ouverture -----------------
  const reserved = await evaluate(`(() => {
    const visible = (id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom <= innerHeight;
    };
    const end = document.getElementById('sg-end').getBoundingClientRect();
    const caveat = document.getElementById('sg-caveat-text');
    const line = document.getElementById('sg-sources-text');
    const closed = document.getElementById('sg-drawer').hidden;
    document.getElementById('sg-caveat-toggle').click();
    const reserve = document.getElementById('sg-reserves');
    const reserveOpen = !reserve.hidden && reserve.getBoundingClientRect().height > 0;
    document.getElementById('sg-sources-toggle').click();
    const sources = document.getElementById('sg-sources');
    const sourcesOpen = !sources.hidden && sources.getBoundingClientRect().height > 0;
    const links = [...sources.querySelectorAll('a')].map((a) => a.href);
    const detail = sources.textContent;
    document.getElementById('sg-sources-toggle').click();
    return {
      summary: caveat.textContent,
      summaryVisible: visible('sg-caveat-text'),
      line: line.textContent,
      lineVisible: visible('sg-sources-toggle'),
      atEnd: end.bottom >= innerHeight - 12,
      oneLine: end.height <= 44,
      closed,
      reserveOpen,
      sourcesOpen,
      links,
      detail,
      reserveText: reserve.textContent,
      fictional: !document.getElementById('sg-banner').hidden,
      mca: [...document.querySelectorAll('#sg-method option')].find((o) => o.value === 'mca')?.textContent ?? null,
    };
  })()`);
  check('réserve résumée toujours visible', reserved.summaryVisible && reserved.summary.length > 0);
  check(
    'réserve complète à l’ouverture',
    reserved.reserveOpen && reserved.reserveText.length > reserved.summary.length,
  );
  check(
    'sources sur une ligne, en fin de page',
    reserved.lineVisible && reserved.atEnd && reserved.oneLine,
    reserved.line,
  );
  check(
    'détail des sources avec liens',
    // La fixture fictive n'a pas d'URL : ses sources s'affichent en texte, sans lien.
    reserved.sourcesOpen &&
      reserved.detail.length > 0 &&
      (reserved.fictional || reserved.links.length >= 2),
    reserved.detail,
  );
  check('le détail est fermé par défaut', reserved.closed);

  // --- JnthnBS : dans les crédits, nulle part ailleurs ------------------------------------------------
  const creditLeaks = await evaluate(`(() => {
    const about = document.getElementById('sg-about');
    const rest = [...document.body.children].filter((n) => n !== about && n.tagName !== 'SCRIPT');
    const text = rest.map((n) => n.textContent).join(' ');
    return { body: /jnthnbs/i.test(text), url: /jnthnbs/i.test(location.href) };
  })()`);
  check(
    'JnthnBS absent hors des crédits',
    !creditLeaks.body && !creditLeaks.url,
    JSON.stringify(creditLeaks),
  );
  if (reserved.mca !== null)
    check('ACM marquée exploratoire', reserved.mca.includes('exploratoire'), reserved.mca);

  // --- Mode calque (dev) : dépôt d'une image, puis calage en deux clics ---------------------------
  if (devMode) {
    const calque = await evaluate(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 100;
      canvas.getContext('2d').fillRect(0, 0, 200, 100);
      const blob = await new Promise((r) => canvas.toBlob(r));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'calque.png', { type: 'image/png' }));
      const input = document.querySelector('.sg-devoverlay input[type="file"]');
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 300));
      const image = document.querySelector('.sg-layer-above image');
      const before = image?.getAttribute('width');
      document.querySelector('.sg-devoverlay button').click();
      const r = document.querySelector('.sg-plot-bg').getBoundingClientRect();
      const click = (fx, fy) => document.querySelector('.sg-plot-bg').dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: r.left + fx * r.width,
        clientY: r.top + fy * r.height,
      }));
      click(0.4, 0.6);
      click(0.6, 0.4);
      const help = document.querySelector('.sg-devoverlay__help').textContent;
      return { before, after: image?.getAttribute('width'), help };
    })()`);
    check('calque déposé', Number(calque.before) > 0, String(calque.before));
    check(
      'calage en deux clics',
      calque.help === 'Image calée.' && calque.before !== calque.after,
      JSON.stringify(calque),
    );
    await evaluate(`[...document.querySelectorAll('.sg-devoverlay button')].at(-1).click()`);
  }

  // --- Changement d'élection et de méthode, URL ---------------------------------------------------
  await evaluate(`(() => {
    const s = document.getElementById('sg-method');
    s.value = [...s.options].at(-1).value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    // Une étape différente de l'élection affichée : le clic doit changer quelque chose.
    const stops = [...document.querySelectorAll('#sg-timeline input[type="radio"]')];
    stops.filter((o) => !o.checked && o.value !== 'projection_2027').at(-1).click();
  })()`);
  await settle();
  const moved = await evaluate(`({
    hash: location.hash,
    method: document.getElementById('sg-method').value,
    election: document.querySelector('#sg-timeline input:checked')?.value,
    heading: document.getElementById('sg-chart-heading').textContent,
    live: document.getElementById('sg-live').textContent,
  })`);
  check(
    'URL mise à jour',
    moved.hash.includes(`m=${moved.method}`) && moved.hash.includes(`e=${moved.election}`),
    moved.hash,
  );
  check('annonce pour lecteur d’écran', moved.live.length > 0);
  await shot('02-autre-election');

  // Aller-retour URL : recharger restaure la vue
  await cdp.send('Page.reload');
  await sleep(devMode ? 1000 : 400);
  const reloaded = await evaluate(
    `document.getElementById('sg-method').value + '|' + (document.querySelector('#sg-timeline input:checked')?.value ?? '')`,
  );
  check('vue restaurée depuis l’URL', reloaded === `${moved.method}|${moved.election}`, reloaded);
  await evaluate(`location.hash = ''`);
  await settle();

  // Positions lues : rien à recalculer, donc aucun curseur actif.
  const shownMethod = await evaluate(`document.getElementById('sg-method').value`);
  const readSliders = await evaluate(
    `[...document.querySelectorAll('#sg-method-panel input[type=range]')].filter((i) => !i.disabled).length`,
  );
  check(
    'positions lues : aucun curseur actif',
    shownMethod !== 'read_positions' || readSliders === 0,
    String(readSliders),
  );

  // --- Curseurs : recalcul dans le navigateur ------------------------------------------------------
  // Les curseurs et les statuts de patrimoine n'existent que pour les méthodes calculées.
  await chooseMethod('ranks');
  const before = await evaluate(
    `document.querySelector('.sg-pcs[data-key="p:31"]')?.getAttribute('cy')`,
  );
  await evaluate(`(() => {
    const r = document.getElementById('sg-weight-bac5');
    r.value = '-5';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    const c = document.getElementById('sg-weight-certif_aucun');
    c.value = '5';
    c.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await settle();
  const after = await evaluate(`({
    cy: document.querySelector('.sg-pcs[data-key="p:31"]')?.getAttribute('cy'),
    status: document.getElementById('sg-status').textContent,
    hash: location.hash,
    ellipses: document.querySelectorAll('.sg-ellipse:not(.sg-exiting)').length,
  })`);
  const recomputable = await evaluate(`!document.getElementById('sg-weight-bac5').disabled`);
  if (recomputable) {
    check('les poids déplacent les PCS', before !== after.cy, `${before} -> ${after.cy}`);
    check('poids dans l’URL', after.hash.includes('w=-5_'), after.hash);
    check('recalcul signalé', /recalcul/i.test(after.status), after.status);
    await evaluate(`[...document.querySelectorAll('#sg-method-panel button')].at(-1).click()`);
    await settle();
    const resetCy = await evaluate(
      `document.querySelector('.sg-pcs[data-key="p:31"]')?.getAttribute('cy')`,
    );
    check(
      'réinitialisation des poids',
      Math.abs(Number(resetCy) - Number(before)) < 1e-6,
      `${resetCy} / ${before}`,
    );
  }

  // --- Méthodes aux axes propres : libellés, panneau, ni diagonale ni noms de régions --------------
  const ownAxes = async () =>
    evaluate(`(() => {
      // Le panneau peut être replié : seul compte ce qu'il masque en son sein.
      const shown = (el) => el !== null && !el.closest('#sg-method-panel [hidden]');
      const panel = document.getElementById('sg-method-panel');
      return {
        titles: [...document.querySelectorAll('.sg-axis-title')].map((t) => t.textContent).join(' / '),
        ends: [...document.querySelectorAll('.sg-axis-end')].map((t) => t.textContent).join(' / '),
        regions: document.querySelectorAll('.sg-region').length,
        retired: shown(panel.querySelector('.sg-check')),
        sliders: [...panel.querySelectorAll('input[type=range]')].filter(shown).length,
        panel: panel.textContent,
        pcs: document.querySelectorAll('.sg-pcs').length,
        summary: document.getElementById('sg-caveat-text').textContent,
        label: document.getElementById('sg-method').selectedOptions[0].textContent,
      };
    })()`);
  const hasOwn = await evaluate(
    `[...document.querySelectorAll('#sg-method option')].some((o) => o.value === 'espace_social')`,
  );
  if (hasOwn) {
    await chooseMethod('espace_social');
    const social = await ownAxes();
    check(
      'espace social : ses axes, pas ceux du graphique',
      social.titles === 'Structure du capital / Volume du capital' &&
        social.ends.includes('capital culturel') &&
        social.ends.includes('capital économique') &&
        social.regions === 0,
      JSON.stringify(social),
    );
    check(
      'espace social : les poids règlent le capital culturel, sans score imposé',
      social.sliders === 7 && !social.retired && social.panel.includes('capital culturel'),
      social.panel,
    );
    check('espace social : sa réserve', social.summary.includes('Bourdieu'), social.summary);
    await chooseMethod('acm_individus');
    const acm = await ownAxes();
    check(
      'ACM sur les individus : exploratoire, sans réglage, axes lus',
      acm.label.includes('exploratoire') &&
        acm.sliders === 0 &&
        acm.panel.includes('pas recalculable') &&
        acm.titles.startsWith('Axe 1') &&
        acm.regions === 0 &&
        acm.pcs === 30,
      JSON.stringify(acm),
    );
    await chooseMethod('ranks');
    const back = await ownAxes();
    check(
      'les axes communs reviennent',
      back.titles === 'Exploitation / Domination' && back.regions > 0 && back.retired,
      JSON.stringify(back),
    );
  }

  // --- Clavier et infobulle ------------------------------------------------------------------------
  const tooltip = await evaluate(`(() => {
    const start = document.querySelector('.sg-pcs[tabindex="0"]');
    start.focus();
    const first = document.querySelector('.sg-tooltip').textContent;
    const visible = !document.querySelector('.sg-tooltip').hidden;
    start.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const second = document.querySelector('.sg-tooltip').textContent;
    const moved = document.activeElement !== start;
    const roving = document.querySelectorAll('.sg-pcs[tabindex="0"]').length;
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const hidden = document.querySelector('.sg-tooltip').hidden;
    document.activeElement.blur();
    return { first, second, visible, moved, roving, hidden };
  })()`);
  check(
    'infobulle au focus',
    tooltip.visible && tooltip.first.includes('Part de la population'),
    tooltip.first,
  );
  check(
    'statuts dans l’infobulle',
    tooltip.first.includes('Patrimoine') && tooltip.first.includes('Niveau de vie'),
    tooltip.first,
  );
  check('flèches du clavier', tooltip.moved && tooltip.first !== tooltip.second);
  check('tabindex itinérant', tooltip.roving === 1, String(tooltip.roving));
  check('Échap masque l’infobulle', tooltip.hidden);

  // Statuts et ex æquo : on parcourt toutes les infobulles de PCS réellement affichées.
  const notes = await evaluate(`(() => {
    const reserve = document.getElementById('sg-reserves').textContent;
    const tip = document.querySelector('.sg-tooltip');
    let tied = 0;
    let imputed = 0;
    let unknown = 0;
    let firstTied = null;
    let longest = null;
    let longestLength = 0;
    const overflowing = [];
    const chart = document.querySelector('.sg-chart').getBoundingClientRect();
    for (const point of document.querySelectorAll('.sg-pcs')) {
      point.focus();
      const text = tip.textContent;
      const r = tip.getBoundingClientRect();
      if (r.left < chart.left - 1 || r.right > chart.right + 1 || r.top < chart.top - 1 || r.bottom > chart.bottom + 1) {
        overflowing.push(point.getAttribute('data-key'));
      }
      if (text.length > longestLength) {
        longestLength = text.length;
        longest = point.getAttribute('data-key');
      }
      if (text.includes('Ex æquo')) {
        tied++;
        firstTied ??= point.getAttribute('data-key');
      }
      if (text.includes('≈ imputé')) imputed++;
      if (text.includes('statut inconnu')) unknown++;
    }
    document.activeElement.blur();
    return {
      tied,
      imputed,
      unknown,
      firstTied,
      longest,
      overflowing,
      reserveShown: document.getElementById('sg-caveat-text').textContent.length > 0,
      reserveTies: reserve.includes('Ex æquo'),
      reserveImputed: /[1-9][0-9]* valeurs? imputées?/.test(reserve),
      reserveDefinition: reserve.includes('composition du patrimoine'),
      reserveStatus: /Réserve sur l'axe/.test(reserve),
    };
  })()`);
  console.log(
    `[smoke] infobulles : ${notes.imputed} PCS avec valeur imputée, ` +
      `${notes.unknown} de statut inconnu, ${notes.tied} ex æquo ; ` +
      `réserve ${notes.reserveShown ? 'affichée' : 'absente'}`,
  );
  // La réserve résumée reste affichée et la définition de l'axe X figure dans son détail ; les autres
  // réserves suivent ce que disent les infobulles.
  check(
    'définition de l’axe X toujours affichée',
    notes.reserveShown && notes.reserveDefinition,
    JSON.stringify(notes),
  );
  check(
    'réserve de statut s’il y a imputation ou statut inconnu',
    !(notes.imputed > 0 || notes.unknown > 0) || notes.reserveStatus,
    JSON.stringify(notes),
  );
  check('réserve d’ex æquo s’il y en a', notes.tied === 0 || notes.reserveTies);
  check('ex æquo dans l’infobulle si la réserve en annonce', !notes.reserveTies || notes.tied >= 2);
  check('marqueur « imputé » si la réserve en annonce', !notes.reserveImputed || notes.imputed > 0);
  check(
    'infobulles contenues dans le graphique',
    notes.overflowing.length === 0,
    notes.overflowing.join(', '),
  );
  await chooseMethod(shownMethod);
  // Capture de l'infobulle la plus chargée : ex æquo s'il y en a, sinon le plus long libellé.
  await evaluate(
    `document.querySelector('.sg-pcs[data-key="${notes.firstTied ?? notes.longest}"]').focus()`,
  );
  await sleep(100);
  await shot('03b-infobulle-pcs', false);
  await evaluate('document.activeElement.blur()');

  // Survol réel à la souris d'un petit disque, puis d'un losange
  const hover = await evaluate(`(() => {
    const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    document.querySelector('#sg-chart-host').scrollIntoView({ block: 'center' });
    return { cand: box('.sg-cand') };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: hover.cand.x,
    y: hover.cand.y,
  });
  await sleep(100);
  const hoverTip = await evaluate(
    `({ hidden: document.querySelector('.sg-tooltip').hidden, text: document.querySelector('.sg-tooltip').textContent, compo: document.querySelectorAll('.sg-tooltip__bars li').length })`,
  );
  check('infobulle au survol', !hoverTip.hidden, hoverTip.text);
  await shot('03-infobulle', false);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });

  // --- Légende, filtres, zoom ----------------------------------------------------------------------
  const filtered = await evaluate(`(async () => {
    const chip = document.querySelector('#sg-legend-groups button[data-id="g:6"]');
    const n0 = document.querySelectorAll('.sg-pcs').length;
    chip.click();
    await new Promise((r) => setTimeout(r, 400));
    const n1 = document.querySelectorAll('.sg-pcs').length;
    const pressed = chip.getAttribute('aria-pressed');
    const hash = location.hash;
    chip.click();
    await new Promise((r) => setTimeout(r, 400));
    const n2 = document.querySelectorAll('.sg-pcs').length;
    const label0 = document.querySelectorAll('.sg-tick-x').length;
    document.getElementById('sg-zoom-in').click();
    await new Promise((r) => setTimeout(r, 500));
    const zoomed = [...document.querySelectorAll('.sg-tick-x')].map((t) => t.textContent).join(' ');
    document.getElementById('sg-zoom-reset').click();
    await new Promise((r) => setTimeout(r, 500));
    const reset = [...document.querySelectorAll('.sg-tick-x')].map((t) => t.textContent).join(' ');
    return { n0, n1, n2, pressed, hash, label0, zoomed, reset };
  })()`);
  check(
    'légende cliquable',
    filtered.n1 < filtered.n0 && filtered.pressed === 'false' && filtered.n2 === filtered.n0,
    JSON.stringify(filtered),
  );
  check('zoom', filtered.zoomed !== filtered.reset, `${filtered.zoomed} | ${filtered.reset}`);
  check(
    'graduations de référence après remise à zéro',
    filtered.reset.split(' ').length === 5,
    filtered.reset,
  );

  // --- Navigation : molette sans Ctrl, cadrage sur les électorats, mini-carte --------------------------
  const wheelBefore = await evaluate(
    `[...document.querySelectorAll('.sg-tick-x')].map((t) => t.textContent).join(' ')`,
  );
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 800,
    y: 400,
    deltaX: 0,
    deltaY: -400,
  });
  await sleep(300);
  const wheelAfter = await evaluate(
    `[...document.querySelectorAll('.sg-tick-x')].map((t) => t.textContent).join(' ')`,
  );
  check(
    'zoom à la molette, sans Ctrl',
    wheelBefore !== wheelAfter,
    `${wheelBefore} | ${wheelAfter}`,
  );
  await evaluate(`document.getElementById('sg-zoom-reset').click()`);
  await settle();
  const framed = await evaluate(`(async () => {
    document.getElementById('sg-zoom-electorates').click();
    await new Promise((r) => setTimeout(r, 900));
    const box = document.querySelector('.sg-svg').getBoundingClientRect();
    const inside = [...document.querySelectorAll('.sg-cand')].every((c) => {
      const r = c.getBoundingClientRect();
      return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom;
    });
    const mini = document.querySelector('.sg-minimap');
    return { inside, mini: !!mini && getComputedStyle(mini).display !== 'none' };
  })()`);
  check('cadrage : tous les électorats restent visibles', framed.inside);
  check('mini-carte affichée une fois zoomé', framed.mini);
  await shot('03c-electorats-cadres', false);
  await evaluate(`document.getElementById('sg-zoom-reset').click()`);
  await settle();
  const miniHidden = await evaluate(
    `getComputedStyle(document.querySelector('.sg-minimap')).display === 'none'`,
  );
  check('mini-carte masquée sans zoom', miniHidden);

  // --- Les axes restent au bord de la carte : panneau ouvert, zoomé, déplacé --------------------------
  const axisAudit = `(() => {
    const clip = document.querySelector('.sg-svg clipPath rect');
    const box = { x: +clip.getAttribute('x'), y: +clip.getAttribute('y'), w: +clip.getAttribute('width'), h: +clip.getAttribute('height') };
    const ctm = document.querySelector('.sg-plot').getScreenCTM();
    const left = box.x * ctm.a + ctm.e;
    const bottom = (box.y + box.h) * ctm.d + ctm.f;
    const yTicks = [...document.querySelectorAll('.sg-tick-y')].map((t) => t.getBoundingClientRect());
    const xTicks = [...document.querySelectorAll('.sg-tick-x')].map((t) => t.getBoundingClientRect());
    const clipped = !!document.querySelector('.sg-clipped .sg-marks') && !!document.querySelector('.sg-clipped .sg-grid');
    const grid = [...document.querySelectorAll('.sg-grid line')].every((l) => +l.getAttribute('x1') >= box.x - 1 && +l.getAttribute('x2') <= box.x + box.w + 1 && +l.getAttribute('y1') >= box.y - 1 && +l.getAttribute('y2') <= box.y + box.h + 1);
    return {
      clipped,
      grid,
      rules: document.querySelectorAll('.sg-axis-rule').length,
      yInBand: yTicks.length > 0 && yTicks.every((r) => r.right <= left + 1),
      xInBand: xTicks.length > 0 && xTicks.every((r) => r.top >= bottom - 1),
    };
  })()`;
  const checkAxes = async (label) => {
    const a = await evaluate(axisAudit);
    check(
      `axes au bord de la carte : ${label}`,
      a.clipped && a.grid && a.rules === 2 && a.yInBand && a.xInBand,
      JSON.stringify(a),
    );
  };
  await checkAxes('vue d’ensemble');
  await openPanel('method');
  await settle();
  await checkAxes('panneau ouvert');
  await evaluate(`document.getElementById('sg-zoom-electorates').click()`);
  await settle();
  await checkAxes('panneau ouvert et zoomé');
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 800,
    y: 400,
    button: 'left',
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 650, y: 320, buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 650,
    y: 320,
    button: 'left',
    clickCount: 1,
  });
  await settle();
  await checkAxes('panneau ouvert, zoomé et déplacé');
  await openPanel('method');
  await settle();
  await checkAxes('panneau refermé en gardant le zoom');
  await evaluate(`document.getElementById('sg-zoom-reset').click()`);
  await settle();

  // --- Bulles : pas de zone, une aire qui dit la taille --------------------------------------------------
  const bubbles = await evaluate(`(() => {
    const areas = [...document.querySelectorAll('.sg-cand__area')];
    return {
      halos: document.querySelectorAll('.sg-territory').length,
      ellipses: document.querySelectorAll('.sg-ellipse:not(.sg-exiting)').length,
      areas: areas.length,
      dots: document.querySelectorAll('.sg-cand__dot').length,
    };
  })()`);
  check('aucun halo autour des catégories', bubbles.halos === 0);
  check('pas d’ellipse par défaut', bubbles.ellipses === 0, String(bubbles.ellipses));
  check(
    'une bulle et un point par électorat',
    bubbles.areas > 0 && bubbles.areas === bubbles.dots,
    JSON.stringify(bubbles),
  );

  // --- Sélection : un clic, l'URL, Échap ----------------------------------------------------------------
  const selected = await evaluate(`(async () => {
    const point = document.querySelector('.sg-cand');
    const key = point.getAttribute('data-key');
    const click = () => {
      const r = point.getBoundingClientRect();
      point.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    };
    click();
    await new Promise((res) => setTimeout(res, 600));
    const marked = document.querySelectorAll('.sg-point--selected').length;
    const hash = location.hash;
    click();
    await new Promise((res) => setTimeout(res, 600));
    return { key, marked, hash, after: document.querySelectorAll('.sg-point--selected').length };
  })()`);
  check('clic : repère sélectionné', selected.marked === 1, JSON.stringify(selected));
  check('sélection dans l’URL', selected.hash.includes('s=c'), selected.hash);
  check('second clic : sélection retirée', selected.after === 0, JSON.stringify(selected));

  // --- Croisements : un électorat, une catégorie, un duel --------------------------------------------
  // Les données d'exemple n'ont ni familles ni projection : ces parcours visent les vraies données.
  const hasRealData = await evaluate(`document.getElementById('sg-banner').hidden`);
  if (hasRealData) {
    await chooseElection('2022_presidentielle_t1');
    const selectKey = async (key) => {
      await evaluate(
        `location.hash = ${JSON.stringify(`e=2022_presidentielle_t1&s=${encodeURIComponent(key)}`)}`,
      );
      await settle();
    };
    await selectKey('c:macron');
    const electorate = await evaluate(`({
      open: !document.getElementById('sg-inspector').hidden,
      spokes: document.querySelectorAll('.sg-spoke').length,
      rows: document.querySelectorAll('#sg-inspector-representation li').length,
      neighbors: document.querySelectorAll('#sg-inspector-neighbors .sg-neighbors__row').length,
      history: document.querySelectorAll('#sg-inspector-history .sg-history__row').length,
      current: document.querySelector('#sg-inspector-history [aria-current="true"]')?.dataset.election,
      dim: document.querySelectorAll('.sg-dim').length,
    })`);
    check('électorat : inspecteur ouvert', electorate.open);
    check('électorat : lignes vers les groupes', electorate.spokes >= 5, String(electorate.spokes));
    check(
      'électorat : sur- et sous-représentation',
      electorate.rows === 6,
      String(electorate.rows),
    );
    check('électorat : voisins', electorate.neighbors > 0);
    check(
      'électorat : historique de la famille',
      electorate.history === 7,
      String(electorate.history),
    );
    check('électorat : scrutin courant marqué', electorate.current === '2022_presidentielle_t1');
    check('électorat : le reste s’estompe', electorate.dim > 0);
    await shot('10-electorat', false);

    await evaluate(
      `document.querySelector('#sg-inspector-history [data-election="2017_presidentielle_t1"]').click()`,
    );
    await settle();
    const moved = await evaluate(
      `({ hash: location.hash, shown: document.querySelector('#sg-timeline input:checked')?.value })`,
    );
    check(
      'historique : la ligne mène au scrutin',
      moved.shown === '2017_presidentielle_t1',
      moved.shown,
    );
    await selectKey('c:macron');

    await evaluate(`document.querySelector('#sg-inspector-neighbors [data-compare]').click()`);
    await settle();
    const duel = await evaluate(`({
      rows: document.querySelectorAll('#sg-inspector-duel .sg-duel__row').length,
      gap: document.getElementById('sg-duel-gap')?.textContent ?? '',
      distance: document.getElementById('sg-duel-distance')?.textContent ?? '',
    })`);
    check(
      'duel : barres et écarts',
      duel.rows === 6 && duel.gap.length > 0 && duel.distance.length > 0,
      JSON.stringify(duel),
    );
    await shot('11-duel', false);

    await selectKey('p:62');
    const lens = await evaluate(`({
      banner: !document.getElementById('sg-lens-banner').hidden,
      votes: document.querySelectorAll('#sg-inspector-votes li').length,
      note: document.getElementById('sg-inspector-vote-note')?.textContent ?? '',
    })`);
    check('catégorie : vue depuis le groupe', lens.banner, JSON.stringify(lens));
    check('catégorie : vote du groupe', lens.votes > 5, String(lens.votes));
    check('catégorie : le vote est celui du groupe', /groupe/.test(lens.note), lens.note);
    await shot('12-vue-depuis-un-groupe', false);
    await evaluate(`document.getElementById('sg-lens-reset').click()`);
    await settle();
    const lensClosed = await evaluate(
      `document.getElementById('sg-lens-banner').hidden && document.getElementById('sg-inspector').hidden`,
    );
    check('catégorie : retour à la carte', lensClosed);

    await selectKey('p:81');
    const noVote = await evaluate(`!!document.getElementById('sg-inspector-novote')`);
    check('groupe sans donnée de vote signalé', noVote);
    await evaluate(`location.hash = 'e=2022_presidentielle_t1'`);
    await settle();

    // --- Croiser : axes libres et carte de proximité -----------------------------------------------
    await evaluate(`location.hash = 'e=2022_presidentielle_t1&p=cross&ax=niveau_vie&ay=bac5'`);
    await settle();
    const free = await evaluate(`({
      pcs: document.querySelectorAll('.sg-pcs').length,
      note: document.getElementById('sg-cross-note')?.textContent ?? '',
      diagonal: getComputedStyle(document.querySelector('.sg-diagonal')).display,
      title: [...document.querySelectorAll('.sg-axis-title')].map((t) => t.textContent).join(' / '),
    })`);
    check(
      'axes libres : 30 catégories, annoncées',
      free.pcs === 30 && /30/.test(free.note),
      JSON.stringify(free),
    );
    check('axes libres : titres des variables', !/Exploitation/.test(free.title), free.title);
    await shot('13-axes-libres', false);
    await evaluate(`location.hash = 'e=2022_presidentielle_t1&vue=prox&p=cross'`);
    await settle();
    const proximity = await evaluate(
      `({ pcs: document.querySelectorAll('.sg-pcs').length, cands: document.querySelectorAll('.sg-cand').length, ticks: document.querySelectorAll('.sg-tick-x').length })`,
    );
    check(
      'proximité : électorats seuls, sans axes',
      proximity.pcs === 0 && proximity.cands > 0 && proximity.ticks === 0,
      JSON.stringify(proximity),
    );
    await shot('14-proximite', false);
    await evaluate(`location.hash = 'e=2022_presidentielle_t1'`);
    await settle();

    // --- Croiser : l'aire des bulles réagit ---------------------------------------------------------
    const radii = `Object.fromEntries([...document.querySelectorAll('.sg-cand')].map((c) => [c.dataset.key, +c.querySelector('.sg-cand__area').getAttribute('r')]))`;
    await evaluate(`location.hash = 'e=2022_presidentielle_t1'`);
    await settle();
    const registeredRadii = await evaluate(radii);
    const pcsDisc = await evaluate(
      `(() => { const d = document.querySelector('.sg-pcs[data-key="p:62"]'); return +d.getAttribute('r'); })()`,
    );
    const ratio = (registeredRadii['c:macron'] / registeredRadii['c:le-pen']) ** 2;
    check(
      'aire des bulles : part des inscrits',
      Math.abs(ratio - 27.5 / 23.3) < 0.15,
      String(ratio),
    );
    check(
      'bulles et disques à la même échelle',
      pcsDisc > 0 && registeredRadii['c:abstention'] > pcsDisc,
    );
    await evaluate(`location.hash = 'e=2022_presidentielle_t1&bs=dans%3A6&p=cross'`);
    await settle();
    const workersRadii = await evaluate(radii);
    const sizeKey = await evaluate(`document.getElementById('sg-size-key').textContent`);
    check(
      'croiser : l’aire change avec la mesure',
      workersRadii['c:le-pen'] !== registeredRadii['c:le-pen'] &&
        workersRadii['c:macron'] < workersRadii['c:le-pen'],
      JSON.stringify(workersRadii),
    );
    check('croiser : la légende dit ce que mesure l’aire', /Ouvriers/.test(sizeKey), sizeKey);
    await shot('13b-aire-croisee', false);
    await evaluate(`location.hash = 'e=2022_presidentielle_t1&s=p%3A63&p=cross'`);
    await settle();
    const lensSize = await evaluate(`({
      disabled: document.getElementById('sg-bubble-size').disabled,
      note: document.getElementById('sg-size-note').textContent,
      key: document.getElementById('sg-size-key').textContent,
    })`);
    check(
      'croiser : une catégorie choisie prend la main sur l’aire, et le menu le dit',
      lensSize.disabled &&
        /vote de son groupe/.test(lensSize.note) &&
        /vote du groupe/.test(lensSize.key),
      JSON.stringify(lensSize),
    );
    await evaluate(
      `location.hash = 'e=2022_presidentielle_t1&ax=patrimoine&ay=bac5&bs=var%3Apatrimoine&p=cross'`,
    );
    await settle();
    const wealthRadii = await evaluate(radii);
    const wealthPlaces = await evaluate(
      `document.querySelector('.sg-cand[data-key="c:macron"]').getAttribute('transform')`,
    );
    await evaluate(
      `location.hash = 'e=2022_presidentielle_t1&ax=niveau_vie&ay=cap&bs=var%3Apatrimoine&p=cross'`,
    );
    await settle();
    const otherPlaces = await evaluate(
      `document.querySelector('.sg-cand[data-key="c:macron"]').getAttribute('transform')`,
    );
    check(
      'croiser : les électorats bougent avec les axes',
      wealthPlaces !== otherPlaces,
      `${wealthPlaces} / ${otherPlaces}`,
    );
    check(
      'croiser : part du total d’une variable',
      wealthRadii['c:macron'] > wealthRadii['c:le-pen'],
      JSON.stringify(wealthRadii),
    );
    await evaluate(`location.hash = 'e=2022_presidentielle_t1'`);
    await settle();

    // --- Frise : lecture, trajectoires, anneaux -----------------------------------------------------
    const played = await evaluate(`(async () => {
      const seen = new Set();
      const button = document.getElementById('sg-timeline-play');
      document.querySelector('#sg-timeline input[value="1995_presidentielle_t1"]').click();
      await new Promise((r) => setTimeout(r, 300));
      seen.add(document.querySelector('#sg-timeline input:checked')?.value);
      button.click();
      for (let i = 0; i < 120 && button.getAttribute('aria-pressed') === 'true'; i++) {
        seen.add(document.querySelector('#sg-timeline input:checked')?.value);
        await new Promise((r) => setTimeout(r, 250));
      }
      // La lecture s'arrête en arrivant sur la dernière étape, avant le relevé suivant.
      seen.add(document.querySelector('#sg-timeline input:checked')?.value);
      const stops = [...document.querySelectorAll('#sg-timeline input[type="radio"]')].map((o) => o.value).filter((v) => v !== 'population');
      return { seen: [...seen], stops, stopped: button.getAttribute('aria-pressed') !== 'true' };
    })()`);
    check('lecture : s’arrête en fin de frise', played.stopped, JSON.stringify(played.seen));
    check(
      'lecture : passe par chaque étape',
      played.stops.every((s) => played.seen.includes(s)),
      `vues ${played.seen.join(', ')} ; attendues ${played.stops.join(', ')}`,
    );
    // La lecture est fluide : un même repère glisse d'un scrutin à l'autre, sans saut ni pause.
    const glide = await evaluate(`(async () => {
      document.querySelector('#sg-timeline input[value="2017_presidentielle_t1"]').click();
      await new Promise((r) => setTimeout(r, 900));
      const node = document.querySelector('.sg-cand[data-key="c:le-pen"]');
      const button = document.getElementById('sg-timeline-play');
      const firstKey = node.getAttribute('data-key');
      button.click();
      await new Promise((r) => setTimeout(r, 900));
      const read = () => {
        const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(node.getAttribute('transform') ?? '');
        return m ? [Number(m[1]), Number(m[2])] : null;
      };
      let last = read();
      let maxStep = 0;
      let still = 0;
      let frames = 0;
      let longest = 0;
      let then = performance.now();
      const keys = new Set([firstKey]);
      const head = document.getElementById('sg-timeline-head');
      const heads = new Set();
      const end = then + 3000;
      while (performance.now() < end) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        longest = Math.max(longest, now - then);
        then = now;
        keys.add(node.getAttribute('data-key'));
        heads.add(head?.style.left);
        const p = read();
        if (!p || !last) continue;
        const d = Math.hypot(p[0] - last[0], p[1] - last[1]);
        maxStep = Math.max(maxStep, d);
        if (d < 0.001) still++;
        frames++;
        last = p;
      }
      const sameNode = node.isConnected;
      button.click();
      await new Promise((r) => setTimeout(r, 500));
      const playingClass = document.querySelector('.sg-svg').classList.contains('sg-playing');
      return { keys: [...keys], sameNode, maxStep, still, frames, longest, playingClass, heads: heads.size, headHidden: head?.hidden, labels: document.querySelectorAll('.sg-play-label').length };
    })()`);
    check(
      'lecture : le repère garde son identité entre scrutins',
      glide.sameNode && glide.keys.length >= 2,
      JSON.stringify(glide),
    );
    check('lecture : pas de saut d’une image à l’autre', glide.maxStep < 40, JSON.stringify(glide));
    check(
      'lecture : pas de pause entre deux scrutins',
      glide.frames > 20 && glide.still <= 3,
      JSON.stringify(glide),
    );
    check('lecture : les images s’enchaînent vite', glide.longest < 200, JSON.stringify(glide));
    check(
      'lecture : un repère avance sur la frise',
      glide.heads > 20 && glide.headHidden === true,
      JSON.stringify(glide),
    );
    check(
      'lecture : retour aux libellés placés',
      !glide.playingClass && glide.labels === 0,
      JSON.stringify(glide),
    );
    console.log(
      `[smoke] lecture : ${glide.frames} images en 3 s, plus longue ${glide.longest.toFixed(0)} ms, plus grand pas ${glide.maxStep.toFixed(1)} px`,
    );
    // Au-delà, l'œil voit un à-coup, même sur une machine chargée.
    check('lecture : aucune image trop longue', glide.longest < 120, `${glide.longest} ms`);
    await evaluate(`document.getElementById('sg-zoom-reset').click()`);
    await evaluate(`location.hash = 'e=2024_legislatives_t1&rg=1&s=c%3Arn'`);
    await settle();
    const trails = await evaluate(`({
      trails: document.querySelectorAll('path.sg-trail').length,
      strong: document.querySelectorAll('path.sg-trail--strong').length,
      rings: document.querySelectorAll('.sg-ring[data-group]').length,
      key: !document.getElementById('sg-rings-key').hidden,
    })`);
    check(
      'trajectoires dessinées, celle du choix appuyée',
      trails.trails > 0 && trails.strong > 0,
      JSON.stringify(trails),
    );
    check(
      'anneaux : six groupes et leur légende',
      trails.rings === 6 && trails.key,
      JSON.stringify(trails),
    );
    await shot('15-trajectoires-anneaux', false);

    // --- Projection 2027 ---------------------------------------------------------------------------
    await evaluate(`location.hash = 'e=projection_2027'`);
    await settle();
    const project = await evaluate(`(() => {
      const verdict = document.getElementById('sg-projection-verdict');
      const r = verdict.getBoundingClientRect();
      return {
        text: verdict.textContent,
        visible: r.width > 0 && r.height > 0 && r.bottom <= innerHeight,
        ranges: document.querySelectorAll('.sg-range[data-bloc]').length,
        errors: document.querySelectorAll('.sg-projection-error').length,
        arrows: document.querySelectorAll('.sg-projection-arrow').length,
        heading: document.getElementById('sg-chart-heading').textContent,
        summary: document.getElementById('sg-caveat-text').textContent,
      };
    })()`);
    check(
      '2027 : résultat du test visible',
      project.visible && /moins bien/.test(project.text),
      project.text,
    );
    check(
      '2027 : chiffres du test',
      /0,78/.test(project.text) && /0,74/.test(project.text),
      project.text,
    );
    check(
      '2027 : données arrêtées en juillet 2024',
      /juillet 2024/.test(project.text),
      project.text,
    );
    check('2027 : fourchettes par bloc', project.ranges === 5, String(project.ranges));
    check(
      '2027 : flèches et cercles d’erreur',
      project.arrows > 0 && project.errors > 0,
      JSON.stringify(project),
    );
    const bubbles = await evaluate(`(() => {
      const shown = [...document.querySelectorAll('.sg-projection-error')].filter((e) => e.style.display !== 'none');
      const areas = [...document.querySelectorAll('.sg-cand .sg-cand__area')].map((c) => Number(c.getAttribute('r')));
      return { errorsShown: shown.length, bubbles: areas.filter((r) => r > 0).length, key: document.getElementById('sg-size-key').textContent };
    })()`);
    check(
      '2027 : une bulle par parti, au dernier scrutin, sans zone par défaut',
      bubbles.errorsShown === 0 && bubbles.bubbles >= 5 && /dernier scrutin/.test(bubbles.key),
      JSON.stringify(bubbles),
    );
    const askedErrors = await evaluate(`(async () => {
      document.getElementById('sg-projection-errors').click();
      await new Promise((r) => setTimeout(r, 200));
      const shown = [...document.querySelectorAll('.sg-projection-error')].filter((e) => e.style.display !== 'none').length;
      document.getElementById('sg-projection-errors').click();
      await new Promise((r) => setTimeout(r, 200));
      return shown;
    })()`);
    check('2027 : marges d’erreur à la demande', askedErrors > 0, String(askedErrors));
    check(
      '2027 : présentée comme une projection',
      /Projection 2027/.test(project.heading),
      project.heading,
    );
    await shot('16-projection-immobile', false);
    const scenario = await evaluate(`(async () => {
      const before = document.querySelector('.sg-cand').getAttribute('transform');
      document.querySelector('#sg-scenario input[value="trend"]').click();
      await new Promise((r) => setTimeout(r, 900));
      return { before, after: document.querySelector('.sg-cand').getAttribute('transform'), hash: location.hash };
    })()`);
    check(
      '2027 : le scénario déplace les électorats',
      scenario.before !== scenario.after,
      JSON.stringify(scenario),
    );
    check('2027 : scénario dans l’URL', scenario.hash.includes('sc=trend'), scenario.hash);
    await shot('17-projection-tendance', false);
    await evaluate(`location.hash = 'e=projection_2027&s=c%3Arn'`);
    await settle();
    const family = await evaluate(`({
      projection: !!document.getElementById('sg-inspector-projection'),
      history: document.querySelectorAll('#sg-inspector-history .sg-history__row').length,
      compare: !!document.getElementById('sg-inspector-compare'),
      tags: document.querySelectorAll('.sg-trail-tag').length,
    })`);
    check(
      '2027 : détail de la famille dans l’inspecteur',
      family.projection && family.history === 12,
      JSON.stringify(family),
    );
    check('2027 : pas de duel sans composition', !family.compare, JSON.stringify(family));
    await shot('18-projection-famille', false);
    await evaluate(`location.hash = 'e=2022_presidentielle_t1'`);
    await settle();

    // 2027 depuis un croisement, et le retour : les repères doivent rester dans le cadre.
    const clickStop = (id) =>
      evaluate(`(async () => {
        document.querySelector('.sg-timeline input[value="' + ${JSON.stringify(id)} + '"]').click();
        await new Promise((r) => setTimeout(r, 1100));
      })()`);
    const inFrame = () =>
      evaluate(`(() => {
        // Un rectangle de clipPath n'a pas de boîte à l'écran : on lit ses attributes, posés dans le SVG.
        const svg = document.querySelector('.sg-svg').getBoundingClientRect();
        const rect = document.querySelector('.sg-svg clipPath rect');
        const left = svg.left + Number(rect.getAttribute('x'));
        const top = svg.top + Number(rect.getAttribute('y'));
        const right = left + Number(rect.getAttribute('width'));
        const bottom = top + Number(rect.getAttribute('height'));
        const inside = (el) => {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          return x >= left && x <= right && y >= top && y <= bottom;
        };
        const visible = (s) => [...document.querySelectorAll(s)].filter(inside).length;
        return {
          cands: visible('.sg-cand'),
          pcs: visible('.sg-pcs'),
          labels: [...document.querySelectorAll('.sg-label')].filter((l) => l.getAttribute('opacity') !== '0').length,
          errors: visible('.sg-projection-item'),
          panel: !document.getElementById('sg-panel').hidden,
          card: !document.getElementById('sg-projection').hidden,
          waiting: document.getElementById('sg-projection-suspended').textContent,
          axis: document.querySelector('.sg-axis-title')?.textContent ?? '',
          hash: location.hash,
        };
      })()`);
    const paths = [
      {
        name: 'axes libres',
        hash: 'e=2022_presidentielle_t1&p=cross&ax=patrimoine&ay=bac5',
        back: /Patrimoine/,
        waiting: /axes libres/,
        cands: 13,
        pcs: 30,
      },
      {
        name: 'préréglage',
        hash: 'e=2022_presidentielle_t1&p=cross&ax=niveau_vie&ay=bac5&ac=patrimoine',
        back: /Niveau de vie/,
        waiting: /axes libres/,
        cands: 13,
        pcs: 30,
      },
      {
        name: 'proximité',
        hash: 'e=2022_presidentielle_t1&p=cross&vue=prox',
        back: /^$/,
        waiting: /proximité/,
        cands: 12,
        pcs: 0,
      },
    ];
    for (const path of paths) {
      await evaluate(`location.hash = '${path.hash}'`);
      await settle();
      await clickStop('projection_2027');
      const at = await inFrame();
      check(
        `2027 depuis ${path.name} : un seul panneau, les axes de la carte, tout dans le cadre`,
        !at.panel &&
          at.card &&
          at.errors >= 5 &&
          at.cands >= 5 &&
          path.waiting.test(at.waiting) &&
          !/Patrimoine|Niveau de vie/.test(at.axis),
        JSON.stringify(at),
      );
      await clickStop('2022_presidentielle_t1');
      const back = await inFrame();
      check(
        `2022 après 2027 depuis ${path.name} : le croisement revient, entier`,
        !back.card &&
          path.back.test(back.axis) &&
          back.cands >= path.cands &&
          back.pcs === path.pcs,
        JSON.stringify(back),
      );
    }
    await evaluate(`location.hash = 'e=2022_presidentielle_t1'`);
    await settle();
    const before2027 = await inFrame();
    await clickStop('projection_2027');
    await evaluate(`document.querySelector('#sg-scenario input[value="trend"]').click()`);
    await sleep(900);
    await clickStop('2022_presidentielle_t1');
    await sleep(300);
    const after2027 = await inFrame();
    check(
      '2022 après 2027 : la carte entière, comme avant',
      after2027.labels === before2027.labels && after2027.pcs === before2027.pcs,
      JSON.stringify({ before2027, after2027 }),
    );
    check(
      '2022 après 2027 : le scénario quitte l’URL',
      !/sc=/.test(after2027.hash),
      after2027.hash,
    );

    // --- Recherche « Où suis-je ? » ---------------------------------------------------------------------
    const searched = await evaluate(`(async () => {
      const input = document.getElementById('sg-search-input');
      input.focus();
      input.value = 'infirmière';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
      const first = document.querySelector('#sg-search-list [role="option"]');
      const detail = first?.textContent ?? '';
      const key = first?.dataset.key;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 700));
      return { key, detail, hash: location.hash, inspector: !document.getElementById('sg-inspector').hidden, closed: document.getElementById('sg-search-list').hidden };
    })()`);
    check(
      'recherche : un métier mène à sa catégorie',
      searched.key === 'p:43',
      JSON.stringify(searched),
    );
    check(
      'recherche : le choix ouvre le détail',
      searched.inspector && searched.closed && searched.hash.includes('p%3A43'),
      JSON.stringify(searched),
    );
    await evaluate(`location.hash = 'e=2022_presidentielle_t1'`);
    await settle();
    await evaluate(
      `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))`,
    );
    const slash = await evaluate(`document.activeElement?.id`);
    check('recherche : raccourci « / »', slash === 'sg-search-input', String(slash));
    await evaluate(`document.activeElement.blur()`);

    // --- Visite guidée ------------------------------------------------------------------------------------
    const tour = await evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const before = location.hash;
      document.getElementById('sg-tour-open').click();
      await wait(900);
      const seen = [];
      const next = document.getElementById('sg-tour-next');
      for (let i = 0; i < 5; i++) {
        seen.push({
          step: document.getElementById('sg-tour-step').textContent,
          title: document.getElementById('sg-tour-title').textContent,
          hash: location.hash,
          selected: document.querySelectorAll('.sg-point--selected').length,
          panel: !document.getElementById('sg-panel').hidden,
        });
        if (i < 4) {
          next.click();
          await wait(900);
        }
      }
      const lastLabel = next.textContent;
      next.click();
      await wait(1000);
      return { seen, lastLabel, closed: document.getElementById('sg-tour').hidden, before, after: location.hash, panelAfter: !document.getElementById('sg-panel').hidden };
    })()`);
    check(
      'visite : cinq étapes',
      new Set(tour.seen.map((s) => s.title)).size === 5,
      JSON.stringify(tour.seen),
    );
    check(
      'visite : une catégorie, puis un électorat, sont sélectionnés',
      tour.seen[2]?.selected === 1 && tour.seen[3]?.selected === 1,
      JSON.stringify(tour.seen),
    );
    check(
      'visite : le dernier écran ouvre le panneau',
      tour.seen[4]?.panel === true,
      JSON.stringify(tour.seen),
    );
    check(
      'visite : se termine et rend la vue d’avant',
      tour.lastLabel === 'Terminer' &&
        tour.closed &&
        !tour.panelAfter &&
        tour.after === tour.before,
      JSON.stringify({
        last: tour.lastLabel,
        closed: tour.closed,
        before: tour.before,
        after: tour.after,
      }),
    );
    await settle();

    // --- « Le saviez-vous ? » -------------------------------------------------------------------------
    const fact = await evaluate(`(() => {
      const host = document.getElementById('sg-fact');
      const shown = !host.hidden && !host.classList.contains('sg-fact--compact');
      const first = host.dataset.fact;
      const text = document.querySelector('.sg-fact__text').textContent;
      document.getElementById('sg-fact-next').click();
      return { shown, first, text, second: host.dataset.fact, caveat: document.querySelector('.sg-fact__caveat').textContent };
    })()`);
    check(
      'constat affiché, avec sa réserve',
      fact.shown && fact.text.length > 20 && fact.caveat.length > 0,
      JSON.stringify(fact),
    );
    check('« Une autre » change de constat', fact.first !== fact.second, JSON.stringify(fact));
    await evaluate(`location.hash = 'e=2022_presidentielle_t1&s=c%3Amacron'`);
    await settle();
    await sleep(800);
    const compact = await evaluate(
      `document.getElementById('sg-fact').classList.contains('sg-fact--compact')`,
    );
    check('le constat se réduit quand on explore', compact);
    await evaluate(`location.hash = 'e=2022_presidentielle_t1'`);
    await settle();
    await sleep(800);
    const backOpen = await evaluate(
      `!document.getElementById('sg-fact').classList.contains('sg-fact--compact')`,
    );
    check('le constat revient après l’exploration', backOpen);
    const shown = await evaluate(`(async () => {
      while (document.getElementById('sg-fact').dataset.fact !== 'zemmour-macron') document.getElementById('sg-fact-next').click();
      document.getElementById('sg-fact-show').click();
      await new Promise((r) => setTimeout(r, 1200));
      const card = document.getElementById('sg-fact');
      return { hash: location.hash, duel: !!document.getElementById('sg-inspector-duel'), open: !card.classList.contains('sg-fact--compact') };
    })()`);
    check(
      '« Voir sur la carte » ouvre le duel du constat',
      shown.duel && shown.hash.includes('s=c'),
      JSON.stringify(shown),
    );
    check('le constat reste ouvert après « Voir sur la carte »', shown.open, JSON.stringify(shown));
    await shot('19-constat-sur-la-carte', false);
    await evaluate(
      `document.getElementById('sg-zoom-reset').click(); location.hash = 'e=2022_presidentielle_t1'`,
    );
    await settle();

    // --- « Qui est-ce ? » ----------------------------------------------------------------------------
    await openPanel('game');
    await sleep(300);
    const game = await evaluate(`(async () => {
      const options = [...document.querySelectorAll('[data-game-option]')];
      const bars = document.querySelectorAll('#sg-game-bars li, #sg-game-bars > *').length;
      const selected = document.querySelectorAll('.sg-point--selected').length;
      const inspector = !document.getElementById('sg-inspector').hidden;
      const hiding = document.body.classList.contains('sg-game-round');
      options[0].click();
      await new Promise((r) => setTimeout(r, 200));
      return { options: options.length, bars, selected, inspector, hiding, feedback: document.getElementById('sg-game-feedback').textContent, score: document.getElementById('sg-game-score').textContent };
    })()`);
    check('jeu : trois noms proposés', game.options === 3, JSON.stringify(game));
    check('jeu : composition affichée', game.bars > 0, JSON.stringify(game));
    check('jeu : réponse non révélée', !game.inspector && game.hiding, JSON.stringify(game));
    check(
      'jeu : réaction et score',
      game.feedback.length > 0 && game.score.length > 0,
      JSON.stringify(game),
    );
    await shot('20-jeu', false);
    await openPanel('game');
    await settle();
  }

  // --- À propos : crédits exigés -------------------------------------------------------------------
  const about = await evaluate(`(() => {
    document.getElementById('sg-about-open').click();
    const d = document.getElementById('sg-about');
    const open = d.open;
    const text = d.textContent;
    const links = [...d.querySelectorAll('a')].map((a) => a.href);
    const methods = document.querySelectorAll('#sg-about-methods li').length;
    return { open, text, links, methods };
  })()`);
  check('À propos s’ouvre', about.open);
  check(
    'crédit Chris et PaduTeam',
    about.text.includes('Saint-Graphique original : Chris et la PaduTeam (revue Positions)'),
  );
  check(
    'crédit JnthnBS',
    about.text.includes("source de l'algorithme reconstruit") &&
      about.text.includes('JnthnBS/saint-graphique'),
  );
  check('mention non officielle', about.text.includes('Projet non officiel, sans affiliation'));
  check(
    'instituts de sondage cités',
    ['Ifop', 'Ipsos', 'CSA'].every((name) => about.text.includes(name)),
  );
  for (const url of [
    'https://positions-revue.fr',
    'https://www.youtube.com/@PaduTeam',
    'https://www.youtube.com/@Positions_revue',
    'https://github.com/JnthnBS/saint-graphique',
  ]) {
    check(
      `lien ${url}`,
      about.links.some((l) => l.replace(/\/$/, '') === url),
    );
  }
  check('méthodes listées', about.methods > 0);
  await shot('04-a-propos');
  await evaluate(`document.getElementById('sg-about-close').click()`);

  // --- Exports : on capture les blobs sans déclencher de vrai téléchargement ------------------------
  await evaluate(`(() => {
    window.__blobs = [];
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { window.__blobs.push(b); return create(b); };
    window.__downloads = [];
    HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download); };
  })()`);
  const svg = await evaluate(`(async () => {
    document.getElementById('sg-export-svg').click();
    const blob = window.__blobs.at(-1);
    const text = await blob.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    return { type: blob.type, size: blob.size, name: window.__downloads.at(-1), parseError: !!doc.querySelector('parsererror'), hasVar: text.includes('var(--'), circles: doc.querySelectorAll('circle').length, tabindex: text.includes('tabindex'), text };
  })()`);
  check(
    'export SVG valide',
    !svg.parseError && svg.type.startsWith('image/svg') && svg.circles >= 30,
    `${svg.size} octets`,
  );
  check('export SVG sans variable CSS', !svg.hasVar);
  check('export SVG nommé', /\.svg$/.test(svg.name), svg.name);
  check(
    'export SVG avec crédits',
    svg.text.includes('Chris et la PaduTeam') && svg.text.includes('JnthnBS'),
  );
  if (outDir) writeFileSync(join(outDir, 'export.svg'), svg.text);
  const png = await evaluate(`(async () => {
    document.getElementById('sg-export-png').click();
    for (let i = 0; i < 40 && !window.__downloads.at(-1)?.endsWith('.png'); i++) await new Promise((r) => setTimeout(r, 100));
    const blob = window.__blobs.at(-1);
    const header = [...new Uint8Array(await blob.slice(0, 4).arrayBuffer())];
    const buffer = await blob.arrayBuffer();
    let binary = '';
    for (const b of new Uint8Array(buffer)) binary += String.fromCharCode(b);
    return { type: blob.type, size: blob.size, name: window.__downloads.at(-1), header, base64: btoa(binary) };
  })()`);
  check(
    'export PNG valide',
    png.type === 'image/png' && png.size > 5000 && png.header[1] === 80,
    `${png.type} ${png.size}`,
  );
  if (outDir) writeFileSync(join(outDir, 'export.png'), Buffer.from(png.base64, 'base64'));

  // --- Thèmes ---------------------------------------------------------------------------------------
  const themeOf = () =>
    evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--sg-surface').trim()`);
  const clickTheme = async (value) => {
    await evaluate(`document.querySelector('#sg-theme input[value="${value}"]').click()`);
    await settle();
  };
  const lightSurface = await themeOf();
  await evaluate(`document.querySelector('#sg-theme input[value="dark"]').click()`);
  await settle();
  const darkSurface = await themeOf();
  const darkHash = await evaluate('location.hash');
  check('thème sombre', lightSurface !== darkSurface, `${lightSurface} / ${darkSurface}`);
  check('thème dans l’URL', darkHash.includes('t=dark'), darkHash);
  await shot('05-sombre');
  await clickTheme('light');
  check('retour au thème clair', (await themeOf()) === lightSurface);
  await clickTheme('system');
  check('thème système clair', (await themeOf()) === lightSurface);
  await emulateScheme('dark');
  await sleep(100);
  check('le thème système suit prefers-color-scheme', (await themeOf()) === darkSurface);
  await clickTheme('light');
  check('le choix clair l’emporte sur un système sombre', (await themeOf()) === lightSurface);
  await clickTheme('system');
  await emulateScheme('light');
  await sleep(100);

  // --- Largeur de 400 px --------------------------------------------------------------------------
  await setViewport(400, 800);
  await settle();
  const panelIds = await evaluate(
    `[...document.querySelectorAll('#sg-rail button[data-panel]')].filter((b) => !b.hidden).map((b) => b.dataset.panel)`,
  );
  for (const id of panelIds) {
    await openPanel(id);
    const open = await evaluate(`(() => {
      const panel = document.getElementById('sg-panel').getBoundingClientRect();
      const root = document.documentElement;
      return { shown: panel.height > 0 && panel.right <= innerWidth + 1 && panel.bottom <= innerHeight + 1, scrolls: root.scrollWidth > innerWidth || root.scrollHeight > innerHeight };
    })()`);
    check(`panneau ${id} à 400 px`, open.shown && !open.scrolls, JSON.stringify(open));
    await shot(`06b-400px-${id}`, false);
    await openPanel(id);
  }
  await shot('06-400px', false);
  // L'aide reste affichée jusqu'au premier geste : elle ne doit rien cacher en attendant.
  for (const width of [400, 360]) {
    await setViewport(width, 800);
    await settle();
    const hintRoom = await evaluate(`(() => {
      const hint = document.getElementById('sg-hint');
      const wasHidden = hint.hidden;
      hint.hidden = false;
      const box = hint.getBoundingClientRect();
      const overlaps = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
      };
      const room = {
        height: box.height,
        inWindow: box.left >= 0 && box.right <= innerWidth,
        fact: overlaps(document.getElementById('sg-fact')),
        axes: [...document.querySelectorAll('.sg-axis-end, .sg-axis-title')].some(overlaps),
      };
      hint.hidden = wasHidden;
      return room;
    })()`);
    check(
      `aide à ${width} px : une ligne, sans cacher le bouton ni les axes`,
      hintRoom.height < 36 && hintRoom.inWindow && !hintRoom.fact && !hintRoom.axes,
      JSON.stringify(hintRoom),
    );
  }
  await setViewport(400, 800);
  await setViewport(1280, 800);
  await settle();
  for (const id of panelIds) {
    await openPanel(id);
    const shifted = await evaluate(`(() => {
      const panel = document.getElementById('sg-panel').getBoundingClientRect();
      const ticks = [...document.querySelectorAll('.sg-tick-y')].map((t) => t.getBoundingClientRect().left);
      return { panelRight: panel.right, firstTick: Math.min(...ticks) };
    })()`);
    check(
      `panneau ${id} : la carte glisse à côté`,
      shifted.firstTick >= shifted.panelRight - 1,
      JSON.stringify(shifted),
    );
    await shot(`07-panneau-${id}`, false);
    await openPanel(id);
  }
  await settle();

  // --- Lisibilité : chevauchement réel des libellés rendus, à 1400 et 400 px --------------------
  const labelAudit = `(() => {
    const labels = [...document.querySelectorAll('.sg-label:not(.sg-exiting)')].filter((l) => Number(l.getAttribute('opacity')) > 0);
    const boxes = labels.map((l) => ({ text: l.textContent, cand: l.classList.contains('sg-label--cand'), box: l.getBBox() }));
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].box;
        const b = boxes[j].box;
        if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
          overlaps.push(boxes[i].text + ' / ' + boxes[j].text);
        }
      }
    }
    const cands = document.querySelectorAll('.sg-cand').length;
    const discs = [...document.querySelectorAll('.sg-pcs-layer circle')].map((c) => ({
      x: Number(c.getAttribute('cx')),
      y: Number(c.getAttribute('cy')),
      r: Number(c.getAttribute('r')),
    }));
    const candOnDisc = boxes.filter((b) => b.cand).flatMap((b) => discs.flatMap((d) => {
      const nx = Math.max(b.box.x, Math.min(d.x, b.box.x + b.box.width));
      const ny = Math.max(b.box.y, Math.min(d.y, b.box.y + b.box.height));
      const depth = d.r - Math.hypot(d.x - nx, d.y - ny);
      return depth > 0 ? [{ text: b.text, depth }] : [];
    }));
    // Le repère d'origine est à exactement un rayon de sa ligne : il n'est pas compté.
    const leaderThroughDisc = [...document.querySelectorAll('.sg-leader:not(.sg-exiting)')].filter((l) => {
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => Number(l.getAttribute(k)));
      const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
      return discs.some((d) => {
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((d.x - x1) * (x2 - x1) + (d.y - y1) * (y2 - y1)) / len2)) : 0;
        return Math.hypot(d.x - (x1 + t * (x2 - x1)), d.y - (y1 + t * (y2 - y1))) < d.r - 1;
      });
    }).length;
    return {
      overlaps,
      candOnDisc,
      leaderThroughDisc,
      visibleCandidates: boxes.filter((b) => b.cand).length,
      candidates: cands,
      visiblePcs: boxes.filter((b) => !b.cand).length,
      leaders: document.querySelectorAll('.sg-leader:not(.sg-exiting)').length,
      hiddenCandidates: [...document.querySelectorAll('.sg-label--cand')].filter((l) => Number(l.getAttribute('opacity')) === 0).map((l) => l.textContent),
    };
  })()`;
  await evaluate(`(() => {
    const radios = [...document.querySelectorAll('#sg-timeline input[type="radio"]')];
    (radios.find((o) => o.value === '2022_presidentielle_t1') ?? radios.at(-1)).click();
    const m = document.getElementById('sg-method');
    m.value = m.options[0].value;
    m.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  for (const [width, height, name] of [
    [1912, 948, '08-1912px'],
    [1280, 800, '08b-1280px'],
    [400, 800, '09-400px'],
  ]) {
    await setViewport(width, height);
    await settle();
    await shotOf(`${name}-carte`, '.sg-svg', width >= 1000 ? 1 : 2);
    const stopOverlaps = await evaluate(`(() => {
      const boxes = [...document.querySelectorAll('#sg-timeline .sg-stop, #sg-timeline .sg-year__label')].map((e) => e.getBoundingClientRect());
      return boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5)).length;
    })()`);
    check(`frise sans chevauchement à ${width} px`, stopOverlaps === 0, String(stopOverlaps));
    const audit = await evaluate(labelAudit);
    check(
      `aucun libellé superposé à ${width} px`,
      audit.overlaps.length === 0,
      audit.overlaps.join(' | '),
    );
    if (width >= 1000)
      check(
        `tous les électorats étiquetés à ${width} px`,
        audit.hiddenCandidates.length === 0,
        audit.hiddenCandidates.join(', '),
      );
    console.log(
      `[smoke] ${width} px : ${audit.visibleCandidates}/${audit.candidates} électorats étiquetés, ${audit.visiblePcs} PCS étiquetées, ${audit.leaders} lignes de rappel, ${audit.overlaps.length} superposition(s)` +
        (audit.hiddenCandidates.length ? `, masqués : ${audit.hiddenCandidates.join(', ')}` : ''),
    );
    await shot(name);
  }

  // Lisibilité sur chaque élection, pas seulement celle de la capture.
  await setViewport(1912, 948);
  const electionIds = await evaluate(
    `[...document.querySelectorAll('#sg-timeline input[type="radio"]')].map((o) => o.value)`,
  );
  for (const id of electionIds) {
    await chooseElection(id);
    const audit = await evaluate(labelAudit);
    check(
      `${id} : aucun libellé superposé`,
      audit.overlaps.length === 0,
      audit.overlaps.join(' | '),
    );
    // Un nom long, dans un groupe dense, peut effleurer un disque voisin : toléré jusqu'à
    // LABEL_DISC_TOLERANCE, et affiché pour rester visible.
    const onDisc = audit.candOnDisc.map((c) => `${c.text} (${c.depth.toFixed(1)} px)`);
    if (onDisc.length)
      console.log(`[smoke] ${id} : libellés qui effleurent un disque : ${onDisc.join(', ')}`);
    check(
      `${id} : aucun libellé d'électorat profondément sur un disque PCS`,
      audit.candOnDisc.every((c) => c.depth <= LABEL_DISC_TOLERANCE),
      onDisc.join(', '),
    );
    check(
      `${id} : peu de lignes de rappel à travers un disque PCS`,
      audit.leaderThroughDisc <= LEADERS_THROUGH_DISCS_TOLERANCE,
      String(audit.leaderThroughDisc),
    );
    if (audit.leaderThroughDisc > 0) {
      console.log(
        `[smoke] ${id} : ${audit.leaderThroughDisc} ligne(s) de rappel à travers un disque`,
      );
    }
  }
  await setViewport(1280, 800);
  await settle();

  // --- Bilan ------------------------------------------------------------------------------------
  check('aucune erreur ni avertissement en console', problems.length === 0, problems.join(' | '));
  if (!devMode) {
    const external = requests.filter((u) => !/^(file:|data:|blob:|about:)/.test(u));
    check('aucune requête réseau', external.length === 0, external.join(', '));
    check(
      'une seule ressource chargée',
      new Set(requests.filter((u) => u.startsWith('file:'))).size <= 1,
    );
    const csp = await evaluate(
      `!!document.querySelector('meta[http-equiv="Content-Security-Policy"]')`,
    );
    check('politique de sécurité présente', csp);
  }
  cdp.close();
}

let exitCode = 0;
try {
  await main();
} catch (err) {
  failures.push(`arrêt anticipé : ${err instanceof Error ? err.message : err}`);
}
browser.kill();
await sleep(300);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // Le navigateur peut retenir son profil quelques instants : le dossier temporaire reste.
}

console.log(`[smoke] ${target} via ${browserPath}`);
for (const f of failures) console.error(`[smoke] ÉCHEC : ${f}`);
console.log(`[smoke] ${passes.length} vérification(s) réussie(s), ${failures.length} échec(s).`);
if (failures.length > 0) exitCode = 1;
process.exit(exitCode);
