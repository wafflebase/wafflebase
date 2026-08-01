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

/** Resolve a Miro shape name; `known` is false when we fell back. */
export function miroShapeKind(name: string | undefined): { kind: ShapeKind; known: boolean } {
  const mapped = name ? SHAPE_MAP[name] : undefined;
  return mapped ? { kind: mapped, known: true } : { kind: 'rect', known: false };
}
