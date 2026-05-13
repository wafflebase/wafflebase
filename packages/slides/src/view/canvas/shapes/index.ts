// packages/slides/src/view/canvas/shapes/index.ts
import type { ShapeKind } from '../../../model/element';
import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from './builder';
import { buildCan, CAN_ADJUSTMENTS, CAN_HANDLES } from './basic/can';
import { buildCloud } from './basic/cloud';
import { buildDiamond } from './basic/diamond';
import { buildDonut, DONUT_ADJUSTMENTS, DONUT_HANDLES } from './basic/donut';
import { buildEllipse } from './basic/ellipse';
import { buildHexagon, HEXAGON_ADJUSTMENTS, HEXAGON_HANDLES } from './basic/hexagon';
import { buildOctagon, OCTAGON_ADJUSTMENTS, OCTAGON_HANDLES } from './basic/octagon';
import {
  buildParallelogram,
  PARALLELOGRAM_ADJUSTMENTS,
  PARALLELOGRAM_HANDLES,
} from './basic/parallelogram';
import { buildPentagon } from './basic/pentagon';
import { buildHeptagon } from './basic/heptagon';
import { buildDecagon } from './basic/decagon';
import { buildDodecagon } from './basic/dodecagon';
import { buildPie, PIE_ADJUSTMENTS, PIE_HANDLES } from './basic/pie';
import { buildChord, CHORD_ADJUSTMENTS, CHORD_HANDLES } from './basic/chord';
import { buildArc, ARC_ADJUSTMENTS, ARC_HANDLES } from './basic/arc';
import {
  buildBlockArc,
  BLOCK_ARC_ADJUSTMENTS,
  BLOCK_ARC_HANDLES,
} from './basic/block-arc';
import {
  buildFrame,
  FRAME_ADJUSTMENTS,
  FRAME_HANDLES,
} from './basic/frame';
import {
  buildHalfFrame,
  HALF_FRAME_ADJUSTMENTS,
  HALF_FRAME_HANDLES,
} from './basic/half-frame';
import {
  buildCorner,
  CORNER_ADJUSTMENTS,
  CORNER_HANDLES,
} from './basic/corner';
import {
  buildDiagStripe,
  DIAG_STRIPE_ADJUSTMENTS,
  DIAG_STRIPE_HANDLES,
} from './basic/diag-stripe';
import {
  buildPlaque,
  PLAQUE_ADJUSTMENTS,
  PLAQUE_HANDLES,
} from './basic/plaque';
import {
  buildBevel,
  BEVEL_ADJUSTMENTS,
  BEVEL_HANDLES,
} from './basic/bevel';
import {
  buildFoldedCorner,
  FOLDED_CORNER_ADJUSTMENTS,
  FOLDED_CORNER_HANDLES,
} from './basic/folded-corner';
import {
  buildCube,
  CUBE_ADJUSTMENTS,
  CUBE_HANDLES,
} from './basic/cube';
import {
  buildTeardrop,
  TEARDROP_ADJUSTMENTS,
  TEARDROP_HANDLES,
} from './basic/teardrop';
import { buildHeart } from './basic/heart';
import { buildLightningBolt } from './basic/lightning-bolt';
import { buildSun, SUN_ADJUSTMENTS, SUN_HANDLES } from './basic/sun';
import { buildMoon, MOON_ADJUSTMENTS, MOON_HANDLES } from './basic/moon';
import {
  buildNoSmoking,
  NO_SMOKING_ADJUSTMENTS,
  NO_SMOKING_HANDLES,
} from './basic/no-smoking';
import {
  buildSmileyFace,
  SMILEY_FACE_ADJUSTMENTS,
  SMILEY_FACE_HANDLES,
} from './basic/smiley-face';
import {
  buildSnip1Rect,
  SNIP1_RECT_ADJUSTMENTS,
  SNIP1_RECT_HANDLES,
} from './basic/snip1-rect';
import {
  buildSnip2SameRect,
  SNIP2_SAME_RECT_ADJUSTMENTS,
  SNIP2_SAME_RECT_HANDLES,
} from './basic/snip2-same-rect';
import {
  buildSnip2DiagRect,
  SNIP2_DIAG_RECT_ADJUSTMENTS,
  SNIP2_DIAG_RECT_HANDLES,
} from './basic/snip2-diag-rect';
import {
  buildSnipRoundRect,
  SNIP_ROUND_RECT_ADJUSTMENTS,
  SNIP_ROUND_RECT_HANDLES,
} from './basic/snip-round-rect';
import {
  buildRound1Rect,
  ROUND1_RECT_ADJUSTMENTS,
  ROUND1_RECT_HANDLES,
} from './basic/round1-rect';
import {
  buildRound2SameRect,
  ROUND2_SAME_RECT_ADJUSTMENTS,
  ROUND2_SAME_RECT_HANDLES,
} from './basic/round2-same-rect';
import {
  buildRound2DiagRect,
  ROUND2_DIAG_RECT_ADJUSTMENTS,
  ROUND2_DIAG_RECT_HANDLES,
} from './basic/round2-diag-rect';
import { buildPlus, PLUS_ADJUSTMENTS, PLUS_HANDLES } from './basic/plus';
import { buildRect } from './basic/rect';
import { buildRoundRect, ROUND_RECT_ADJUSTMENTS, ROUND_RECT_HANDLES } from './basic/round-rect';
import { buildRtTriangle } from './basic/rt-triangle';
import { buildTrapezoid, TRAPEZOID_ADJUSTMENTS, TRAPEZOID_HANDLES } from './basic/trapezoid';
import { buildTriangle, TRIANGLE_ADJUSTMENTS, TRIANGLE_HANDLES } from './basic/triangle';
import { ARROW_ADJUSTMENTS, buildRightArrow, RIGHT_ARROW_HANDLES } from './arrows/right-arrow';
import { buildLeftArrow, LEFT_ARROW_HANDLES } from './arrows/left-arrow';
import { buildUpArrow, UP_ARROW_HANDLES } from './arrows/up-arrow';
import { buildDownArrow, DOWN_ARROW_HANDLES } from './arrows/down-arrow';
import { buildLeftRightArrow, LEFT_RIGHT_ARROW_HANDLES } from './arrows/left-right-arrow';
import { buildQuadArrow, QUAD_ARROW_ADJUSTMENTS, QUAD_ARROW_HANDLES } from './arrows/quad-arrow';
import { buildChevron, CHEVRON_ADJUSTMENTS, CHEVRON_HANDLES } from './arrows/chevron';
import {
  buildPentagonArrow,
  PENTAGON_ARROW_ADJUSTMENTS,
  PENTAGON_ARROW_HANDLES,
} from './arrows/pentagon-arrow';
import {
  buildUpDownArrow,
  UP_DOWN_ARROW_ADJUSTMENTS,
  UP_DOWN_ARROW_HANDLES,
} from './arrows/up-down-arrow';
import {
  buildLeftRightUpArrow,
  LEFT_RIGHT_UP_ARROW_ADJUSTMENTS,
  LEFT_RIGHT_UP_ARROW_HANDLES,
} from './arrows/left-right-up-arrow';
import {
  buildNotchedRightArrow,
  NOTCHED_RIGHT_ARROW_ADJUSTMENTS,
  NOTCHED_RIGHT_ARROW_HANDLES,
} from './arrows/notched-right-arrow';
import {
  buildStripedRightArrow,
  STRIPED_RIGHT_ARROW_ADJUSTMENTS,
  STRIPED_RIGHT_ARROW_HANDLES,
} from './arrows/striped-right-arrow';
import {
  buildBentArrow,
  BENT_ARROW_ADJUSTMENTS,
  BENT_ARROW_HANDLES,
} from './arrows/bent-arrow';
import {
  buildBentUpArrow,
  BENT_UP_ARROW_ADJUSTMENTS,
  BENT_UP_ARROW_HANDLES,
} from './arrows/bent-up-arrow';
import {
  buildUturnArrow,
  UTURN_ARROW_ADJUSTMENTS,
  UTURN_ARROW_HANDLES,
} from './arrows/uturn-arrow';
import {
  buildSwooshArrow,
  SWOOSH_ARROW_ADJUSTMENTS,
  SWOOSH_ARROW_HANDLES,
} from './arrows/swoosh-arrow';
import {
  buildWedgeRectCallout,
  WEDGE_RECT_CALLOUT_ADJUSTMENTS,
  WEDGE_RECT_CALLOUT_HANDLES,
} from './callouts/wedge-rect-callout';
import {
  buildWedgeRoundRectCallout,
  WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS,
  WEDGE_ROUND_RECT_CALLOUT_HANDLES,
} from './callouts/wedge-round-rect-callout';
import {
  buildWedgeEllipseCallout,
  WEDGE_ELLIPSE_CALLOUT_ADJUSTMENTS,
  WEDGE_ELLIPSE_CALLOUT_HANDLES,
} from './callouts/wedge-ellipse-callout';
import {
  buildCloudCallout,
  CLOUD_CALLOUT_ADJUSTMENTS,
  CLOUD_CALLOUT_HANDLES,
} from './callouts/cloud-callout';
import { buildMathPlus, MATH_PLUS_ADJUSTMENTS, MATH_PLUS_HANDLES } from './equation/math-plus';
import { buildMathMinus, MATH_MINUS_HANDLES } from './equation/math-minus';
import { buildMathMultiply, MATH_MULTIPLY_HANDLES } from './equation/math-multiply';
import {
  buildMathDivide,
  MATH_DIVIDE_ADJUSTMENTS,
  MATH_DIVIDE_HANDLES,
} from './equation/math-divide';
import {
  buildMathEqual,
  MATH_EQUAL_ADJUSTMENTS,
  MATH_EQUAL_HANDLES,
} from './equation/math-equal';
import {
  buildMathNotEqual,
  MATH_NOT_EQUAL_ADJUSTMENTS,
  MATH_NOT_EQUAL_HANDLES,
} from './equation/math-not-equal';
import { buildStar4, STAR_4_ADJUSTMENTS, STAR_4_HANDLES } from './stars/star4';
import { buildStar5, STAR_5_ADJUSTMENTS, STAR_5_HANDLES } from './stars/star5';
import { buildStar6, STAR_6_ADJUSTMENTS, STAR_6_HANDLES } from './stars/star6';
import { buildStar7, STAR_7_ADJUSTMENTS, STAR_7_HANDLES } from './stars/star7';
import { buildStar8, STAR_8_ADJUSTMENTS, STAR_8_HANDLES } from './stars/star8';
import { buildStar10, STAR_10_ADJUSTMENTS, STAR_10_HANDLES } from './stars/star10';
import { buildFlowChartTerminator } from './flowchart/terminator';
import { buildFlowChartPredefinedProcess } from './flowchart/predefined-process';
import { buildFlowChartInternalStorage } from './flowchart/internal-storage';
import { buildFlowChartManualInput } from './flowchart/manual-input';
import { buildFlowChartManualOperation } from './flowchart/manual-operation';
import { buildFlowChartOffpageConnector } from './flowchart/offpage-connector';
import { buildFlowChartPunchedCard } from './flowchart/punched-card';
import { buildFlowChartDocument } from './flowchart/document';
import { buildFlowChartMultidocument } from './flowchart/multidocument';
import { buildFlowChartPunchedTape } from './flowchart/punched-tape';
import { buildFlowChartSummingJunction } from './flowchart/summing-junction';
import { buildFlowChartOr } from './flowchart/or';
import { buildFlowChartDelay } from './flowchart/delay';
import { buildFlowChartDisplay } from './flowchart/display';

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

