/**
 * Test de fumée dans un vrai navigateur : ouvre dist/index.html en file:// (ou --url), pilote Edge
 * ou Chrome en mode headless par le protocole DevTools, sans dépendance, et vérifie que l'application
 * fonctionne : aucune erreur console, aucune requête réseau, interactions, exports, 400 px de large.
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

/** Profondeur (px) tolérée d'un libellé d'électorat sur un disque PCS. */
const LABEL_DISC_TOLERANCE = 8;

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

  await setViewport(1280, 1400);
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
    elections: document.querySelectorAll('#sg-election option').length,
    methods: document.querySelectorAll('#sg-method option').length,
    legend: document.querySelectorAll('.sg-chip').length,
    rows: document.querySelectorAll('.sg-table tbody tr').length,
    banner: !document.getElementById('sg-banner').hidden,
    overlay: !!document.querySelector('.sg-devoverlay'),
    scroll: document.documentElement.scrollWidth <= window.innerWidth,
  })`);
  check('30 disques PCS', initial.pcs === 30, String(initial.pcs));
  check('losanges des électorats', initial.cands > 0, String(initial.cands));
  check('barycentre de la population', initial.bary === 1);
  check('diagonale et quadrants', initial.diagonal && initial.quadrants === 4);
  check('libellés visibles', initial.labels >= 15, String(initial.labels));
  check('sélecteurs remplis', initial.elections > 0 && initial.methods > 0);
  check('légende', initial.legend >= initial.cands + 2);
  check('tableaux de données', initial.rows === initial.pcs + initial.cands);
  check('pas de débordement à 1280 px', initial.scroll);
  check(
    devMode ? 'mode calque présent en dev' : 'mode calque absent du build',
    initial.overlay === devMode,
  );
  await shot('01-clair');

  // --- Réserves et sources visibles sans ouvrir de panneau ----------------------------------------
  const reserved = await evaluate(`(() => {
    const box = document.getElementById('sg-reserves');
    const sources = document.getElementById('sg-sources');
    const chart = document.getElementById('sg-chart-host').getBoundingClientRect();
    const r = box.getBoundingClientRect();
    const s = sources.getBoundingClientRect();
    return {
      reserveText: box.textContent,
      reserveVisible: !box.hidden && r.height > 0,
      aboveChart: r.bottom <= chart.top + 1,
      sourcesBelow: s.top >= chart.bottom - 1,
      links: [...sources.querySelectorAll('a')].map((a) => a.href),
      sourcesText: sources.textContent,
      fictional: !document.getElementById('sg-banner').hidden,
      mca: [...document.querySelectorAll('#sg-method option')].find((o) => o.value === 'mca')?.textContent ?? null,
    };
  })()`);
  check(
    'réserve sur l’axe X au contact du graphique',
    !reserved.reserveVisible || (reserved.aboveChart && /axe/.test(reserved.reserveText)),
    reserved.reserveText,
  );
  check(
    'sources sous le graphique, avec liens',
    // La fixture fictive n'a pas d'URL : ses sources s'affichent en texte, sans lien.
    reserved.sourcesBelow &&
      reserved.sourcesText.length > 0 &&
      (reserved.fictional || reserved.links.length >= 2),
    reserved.sourcesText,
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
    const e = document.getElementById('sg-election');
    e.value = [...e.options].at(-1).value;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await settle();
  const moved = await evaluate(`({
    hash: location.hash,
    method: document.getElementById('sg-method').value,
    election: document.getElementById('sg-election').value,
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
    `document.getElementById('sg-method').value + '|' + document.getElementById('sg-election').value`,
  );
  check('vue restaurée depuis l’URL', reloaded === `${moved.method}|${moved.election}`, reloaded);
  await evaluate(`location.hash = ''`);
  await settle();

  // --- Curseurs : recalcul dans le navigateur ------------------------------------------------------
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
      reserveShown: !document.getElementById('sg-reserves').hidden,
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
  // La définition de l'axe X reste affichée ; les autres réserves suivent ce que disent les infobulles.
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
    const chip = document.querySelector('#sg-legend button[data-id="g:6"]');
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

  // --- À propos : crédits exigés -------------------------------------------------------------------
  const about = await evaluate(`(() => {
    document.getElementById('sg-about-open').click();
    const d = document.getElementById('sg-about');
    const open = d.open;
    const text = d.textContent;
    const links = [...d.querySelectorAll('a')].map((a) => a.href);
    const sources = document.querySelectorAll('#sg-about-sources li').length;
    const methods = document.querySelectorAll('#sg-about-methods li').length;
    return { open, text, links, sources, methods };
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
  check('sources et méthodes listées', about.sources > 0 && about.methods > 0);
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
  await setViewport(400, 900);
  await settle();
  const narrow = await evaluate(`({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    svg: document.querySelector('.sg-svg').getBoundingClientRect().width,
    pcs: document.querySelectorAll('.sg-pcs').length,
  })`);
  check('pas de débordement à 400 px', narrow.overflow <= 0, `${narrow.overflow} px`);
  check('graphique adapté à 400 px', narrow.svg <= 400 && narrow.svg > 250, String(narrow.svg));
  await evaluate(`document.querySelectorAll('details').forEach((d) => { d.open = true; })`);
  await sleep(200);
  const narrowOpen = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check('pas de débordement à 400 px, panneaux ouverts', narrowOpen <= 0, `${narrowOpen} px`);
  await shot('06b-400px-panneaux');
  await evaluate(`document.querySelectorAll('details').forEach((d) => { d.open = false; })`);
  await sleep(100);
  await shot('06-400px');
  await setViewport(1280, 1400);
  await settle();
  await evaluate(`document.querySelectorAll('details').forEach((d) => { d.open = true; })`);
  await sleep(100);
  await shot('07-panneaux');

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
    document.querySelectorAll('details').forEach((d) => { d.open = false; });
    const e = document.getElementById('sg-election');
    const wanted = [...e.options].find((o) => o.value === '2022_presidentielle_t1') ?? e.options[e.options.length - 1];
    e.value = wanted.value;
    e.dispatchEvent(new Event('change', { bubbles: true }));
    const m = document.getElementById('sg-method');
    m.value = m.options[0].value;
    m.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  for (const [width, height, name] of [
    [1400, 1500, '08-1400px'],
    [400, 1300, '09-400px'],
  ]) {
    await setViewport(width, height);
    await settle();
    await shotOf(`${name}-graphique`, '.sg-svg', width >= 1000 ? 2 : 3);
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
  await setViewport(1400, 1500);
  const electionIds = await evaluate(
    `[...document.getElementById('sg-election').options].map((o) => o.value)`,
  );
  for (const id of electionIds) {
    await evaluate(`(() => {
      const e = document.getElementById('sg-election');
      e.value = ${JSON.stringify(id)};
      e.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await settle();
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
      `${id} : aucun libellé d'électorat sur un disque PCS`,
      audit.candOnDisc.every((c) => c.depth <= LABEL_DISC_TOLERANCE),
      onDisc.join(', '),
    );
    check(
      `${id} : aucune ligne de rappel à travers un disque PCS`,
      audit.leaderThroughDisc === 0,
      String(audit.leaderThroughDisc),
    );
  }
  await setViewport(1280, 1400);
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
