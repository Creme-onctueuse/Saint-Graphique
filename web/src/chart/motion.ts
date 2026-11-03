/** Transitions communes aux calques de la carte. */
import type { BaseType, Selection } from 'd3-selection';

export type G = Selection<SVGGElement, unknown, null, undefined>;

/** Applique des attributs, en transition si `duration` > 0, immédiatement sinon. */
export function setAttrs<E extends BaseType, D, P extends BaseType, PD>(
  sel: Selection<E, D, P, PD>,
  duration: number,
  attrs: Record<string, (d: D) => string | number>,
): void {
  if (duration > 0) {
    const t = sel.transition('sg-move').duration(duration);
    for (const [name, value] of Object.entries(attrs)) t.attr(name, value);
  } else {
    sel.interrupt('sg-move');
    for (const [name, value] of Object.entries(attrs)) sel.attr(name, value);
  }
}

/** Fait disparaître des éléments sortants (ils ne sont plus sélectionnés pendant le fondu). */
export function exitSel<E extends Element, D, P extends BaseType, PD>(
  sel: Selection<E, D, P, PD>,
  cls: string,
  duration: number,
): void {
  sel.classed(cls, false).classed('sg-exiting', true).attr('tabindex', null);
  if (duration > 0) {
    sel
      .interrupt('sg-move')
      .transition('sg-exit')
      .duration(duration * 0.6)
      .attr('opacity', 0)
      .remove();
  } else {
    sel.remove();
  }
}