/**
 * Shape kind → drag-handle metadata. Only kinds with at least one
 * authored handle are listed. Unregistered kinds get zero handles
 * (no drag UX, defaults still apply). Phase P3-A.1 fills the pilot
 * 9; P3-A.2 fills the remaining 24.
 */
export const ADJUSTMENT_HANDLES = new Map<
  ShapeKind,
  readonly AdjustmentHandle[]
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
PATH_BUILDERS.set('heptagon', buildHeptagon);
PATH_BUILDERS.set('octagon', buildOctagon);
PATH_BUILDERS.set('decagon', buildDecagon);
PATH_BUILDERS.set('dodecagon', buildDodecagon);
PATH_BUILDERS.set('pie', buildPie);
PATH_BUILDERS.set('chord', buildChord);
PATH_BUILDERS.set('arc', buildArc);
PATH_BUILDERS.set('blockArc', buildBlockArc);
PATH_BUILDERS.set('frame', buildFrame);
PATH_BUILDERS.set('halfFrame', buildHalfFrame);
PATH_BUILDERS.set('corner', buildCorner);
PATH_BUILDERS.set('diagStripe', buildDiagStripe);
PATH_BUILDERS.set('plaque', buildPlaque);
PATH_BUILDERS.set('bevel', buildBevel);
PATH_BUILDERS.set('foldedCorner', buildFoldedCorner);
PATH_BUILDERS.set('cube', buildCube);
PATH_BUILDERS.set('teardrop', buildTeardrop);
PATH_BUILDERS.set('smileyFace', buildSmileyFace);
PATH_BUILDERS.set('heart', buildHeart);
PATH_BUILDERS.set('lightningBolt', buildLightningBolt);
PATH_BUILDERS.set('sun', buildSun);
PATH_BUILDERS.set('moon', buildMoon);
PATH_BUILDERS.set('noSmoking', buildNoSmoking);
PATH_BUILDERS.set('snip1Rect', buildSnip1Rect);
PATH_BUILDERS.set('snip2SameRect', buildSnip2SameRect);
PATH_BUILDERS.set('snip2DiagRect', buildSnip2DiagRect);
PATH_BUILDERS.set('snipRoundRect', buildSnipRoundRect);
PATH_BUILDERS.set('round1Rect', buildRound1Rect);
PATH_BUILDERS.set('round2SameRect', buildRound2SameRect);
PATH_BUILDERS.set('round2DiagRect', buildRound2DiagRect);
PATH_BUILDERS.set('upDownArrow', buildUpDownArrow);
PATH_BUILDERS.set('leftRightUpArrow', buildLeftRightUpArrow);
PATH_BUILDERS.set('notchedRightArrow', buildNotchedRightArrow);
PATH_BUILDERS.set('stripedRightArrow', buildStripedRightArrow);
PATH_BUILDERS.set('bentArrow', buildBentArrow);
PATH_BUILDERS.set('bentUpArrow', buildBentUpArrow);
PATH_BUILDERS.set('uturnArrow', buildUturnArrow);
PATH_BUILDERS.set('swooshArrow', buildSwooshArrow);
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
PATH_BUILDERS.set('flowChartDocument', buildFlowChartDocument);
PATH_BUILDERS.set('flowChartMultidocument', buildFlowChartMultidocument);
PATH_BUILDERS.set('flowChartPunchedTape', buildFlowChartPunchedTape);
PATH_BUILDERS.set('flowChartSummingJunction', buildFlowChartSummingJunction);
PATH_BUILDERS.set('flowChartOr', buildFlowChartOr);
PATH_BUILDERS.set('flowChartDelay', buildFlowChartDelay);
PATH_BUILDERS.set('flowChartDisplay', buildFlowChartDisplay);

