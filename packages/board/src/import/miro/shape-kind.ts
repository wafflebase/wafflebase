import type { ShapeKind } from '@wafflebase/slides';

/**
 * Miro's 21 documented shape names → the slides `ShapeKind` union. Every Miro
 * shape has a direct counterpart, so this table is total; an unknown name
 * (API drift) degrades to `rect` and is reported by the caller.
 */
const SHAPE_MAP: Record<string, ShapeKind> = {
  rectangle: 'rect',
  round_rectangle: 'roundRect',
  circle: 'ellipse',
  triangle: 'triangle',
  rhombus: 'diamond',
  parallelogram: 'parallelogram',
  trapezoid: 'trapezoid',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  octagon: 'octagon',
  wedge_round_rectangle_callout: 'wedgeRoundRectCallout',
  star: 'star5',
  flow_chart_predefined_process: 'flowChartPredefinedProcess',
  cloud: 'cloud',
  cross: 'plus',
  can: 'can',
  right_arrow: 'rightArrow',
  left_arrow: 'leftArrow',
  left_right_arrow: 'leftRightArrow',
  left_brace: 'leftBrace',
  right_brace: 'rightBrace',
};

/**
 * Resolve a Miro shape name; `known` is false when we fell back.
 *
 * The lookup is own-property-only. `name` arrives verbatim from externally
 * supplied Miro JSON, and a bare index would resolve inherited
 * `Object.prototype` keys — `'constructor'`, `'toString'`, `'__proto__'` etc.
 * would report `known: true` with a `kind` that is not a `ShapeKind` at all,
 * and that bogus value would flow on into the CRDT document. `tsc` cannot
 * catch this because `Record<string, T>` does not model prototype fallthrough.
 */
export function miroShapeKind(name: string | undefined): { kind: ShapeKind; known: boolean } {
  const mapped =
    name && Object.prototype.hasOwnProperty.call(SHAPE_MAP, name) ? SHAPE_MAP[name] : undefined;
  return mapped ? { kind: mapped, known: true } : { kind: 'rect', known: false };
}
