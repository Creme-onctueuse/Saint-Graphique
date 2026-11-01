/**
 * Chargement des données embarquées. Tous les JSON de src/data/computed/ (copiés par
 * scripts/sync-data.mjs) sont inclus dans le bundle : aucune requête réseau à l'exécution.
 */
import { buildDataset, type Dataset } from './dataset.ts';

const modules = import.meta.glob<unknown>('./computed/**/*.json', {
  eager: true,
  import: 'default',
});

export function loadDataset(): Dataset {
  const files: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(modules)) {
    files[path.replace(/^\.\/computed\//, '')] = value;
  }
  return buildDataset(files);
}