ADJUSTMENT_SPECS.set('roundRect', ROUND_RECT_ADJUSTMENTS);
ADJUSTMENT_HANDLES.set('roundRect', ROUND_RECT_HANDLES);
ADJUSTMENT_HANDLES.set('chevron', CHEVRON_HANDLES);
ADJUSTMENT_HANDLES.set('wedgeRectCallout', WEDGE_RECT_CALLOUT_HANDLES);
ADJUSTMENT_HANDLES.set('star4', STAR_4_HANDLES);
ADJUSTMENT_HANDLES.set('star5', STAR_5_HANDLES);
ADJUSTMENT_HANDLES.set('star6', STAR_6_HANDLES);
ADJUSTMENT_HANDLES.set('star7', STAR_7_HANDLES);
ADJUSTMENT_HANDLES.set('star8', STAR_8_HANDLES);
ADJUSTMENT_HANDLES.set('star10', STAR_10_HANDLES);
ADJUSTMENT_HANDLES.set('triangle', TRIANGLE_HANDLES);
ADJUSTMENT_HANDLES.set('parallelogram', PARALLELOGRAM_HANDLES);
ADJUSTMENT_HANDLES.set('trapezoid', TRAPEZOID_HANDLES);
ADJUSTMENT_HANDLES.set('hexagon', HEXAGON_HANDLES);
ADJUSTMENT_HANDLES.set('octagon', OCTAGON_HANDLES);
ADJUSTMENT_HANDLES.set('plus', PLUS_HANDLES);
ADJUSTMENT_HANDLES.set('pentagonArrow', PENTAGON_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('can', CAN_HANDLES);
ADJUSTMENT_HANDLES.set('donut', DONUT_HANDLES);
ADJUSTMENT_HANDLES.set('rightArrow', RIGHT_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('leftArrow', LEFT_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('upArrow', UP_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('downArrow', DOWN_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('leftRightArrow', LEFT_RIGHT_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('quadArrow', QUAD_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('wedgeRoundRectCallout', WEDGE_ROUND_RECT_CALLOUT_HANDLES);
ADJUSTMENT_HANDLES.set('wedgeEllipseCallout', WEDGE_ELLIPSE_CALLOUT_HANDLES);
ADJUSTMENT_HANDLES.set('cloudCallout', CLOUD_CALLOUT_HANDLES);
ADJUSTMENT_HANDLES.set('mathPlus', MATH_PLUS_HANDLES);
ADJUSTMENT_HANDLES.set('mathMinus', MATH_MINUS_HANDLES);
ADJUSTMENT_HANDLES.set('mathMultiply', MATH_MULTIPLY_HANDLES);
ADJUSTMENT_HANDLES.set('mathEqual', MATH_EQUAL_HANDLES);
ADJUSTMENT_HANDLES.set('mathDivide', MATH_DIVIDE_HANDLES);
ADJUSTMENT_HANDLES.set('mathNotEqual', MATH_NOT_EQUAL_HANDLES);
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
ADJUSTMENT_SPECS.set('pie', PIE_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('chord', CHORD_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('arc', ARC_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('blockArc', BLOCK_ARC_ADJUSTMENTS);
ADJUSTMENT_HANDLES.set('pie', PIE_HANDLES);
ADJUSTMENT_HANDLES.set('chord', CHORD_HANDLES);
ADJUSTMENT_HANDLES.set('arc', ARC_HANDLES);
ADJUSTMENT_HANDLES.set('blockArc', BLOCK_ARC_HANDLES);
ADJUSTMENT_SPECS.set('frame', FRAME_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('halfFrame', HALF_FRAME_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('corner', CORNER_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('diagStripe', DIAG_STRIPE_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('plaque', PLAQUE_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('bevel', BEVEL_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('foldedCorner', FOLDED_CORNER_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('cube', CUBE_ADJUSTMENTS);
ADJUSTMENT_HANDLES.set('frame', FRAME_HANDLES);
ADJUSTMENT_HANDLES.set('halfFrame', HALF_FRAME_HANDLES);
ADJUSTMENT_HANDLES.set('corner', CORNER_HANDLES);
ADJUSTMENT_HANDLES.set('diagStripe', DIAG_STRIPE_HANDLES);
ADJUSTMENT_HANDLES.set('plaque', PLAQUE_HANDLES);
ADJUSTMENT_HANDLES.set('bevel', BEVEL_HANDLES);
ADJUSTMENT_HANDLES.set('foldedCorner', FOLDED_CORNER_HANDLES);
ADJUSTMENT_HANDLES.set('cube', CUBE_HANDLES);
ADJUSTMENT_SPECS.set('teardrop', TEARDROP_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('smileyFace', SMILEY_FACE_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('sun', SUN_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('moon', MOON_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('noSmoking', NO_SMOKING_ADJUSTMENTS);
ADJUSTMENT_HANDLES.set('teardrop', TEARDROP_HANDLES);
ADJUSTMENT_HANDLES.set('smileyFace', SMILEY_FACE_HANDLES);
ADJUSTMENT_HANDLES.set('sun', SUN_HANDLES);
ADJUSTMENT_HANDLES.set('moon', MOON_HANDLES);
ADJUSTMENT_HANDLES.set('noSmoking', NO_SMOKING_HANDLES);
ADJUSTMENT_SPECS.set('snip1Rect', SNIP1_RECT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('snip2SameRect', SNIP2_SAME_RECT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('snip2DiagRect', SNIP2_DIAG_RECT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('snipRoundRect', SNIP_ROUND_RECT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('round1Rect', ROUND1_RECT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('round2SameRect', ROUND2_SAME_RECT_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('round2DiagRect', ROUND2_DIAG_RECT_ADJUSTMENTS);
ADJUSTMENT_HANDLES.set('snip1Rect', SNIP1_RECT_HANDLES);
ADJUSTMENT_HANDLES.set('snip2SameRect', SNIP2_SAME_RECT_HANDLES);
ADJUSTMENT_HANDLES.set('snip2DiagRect', SNIP2_DIAG_RECT_HANDLES);
ADJUSTMENT_HANDLES.set('snipRoundRect', SNIP_ROUND_RECT_HANDLES);
ADJUSTMENT_HANDLES.set('round1Rect', ROUND1_RECT_HANDLES);
ADJUSTMENT_HANDLES.set('round2SameRect', ROUND2_SAME_RECT_HANDLES);
ADJUSTMENT_HANDLES.set('round2DiagRect', ROUND2_DIAG_RECT_HANDLES);
ADJUSTMENT_SPECS.set('upDownArrow', UP_DOWN_ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('leftRightUpArrow', LEFT_RIGHT_UP_ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('notchedRightArrow', NOTCHED_RIGHT_ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('stripedRightArrow', STRIPED_RIGHT_ARROW_ADJUSTMENTS);
ADJUSTMENT_HANDLES.set('upDownArrow', UP_DOWN_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('leftRightUpArrow', LEFT_RIGHT_UP_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('notchedRightArrow', NOTCHED_RIGHT_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('stripedRightArrow', STRIPED_RIGHT_ARROW_HANDLES);
ADJUSTMENT_SPECS.set('bentArrow', BENT_ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('bentUpArrow', BENT_UP_ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('uturnArrow', UTURN_ARROW_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('swooshArrow', SWOOSH_ARROW_ADJUSTMENTS);
ADJUSTMENT_HANDLES.set('bentArrow', BENT_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('bentUpArrow', BENT_UP_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('uturnArrow', UTURN_ARROW_HANDLES);
ADJUSTMENT_HANDLES.set('swooshArrow', SWOOSH_ARROW_HANDLES);
