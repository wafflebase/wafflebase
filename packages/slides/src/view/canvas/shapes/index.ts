// packages/slides/src/view/canvas/shapes/index.ts
import type { ShapeKind } from '../../../model/element';
import type { AdjustmentSpec, PathBuilder } from './builder';
import { buildCan, CAN_ADJUSTMENTS } from './basic/can';
import { buildCloud } from './basic/cloud';
import { buildDiamond } from './basic/diamond';
import { buildDonut, DONUT_ADJUSTMENTS } from './basic/donut';
import { buildEllipse } from './basic/ellipse';
import { buildHexagon, HEXAGON_ADJUSTMENTS } from './basic/hexagon';
import { buildOctagon, OCTAGON_ADJUSTMENTS } from './basic/octagon';
import { buildParallelogram, PARALLELOGRAM_ADJUSTMENTS } from './basic/parallelogram';
import { buildPentagon } from './basic/pentagon';
import { buildPlus, PLUS_ADJUSTMENTS } from './basic/plus';
import { buildRect } from './basic/rect';
import { buildRoundRect, ROUND_RECT_ADJUSTMENTS } from './basic/round-rect';
import { buildRtTriangle } from './basic/rt-triangle';
import { buildTrapezoid, TRAPEZOID_ADJUSTMENTS } from './basic/trapezoid';
import { buildTriangle, TRIANGLE_ADJUSTMENTS } from './basic/triangle';
import { ARROW_ADJUSTMENTS, buildRightArrow } from './arrows/right-arrow';
import { buildLeftArrow } from './arrows/left-arrow';
import { buildUpArrow } from './arrows/up-arrow';
import { buildDownArrow } from './arrows/down-arrow';
import { buildLeftRightArrow } from './arrows/left-right-arrow';
import { buildQuadArrow, QUAD_ARROW_ADJUSTMENTS } from './arrows/quad-arrow';
import { buildChevron, CHEVRON_ADJUSTMENTS } from './arrows/chevron';
import {
  buildPentagonArrow,
  PENTAGON_ARROW_ADJUSTMENTS,
} from './arrows/pentagon-arrow';
import {
  buildWedgeRectCallout,
  WEDGE_RECT_CALLOUT_ADJUSTMENTS,
} from './callouts/wedge-rect-callout';
import {
  buildWedgeRoundRectCallout,
  WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS,
} from './callouts/wedge-round-rect-callout';
import {
  buildWedgeEllipseCallout,
  WEDGE_ELLIPSE_CALLOUT_ADJUSTMENTS,
} from './callouts/wedge-ellipse-callout';
import {
  buildCloudCallout,
  CLOUD_CALLOUT_ADJUSTMENTS,
} from './callouts/cloud-callout';
import { buildMathPlus, MATH_PLUS_ADJUSTMENTS } from './equation/math-plus';
import { buildMathMinus } from './equation/math-minus';
import { buildMathMultiply } from './equation/math-multiply';
import {
  buildMathDivide,
  MATH_DIVIDE_ADJUSTMENTS,
} from './equation/math-divide';
import {
  buildMathEqual,
  MATH_EQUAL_ADJUSTMENTS,
} from './equation/math-equal';
import {
  buildMathNotEqual,
  MATH_NOT_EQUAL_ADJUSTMENTS,
} from './equation/math-not-equal';
import { buildStar4, STAR_4_ADJUSTMENTS } from './stars/star4';
import { buildStar5, STAR_5_ADJUSTMENTS } from './stars/star5';
import { buildStar6, STAR_6_ADJUSTMENTS } from './stars/star6';
import { buildStar7, STAR_7_ADJUSTMENTS } from './stars/star7';
import { buildStar8, STAR_8_ADJUSTMENTS } from './stars/star8';
import { buildStar10, STAR_10_ADJUSTMENTS } from './stars/star10';
import { buildFlowChartTerminator } from './flowchart/terminator';
import { buildFlowChartPredefinedProcess } from './flowchart/predefined-process';
import { buildFlowChartInternalStorage } from './flowchart/internal-storage';
import { buildFlowChartManualInput } from './flowchart/manual-input';
import { buildFlowChartManualOperation } from './flowchart/manual-operation';
import { buildFlowChartOffpageConnector } from './flowchart/offpage-connector';
import { buildFlowChartPunchedCard } from './flowchart/punched-card';

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
PATH_BUILDERS.set('pentagon', buildPentagon);
PATH_BUILDERS.set('hexagon', buildHexagon);
PATH_BUILDERS.set('octagon', buildOctagon);
PATH_BUILDERS.set('plus', buildPlus);
PATH_BUILDERS.set('donut', buildDonut);
PATH_BUILDERS.set('can', buildCan);
PATH_BUILDERS.set('cloud', buildCloud);
PATH_BUILDERS.set('rightArrow', buildRightArrow);
PATH_BUILDERS.set('leftArrow', buildLeftArrow);
PATH_BUILDERS.set('upArrow', buildUpArrow);
PATH_BUILDERS.set('downArrow', buildDownArrow);
PATH_BUILDERS.set('leftRightArrow', buildLeftRightArrow);
PATH_BUILDERS.set('quadArrow', buildQuadArrow);
PATH_BUILDERS.set('chevron', buildChevron);
PATH_BUILDERS.set('pentagonArrow', buildPentagonArrow);
PATH_BUILDERS.set('wedgeRectCallout', buildWedgeRectCallout);
PATH_BUILDERS.set('wedgeRoundRectCallout', buildWedgeRoundRectCallout);
PATH_BUILDERS.set('wedgeEllipseCallout', buildWedgeEllipseCallout);
PATH_BUILDERS.set('cloudCallout', buildCloudCallout);
PATH_BUILDERS.set('mathPlus', buildMathPlus);
PATH_BUILDERS.set('mathMinus', buildMathMinus);
PATH_BUILDERS.set('mathMultiply', buildMathMultiply);
PATH_BUILDERS.set('mathDivide', buildMathDivide);
PATH_BUILDERS.set('mathEqual', buildMathEqual);
PATH_BUILDERS.set('mathNotEqual', buildMathNotEqual);
PATH_BUILDERS.set('star4', buildStar4);
PATH_BUILDERS.set('star5', buildStar5);
PATH_BUILDERS.set('star6', buildStar6);
PATH_BUILDERS.set('star7', buildStar7);
PATH_BUILDERS.set('star8', buildStar8);
PATH_BUILDERS.set('star10', buildStar10);
PATH_BUILDERS.set('flowChartTerminator', buildFlowChartTerminator);
PATH_BUILDERS.set('flowChartPredefinedProcess', buildFlowChartPredefinedProcess);
PATH_BUILDERS.set('flowChartInternalStorage', buildFlowChartInternalStorage);
PATH_BUILDERS.set('flowChartManualInput', buildFlowChartManualInput);
PATH_BUILDERS.set('flowChartManualOperation', buildFlowChartManualOperation);
PATH_BUILDERS.set('flowChartOffpageConnector', buildFlowChartOffpageConnector);
PATH_BUILDERS.set('flowChartPunchedCard', buildFlowChartPunchedCard);

