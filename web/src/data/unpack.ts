/**
 * Rend aux fichiers calculés embarqués les valeurs que scripts/pack-computed.mjs a mises en commun
 * dans `_pool.json`. Sans réservoir, les fichiers sont rendus tels quels.
 */
const POOL_FILE = '_pool.json';

export function unpackComputed(files: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const pool = files[POOL_FILE] as Record<string, unknown[]> | undefined;
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(files)) {
    if (path === POOL_FILE) continue;
    out[path] = pool ? restore(value, pool) : value;
  }
  return out;
}

function restore(value: unknown, pool: Record<string, unknown[]>): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const file: Record<string, unknown> = { ...value };
  for (const [field, values] of Object.entries(pool)) {
    const at = file[field];
    if (typeof at === 'number') file[field] = values[at];
  }
  return file;
}
