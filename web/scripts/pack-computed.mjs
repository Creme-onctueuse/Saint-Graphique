/**
 * Compacte les fichiers calculés avant de les embarquer dans la page : chaque élection d'une méthode
 * répète la même liste de catégories, ce qui pèse plus que tout le reste. Les valeurs répétées vont
 * dans un réservoir, et le fichier ne garde que leur numéro. data/computed/ reste complet, conforme
 * à son schéma : seule la copie embarquée change. src/data/unpack.ts fait le chemin inverse.
 */

/** Champs qui se répètent d'un fichier à l'autre ; `candidates` est propre à chaque élection. */
export const POOLED_FIELDS = ['pcs', 'groups', 'sources', 'params', 'axes', 'bootstrap'];

/**
 * @param {Record<string, Record<string, unknown>>} files fichiers calculés, par chemin
 * @returns {{ packed: Record<string, Record<string, unknown>>, pool: Record<string, unknown[]> }}
 */
export function packComputed(files) {
  /** @type {Record<string, unknown[]>} */
  const pool = {};
  /** @type {Map<string, number>} */
  const known = new Map();
  /** @type {Record<string, Record<string, unknown>>} */
  const packed = {};
  for (const [path, file] of Object.entries(files)) {
    const copy = { ...file };
    for (const field of POOLED_FIELDS) {
      if (copy[field] === undefined) continue;
      const key = `${field}:${JSON.stringify(copy[field])}`;
      let at = known.get(key);
      if (at === undefined) {
        const values = (pool[field] ??= []);
        at = values.length;
        values.push(copy[field]);
        known.set(key, at);
      }
      copy[field] = at;
    }
    packed[path] = copy;
  }
  return { packed, pool };
}
