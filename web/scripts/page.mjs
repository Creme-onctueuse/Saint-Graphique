/**
 * La page prête à ouvrir : saint-graphique.html, à la racine du dépôt, est la copie exacte de
 * dist/index.html. Quiconque récupère le dépôt l'ouvre d'un double-clic, sans rien installer.
 *
 * Usage : node scripts/page.mjs           copie dist/index.html à la racine
 *         node scripts/page.mjs --check   échoue si la copie à la racine diffère de dist/index.html
 *
 * Le build ne contient ni date ni identifiant de commit : à sources égales, il donne les mêmes octets.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(web, 'dist', 'index.html');
const page = join(web, '..', 'saint-graphique.html');
const REFRESH = 'lancez « pnpm page » dans web/, puis commitez saint-graphique.html';

function fail(message) {
  console.error(`[page] ÉCHEC : ${message}`);
  process.exit(1);
}

/** Un extrait lisible autour d'un octet, pour diagnostiquer un écart depuis le journal de la CI. */
function excerpt(bytes, at) {
  return bytes.subarray(Math.max(0, at - 60), at + 60).toString('utf8');
}

if (!existsSync(built)) fail('dist/index.html absent : lancez d’abord « pnpm build »');

if (process.argv.includes('--check')) {
  if (!existsSync(page)) fail(`saint-graphique.html absent : ${REFRESH}`);
  const expected = readFileSync(built);
  const actual = readFileSync(page);
  if (!actual.equals(expected)) {
    const length = Math.min(actual.length, expected.length);
    let at = 0;
    while (at < length && actual[at] === expected[at]) at++;
    console.error(`[page] build : ${expected.length} octets, racine : ${actual.length} octets`);
    console.error(`[page] premier écart à l'octet ${at}`);
    console.error(`[page] build  : ${excerpt(expected, at)}`);
    console.error(`[page] racine : ${excerpt(actual, at)}`);
    fail(`saint-graphique.html ne correspond plus au build : ${REFRESH}`);
  }
  console.log('[page] OK : saint-graphique.html correspond au build.');
} else {
  copyFileSync(built, page);
  console.log('[page] saint-graphique.html mis à jour depuis dist/index.html.');
}
