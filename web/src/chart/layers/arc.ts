/** Tracé d'une part d'anneau. Module pur, testé dans arc.test.ts. */

export interface ArcAngles {
  start: number;
  end: number;
}

/** Part d'anneau centrée sur l'origine. Les angles sont en radians, 0 en haut, sens horaire. */
export function arcPath(inner: number, outer: number, start: number, end: number): string {
  const span = end - start;
  if (span <= 0) return '';
  const fixed = (v: number): string => {
    const text = v.toFixed(2);
    return text === '-0.00' ? '0.00' : text;
  };
  const point = (r: number, a: number): string =>
    `${fixed(r * Math.sin(a))},${fixed(-r * Math.cos(a))}`;
  // Un arc complet ne se trace pas d'un seul tenant : deux points confondus ne définissent rien.
  const stop = span >= 2 * Math.PI ? start + 2 * Math.PI - 1e-4 : end;
  const large = stop - start > Math.PI ? 1 : 0;
  return (
    `M${point(outer, start)}` +
    `A${outer},${outer} 0 ${large} 1 ${point(outer, stop)}` +
    `L${point(inner, stop)}` +
    `A${inner},${inner} 0 ${large} 0 ${point(inner, start)}Z`
  );
}

/** Angles des parts d'un anneau, à partir de leurs valeurs. */
export function arcAngles(values: readonly number[]): ArcAngles[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return values.map(() => ({ start: 0, end: 0 }));
  let cursor = 0;
  return values.map((v) => {
    const start = cursor;
    cursor += (2 * Math.PI * Math.max(0, v)) / total;
    return { start, end: cursor };
  });
}

/** Interpole entre deux jeux d'angles, pour que l'anneau glisse d'une élection à l'autre. */
export function lerpAngles(
  from: readonly ArcAngles[],
  to: readonly ArcAngles[],
  t: number,
): ArcAngles[] {
  return to.map((target, i) => {
    const source = from[i] ?? target;
    return {
      start: source.start + (target.start - source.start) * t,
      end: source.end + (target.end - source.end) * t,
    };
  });
}
