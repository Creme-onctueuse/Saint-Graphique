/** Formes SVG élémentaires. */

/** Losange centré sur l'origine, de demi-diagonale d (aire = 2·d²). */
export function diamondPath(d: number): string {
  const r = Math.max(0, d);
  return `M0,${-r}L${r},0L0,${r}L${-r},0Z`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
