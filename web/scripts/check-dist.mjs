/**
 * Vérifie que le build est un fichier unique et autonome : dist/ ne contient que index.html,
 * sans ressource externe ni appel réseau, et sans le mode calque réservé au développement.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist');

function walk(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

const errors = [];
const files = walk(dist);
// La page se suffit à elle-même : seule l'image de partage l'accompagne, et elle ne la charge pas.
const extra = files.filter((f) => f !== 'index.html' && f !== 'og.png');
if (!files.includes('index.html')) errors.push('dist/index.html absent');
if (extra.length > 0) errors.push(`fichiers en trop dans dist/ : ${extra.join(', ')}`);

const html = files.includes('index.html') ? readFileSync(join(dist, 'index.html'), 'utf8') : '';
const checks = [
  [/<script[^>]+\bsrc\s*=/i, 'script externe (<script src>)'],
  [/<link\b[^>]*\bhref\s*=\s*["']?(?!data:)[^"'\s>]/i, 'ressource <link href> non inline'],
  [
    /<(?:img|iframe|source|video|audio|embed)\b[^>]*\bsrc\s*=\s*["']?(?!data:|blob:)[^"'\s>]/i,
    'média externe',
  ],
  [/url\(\s*["']?(?:https?:)?\/\//i, 'url() distante dans le CSS'],
  [/@import\s/i, '@import CSS'],
  [/@font-face[^}]*url\(\s*["']?(?!data:)/i, 'police non inline'],
  [/\bfetch\s*\(/, 'appel fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bnew\s+(?:WebSocket|EventSource)\b/, 'WebSocket / EventSource'],
  [/\bsendBeacon\b/, 'navigator.sendBeacon'],
  [/\bimport\s*\(\s*["'`]https?:/, 'import() distant'],
  [/sg-devoverlay|Calque \(dev\)/, 'mode calque (réservé au développement) présent dans le build'],
];
for (const [re, label] of checks) if (re.test(html)) errors.push(label);
if (!/http-equiv="Content-Security-Policy"/.test(html)) errors.push('CSP absente');
if (/%SITE_URL%/.test(html)) errors.push('adresse du site non remplacée');
if (!files.includes('og.png')) errors.push('image de partage absente (public/og.png)');

// Budget de poids : la page reste un fichier unique, à garder léger.
const MAX_PAGE_KIB = 1024;
const pageKib = statSync(join(dist, 'index.html')).size / 1024;
if (pageKib > MAX_PAGE_KIB) {
  errors.push(`page trop lourde : ${pageKib.toFixed(0)} Kio pour ${MAX_PAGE_KIB} Kio au plus`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(`[check-dist] ÉCHEC : ${e}`);
  process.exit(1);
}
const kb = (statSync(join(dist, 'index.html')).size / 1024).toFixed(1);
console.log(`[check-dist] OK : dist/index.html autonome (${kb} Kio), aucune ressource externe.`);
