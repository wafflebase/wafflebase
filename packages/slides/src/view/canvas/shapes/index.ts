// packages/slides/src/view/canvas/shapes/index.ts
import type { ShapeKind } from '../../../model/element';
import type { AdjustmentSpec, PathBuilder } from './builder';
import { buildEllipse } from './basic/ellipse';
import { buildRect } from './basic/rect';

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
