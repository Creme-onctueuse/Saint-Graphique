/**
 * Prépare src/data/computed/ avant `dev` et `build` :
 *  1. copie ../data/computed/** (index.json + <méthode>/<élection>.json) ;
 *     à défaut de fichiers calculés, copie la fixture fictive src/data/sample/** ;
 *  2. copie les données brutes ../data/pcs.json et ../data/elections/*.json dans _raw/
 *     (elles permettent le recalcul côté client quand l'utilisateur modifie les poids) ;
 *  3. convertit ../config/{pcs,methods,elections}.yaml en _config.json (libellés, couleurs,
 *     paramètres par défaut).
 *
 * Usage : node scripts/sync-data.mjs [--sample]   (ou SG_DATA=sample)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(web, '..');
const dest = join(web, 'src', 'data', 'computed');
const sampleDir = join(web, 'src', 'data', 'sample');
const dataDir = join(repo, 'data');
const computedDir = join(dataDir, 'computed');
const configDir = join(repo, 'config');
const forceSample = process.argv.includes('--sample') || process.env.SG_DATA === 'sample';

/** Liste récursive des .json d'un dossier (chemins relatifs, séparateur « / »). */
function listJson(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listJson(join(dir, entry.name), rel));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(rel);
  }
  return out.sort();
}

const warnings = [];

/** Copie un JSON après vérification de sa syntaxe (un JSON cassé ferait échouer Vite). */
function copyJson(from, to) {
  try {
    const text = readFileSync(from, 'utf8');
    JSON.parse(text);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text, 'utf8');
    return true;
  } catch (err) {
    warnings.push(`${relative(repo, from)} ignoré : ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

// 1. Coordonnées calculées
const realFiles = listJson(computedDir);
const hasComputed = realFiles.some((f) => /^[^_][^/]*\/[^/]+\.json$/.test(f));
const useReal = !forceSample && hasComputed;
let copied = 0;
let origin;
if (useReal) {
  origin = relative(repo, computedDir).split(sep).join('/');
  for (const f of realFiles) if (copyJson(join(computedDir, f), join(dest, f))) copied++;
} else {
  origin = `${relative(repo, sampleDir).split(sep).join('/')} (données FICTIVES)`;
  for (const f of listJson(sampleDir)) if (copyJson(join(sampleDir, f), join(dest, f))) copied++;
}

// 2. Données brutes (uniquement avec les vraies données : l'exemple embarque les siennes)
let raw = 0;
if (useReal) {
  if (existsSync(join(dataDir, 'pcs.json'))) {
    if (copyJson(join(dataDir, 'pcs.json'), join(dest, '_raw', 'pcs.json'))) raw++;
  }
  for (const f of listJson(join(dataDir, 'elections'))) {
    if (f.includes('/')) continue;
    if (copyJson(join(dataDir, 'elections', f), join(dest, '_raw', 'elections', f))) raw++;
  }
}

// 3. Configuration déclarative
const config = {};
for (const name of ['pcs', 'methods', 'elections']) {
  const file = join(configDir, `${name}.yaml`);
  if (!existsSync(file)) continue;
  try {
    config[name] = parse(readFileSync(file, 'utf8'));
  } catch (err) {
    warnings.push(`config/${name}.yaml illisible : ${err instanceof Error ? err.message : err}`);
  }
}
if (Object.keys(config).length > 0) {
  writeFileSync(join(dest, '_config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

for (const w of warnings) console.warn(`[sync-data] attention : ${w}`);
console.log(
  `[sync-data] ${copied} fichier(s) depuis ${origin}` +
    (raw ? `, ${raw} fichier(s) de données brutes` : '') +
    (config.pcs ? ', config/*.yaml' : '') +
    ` → ${relative(web, dest).split(sep).join('/')}`,
);
if (copied === 0) {
  console.error('[sync-data] aucune donnée disponible : ni data/computed/ ni src/data/sample/.');
  process.exit(1);
}