ADJUSTMENT_SPECS.set('roundRect', ROUND_RECT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('triangle', TRIANGLE_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('parallelogram', PARALLELOGRAM_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('trapezoid', TRAPEZOID_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('hexagon', HEXAGON_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('octagon', OCTAGON_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('plus', PLUS_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('donut', DONUT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('can', CAN_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('rightArrow', ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('leftArrow', ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('upArrow', ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('downArrow', ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('leftRightArrow', ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('quadArrow', QUAD_ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('chevron', CHEVRON_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('pentagonArrow', PENTAGON_ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('wedgeRectCallout', WEDGE_RECT_CALLOUT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set(
  'wedgeRoundRectCallout',
  WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS,
);
ADJUSTMENT_SPECS.set('wedgeEllipseCallout', WEDGE_ELLIPSE_CALLOUT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('cloudCallout', CLOUD_CALLOUT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('mathPlus', MATH_PLUS_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('mathMinus', MATH_PLUS_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('mathMultiply', MATH_PLUS_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('mathDivide', MATH_DIVIDE_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('mathEqual', MATH_EQUAL_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('mathNotEqual', MATH_NOT_EQUAL_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('star4', STAR_4_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('star5', STAR_5_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('star6', STAR_6_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('star7', STAR_7_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('star8', STAR_8_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('star10', STAR_10_ADJUSTMENTS);
