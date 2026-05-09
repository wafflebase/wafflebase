// packages/slides/src/view/canvas/shapes/index.ts
import type { ShapeKind } from '../../../model/element';
import type { AdjustmentSpec, PathBuilder } from './builder';
import { buildDiamond } from './basic/diamond';
import { buildEllipse } from './basic/ellipse';
import { buildParallelogram, PARALLELOGRAM_ADJUSTMENTS } from './basic/parallelogram';
import { buildRect } from './basic/rect';
import { buildRoundRect, ROUND_RECT_ADJUSTMENTS } from './basic/round-rect';
import { buildRtTriangle } from './basic/rt-triangle';
import { buildTrapezoid, TRAPEZOID_ADJUSTMENTS } from './basic/trapezoid';
import { buildTriangle, TRIANGLE_ADJUSTMENTS } from './basic/triangle';

/**
 * Shape kind → path builder. Filled in incrementally by the
 * basic/arrows/callouts/equation tasks. Unknown kinds are handled by
 * the dispatcher's placeholder fallback, so partial registration
 * during development is safe.
 */
export const PATH_BUILDERS = new Map<ShapeKind, PathBuilder>();

/**
 * Shape kind → adjustable parameter specs. Only kinds with at least
 * one adjustment are listed. Phase 2's toolbar UI iterates this map.
 */
export const ADJUSTMENT_SPECS = new Map<
  ShapeKind,
  readonly AdjustmentSpec[]
>();

PATH_BUILDERS.set('rect', buildRect);
PATH_BUILDERS.set('ellipse', buildEllipse);
PATH_BUILDERS.set('roundRect', buildRoundRect);
PATH_BUILDERS.set('triangle', buildTriangle);
PATH_BUILDERS.set('rtTriangle', buildRtTriangle);
PATH_BUILDERS.set('diamond', buildDiamond);
PATH_BUILDERS.set('parallelogram', buildParallelogram);
PATH_BUILDERS.set('trapezoid', buildTrapezoid);

ADJUSTMENT_SPECS.set('roundRect', ROUND_RECT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('triangle', TRIANGLE_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('parallelogram', PARALLELOGRAM_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('trapezoid', TRAPEZOID_ADJUSTMENTS);
