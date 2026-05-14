import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type { ElementInit, ShapeKind } from '../../../model/element';
import type { ThemeColor } from '../../../model/theme';
import type { InsertKind } from '../editor';

// Insert defaults bind to theme roles so new shapes follow the active
// theme — switching the deck's theme repaints them in the new palette.
// Users can override per-shape via the Fill picker (which writes
// concrete `{ kind: 'srgb' }` values).
const DEFAULT_FILL: ThemeColor = { kind: 'role', role: 'accent1' };
const DEFAULT_TEXT_COLOR: ThemeColor = { kind: 'role', role: 'text' };
const DEFAULT_BACKGROUND: ThemeColor = { kind: 'role', role: 'background' };
const DEFAULT_STROKE_WIDTH = 2;
const TEXT_DEFAULT_W = 400;
const TEXT_DEFAULT_H = 80;

export interface Point { x: number; y: number; }

/**
 * Per-shape "no-drag click" default frame in slide-logical coordinates
 * (slide is 1920×1080). When the user picks a shape in the toolbar and
 * then clicks on the slide without dragging, `buildInsertElement` uses
 * this table instead of the zero-sized drag rect. Drag-to-size still
 * wins as soon as the pointer moves more than `CLICK_THRESHOLD_PX`.
 *
 * Sizing principles:
 *   - Rotation-symmetric shapes (circles, polygons, stars, equations)
 *     are square so their geometry isn't squashed.
 *   - Directional shapes (block arrows) are longer along their axis.
 *   - Banners are wide (visual affinity).
 *   - Lines are horizontal by default (h=0) — feels more intentional
 *     than the previous 200×100 diagonal.
 *   - Action buttons are small squares so the inner glyph stays
 *     proportionate.
 */
interface Size { w: number; h: number; }

const LINE_H: Size = { w: 400, h: 0 };
const ARC_HALF: Size = { w: 320, h: 160 };
const SHAPE_WIDE: Size = { w: 320, h: 200 };
const SHAPE_WIDE_240: Size = { w: 240, h: 200 };
const SHAPE_CLOUD: Size = { w: 280, h: 200 };
const FLOWCHART: Size = { w: 280, h: 160 };
const SHAPE_SQUARE: Size = { w: 200, h: 200 };
const SHAPE_SQUARE_L: Size = { w: 240, h: 240 };
const BANNER: Size = { w: 480, h: 140 };
const SCROLL_H: Size = { w: 400, h: 200 };
const SCROLL_V: Size = { w: 200, h: 400 };
const ARROW_H: Size = { w: 320, h: 160 };
const ARROW_V: Size = { w: 160, h: 320 };
const ACTION_BUTTON: Size = { w: 140, h: 140 };

/** Fallback for any future kind not yet listed in `DEFAULT_INSERT_SIZE`. */
const FALLBACK_SIZE: Size = SHAPE_WIDE;

const DEFAULT_INSERT_SIZE: ReadonlyMap<ShapeKind, Size> = new Map<
  ShapeKind,
  Size
>([
  // Lines
  ['line', LINE_H],
  ['arrow', LINE_H],
  ['arc', ARC_HALF],

  // Basic — wide rectangular family
  ...(([
    'rect', 'roundRect', 'plaque', 'bevel', 'foldedCorner',
    'snip1Rect', 'snip2SameRect', 'snip2DiagRect', 'snipRoundRect',
    'round1Rect', 'round2SameRect', 'round2DiagRect',
    'parallelogram', 'trapezoid', 'diagStripe',
  ] as ShapeKind[]).map((k) => [k, SHAPE_WIDE] as const)),

  // Basic — square / rotation-symmetric
  ...(([
    'ellipse', 'donut', 'pie', 'chord', 'blockArc',
    'triangle', 'rtTriangle', 'diamond',
    'pentagon', 'hexagon', 'heptagon', 'octagon', 'decagon', 'dodecagon',
    'plus', 'noSmoking', 'smileyFace', 'heart',
    'sun', 'moon', 'teardrop', 'lightningBolt',
    'frame', 'halfFrame', 'corner',
  ] as ShapeKind[]).map((k) => [k, SHAPE_SQUARE] as const)),

  // Basic — slightly wide (3D / cloud)
  ['can', SHAPE_WIDE_240],
  ['cube', SHAPE_WIDE_240],
  ['cloud', SHAPE_CLOUD],

  // Block arrows — horizontal
  ...(([
    'rightArrow', 'leftArrow', 'leftRightArrow',
    'notchedRightArrow', 'stripedRightArrow',
    'chevron', 'pentagonArrow', 'swooshArrow',
    'curvedRightArrow', 'curvedLeftArrow', 'bentArrow',
  ] as ShapeKind[]).map((k) => [k, ARROW_H] as const)),

  // Block arrows — vertical
  ...(([
    'upArrow', 'downArrow', 'upDownArrow',
    'curvedUpArrow', 'curvedDownArrow', 'bentUpArrow',
  ] as ShapeKind[]).map((k) => [k, ARROW_V] as const)),

  // Block arrows — multi-directional / circular
  ...(([
    'quadArrow', 'uturnArrow', 'circularArrow', 'leftRightUpArrow',
  ] as ShapeKind[]).map((k) => [k, SHAPE_SQUARE_L] as const)),

  // Banners
  ['ribbon', BANNER],
  ['ribbon2', BANNER],
  ['leftRightRibbon', BANNER],
  ['horizontalScroll', SCROLL_H],
  ['verticalScroll', SCROLL_V],

  // Flowchart (all 14)
  ...(([
    'flowChartTerminator', 'flowChartPredefinedProcess',
    'flowChartInternalStorage', 'flowChartDocument',
    'flowChartMultidocument', 'flowChartManualInput',
    'flowChartManualOperation', 'flowChartOffpageConnector',
    'flowChartPunchedCard', 'flowChartPunchedTape',
    'flowChartSummingJunction', 'flowChartOr',
    'flowChartDelay', 'flowChartDisplay',
  ] as ShapeKind[]).map((k) => [k, FLOWCHART] as const)),

  // Callouts
  ['wedgeRectCallout', SHAPE_WIDE],
  ['wedgeRoundRectCallout', SHAPE_WIDE],
  ['wedgeEllipseCallout', SHAPE_WIDE],
  ['cloudCallout', SHAPE_CLOUD],
  ['borderCallout1', SHAPE_WIDE],
  ['borderCallout2', SHAPE_WIDE],
  ['borderCallout3', SHAPE_WIDE],

  // Equation — square symbol
  ...(([
    'mathPlus', 'mathMinus', 'mathMultiply',
    'mathDivide', 'mathEqual', 'mathNotEqual',
  ] as ShapeKind[]).map((k) => [k, SHAPE_SQUARE] as const)),

  // Stars
  ...(([
    'star4', 'star5', 'star6', 'star7', 'star8', 'star10',
  ] as ShapeKind[]).map((k) => [k, SHAPE_SQUARE_L] as const)),

  // Action buttons
  ...(([
    'actionButtonBlank', 'actionButtonBackPrevious',
    'actionButtonForwardNext', 'actionButtonBeginning',
    'actionButtonEnd', 'actionButtonHome', 'actionButtonInformation',
    'actionButtonReturn', 'actionButtonMovie', 'actionButtonSound',
    'actionButtonDocument', 'actionButtonHelp',
  ] as ShapeKind[]).map((k) => [k, ACTION_BUTTON] as const)),
]);

/**
 * Pointer movement (Euclidean) under which we treat a drag as a click
 * and apply the per-kind default size. Matches the resize-handle
 * threshold pattern (`dx² + dy² < N`).
 */
const CLICK_THRESHOLD_PX_SQ = 16;

/** Internal — exposed for tests, not for runtime consumers. */
export function defaultInsertSize(kind: ShapeKind): Size {
  return DEFAULT_INSERT_SIZE.get(kind) ?? FALLBACK_SIZE;
}

/**
 * Per-kind visual category. Determines which fill/stroke combo a freshly
 * inserted shape gets:
 *   - `filled`     — accent1 fill, no stroke (basic shapes, block arrows, equation)
 *   - `outlined`   — background fill, text-coloured stroke (callouts)
 *   - `lineSpecial`— stroke only (line); arrow also fills the head
 */
type ShapeStyle = 'filled' | 'outlined' | 'lineSpecial';

const STYLE_BY_KIND: ReadonlyMap<ShapeKind, ShapeStyle> = new Map<
  ShapeKind,
  ShapeStyle
>([
  // Lines
  ['line', 'lineSpecial'],
  ['arrow', 'lineSpecial'],
  // Basic + Block Arrows + Equation + Stars → filled
  ...((
    [
      'rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond',
      'parallelogram', 'trapezoid',
      'pentagon', 'hexagon', 'heptagon', 'octagon',
      'decagon', 'dodecagon',
      'plus', 'donut', 'can', 'cloud',
      'pie', 'chord', 'blockArc',
      'frame', 'halfFrame', 'corner', 'diagStripe',
      'plaque', 'bevel', 'foldedCorner', 'cube',
      'teardrop', 'smileyFace', 'heart', 'lightningBolt',
      'sun', 'moon', 'noSmoking',
      'snip1Rect', 'snip2SameRect', 'snip2DiagRect', 'snipRoundRect',
      'round1Rect', 'round2SameRect', 'round2DiagRect',
      'rightArrow', 'leftArrow', 'upArrow', 'downArrow',
      'leftRightArrow', 'quadArrow', 'chevron', 'pentagonArrow',
      'upDownArrow', 'leftRightUpArrow',
      'notchedRightArrow', 'stripedRightArrow',
      'bentArrow', 'bentUpArrow', 'uturnArrow', 'swooshArrow',
      'circularArrow',
      'curvedRightArrow', 'curvedLeftArrow',
      'curvedUpArrow', 'curvedDownArrow',
      'ribbon', 'ribbon2', 'horizontalScroll', 'verticalScroll',
      'leftRightRibbon',
      'mathPlus', 'mathMinus', 'mathMultiply',
      'mathDivide', 'mathEqual', 'mathNotEqual',
      'star4', 'star5', 'star6', 'star7', 'star8', 'star10',
    ] as ShapeKind[]
  ).map((k) => [k, 'filled' as ShapeStyle] as const)),
  // Arc → stroke-only (open path). Reuses `lineSpecial` since the
  // dispatcher behaviour we need is the same: stroke = text colour,
  // no fill. Adding a fourth ShapeStyle for one shape would be
  // overkill; the visual outcome matches.
  ['arc', 'lineSpecial'],
  // Callouts → outlined
  ['wedgeRectCallout', 'outlined'],
  ['wedgeRoundRectCallout', 'outlined'],
  ['wedgeEllipseCallout', 'outlined'],
  ['cloudCallout', 'outlined'],
  ['borderCallout1', 'outlined'],
  ['borderCallout2', 'outlined'],
  ['borderCallout3', 'outlined'],
  // Flowchart → outlined
  ['flowChartTerminator', 'outlined'],
  ['flowChartPredefinedProcess', 'outlined'],
  ['flowChartInternalStorage', 'outlined'],
  ['flowChartDocument', 'outlined'],
  ['flowChartMultidocument', 'outlined'],
  ['flowChartManualInput', 'outlined'],
  ['flowChartManualOperation', 'outlined'],
  ['flowChartOffpageConnector', 'outlined'],
  ['flowChartPunchedCard', 'outlined'],
  ['flowChartPunchedTape', 'outlined'],
  ['flowChartSummingJunction', 'outlined'],
  ['flowChartOr', 'outlined'],
  ['flowChartDelay', 'outlined'],
  ['flowChartDisplay', 'outlined'],
  // Action buttons → outlined. `drawActionButton` interprets
  // `data.fill` as the body background and `data.stroke.color` as
  // both the bevel outline and the inner-glyph fill, so the
  // existing `outlined` defaults (background + text-coloured
  // stroke) give the correct two-tone visual.
  ['actionButtonBlank', 'outlined'],
  ['actionButtonBackPrevious', 'outlined'],
  ['actionButtonForwardNext', 'outlined'],
  ['actionButtonBeginning', 'outlined'],
  ['actionButtonEnd', 'outlined'],
  ['actionButtonHome', 'outlined'],
  ['actionButtonInformation', 'outlined'],
  ['actionButtonReturn', 'outlined'],
  ['actionButtonMovie', 'outlined'],
  ['actionButtonSound', 'outlined'],
  ['actionButtonDocument', 'outlined'],
  ['actionButtonHelp', 'outlined'],
]);

function defaultsForShape(
  kind: ShapeKind,
): { fill?: ThemeColor; stroke?: { color: ThemeColor; width: number } } {
  switch (STYLE_BY_KIND.get(kind)) {
    case 'lineSpecial':
      return {
        stroke: { color: DEFAULT_TEXT_COLOR, width: DEFAULT_STROKE_WIDTH },
        ...(kind === 'arrow' ? { fill: DEFAULT_TEXT_COLOR } : {}),
      };
    case 'outlined':
      return {
        fill: DEFAULT_BACKGROUND,
        stroke: { color: DEFAULT_TEXT_COLOR, width: DEFAULT_STROKE_WIDTH },
      };
    case 'filled':
    default:
      return {
        fill: DEFAULT_FILL,
        stroke: { color: DEFAULT_TEXT_COLOR, width: 1 },
      };
  }
}

/**
 * Build the ElementInit for a freshly-inserted element given the
 * pointer's drag start and end. Behaviour:
 *
 *   - `text` — single-click, default-sized box anchored at `start`.
 *   - shape, pointer moved ≥ √CLICK_THRESHOLD_PX_SQ — drag rect.
 *   - shape, pointer ~stationary — per-kind default size from
 *     `DEFAULT_INSERT_SIZE`, top-left anchored at `start`.
 *
 * The click-vs-drag branch used to live inline in
 * `editor.ts:startInsert` as a 4-px-per-axis test; it's centralised
 * here so the context-menu "Insert rectangle" path and the toolbar
 * picker path agree on what a "default-sized" shape looks like.
 */
export function buildInsertElement(
  kind: InsertKind,
  start: Point,
  end: Point,
): ElementInit {
  if (kind === 'text') {
    return {
      type: 'text',
      frame: { x: start.x, y: start.y, w: TEXT_DEFAULT_W, h: TEXT_DEFAULT_H, rotation: 0 },
      data: {
        blocks: [{
          id: 'placeholder',
          type: 'paragraph',
          // Bind the inline color to the deck's `text` role so the box
          // renders in the active theme. The text-renderer's color
          // resolver also remaps the docs default `'#000000'` to the
          // `text` role (covers freshly typed runs that inherit
          // `DEFAULT_INLINE_STYLE` instead of this explicit role).
          inlines: [{ text: '', style: { color: DEFAULT_TEXT_COLOR } }],
          // Fully-defaulted style — `computeLayout` reads `marginTop`
          // and `marginBottom` without a fallback, so a sparse style
          // would NaN the cumulative y and the slide canvas would
          // paint at a different offset than the text-box editor
          // (which seeds through `MemDocStore.setDocument`, which
          // normalises). See `text-renderer.ts:drawText`.
          style: { ...DEFAULT_BLOCK_STYLE },
        } as Block],
      },
    };
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const isClick = dx * dx + dy * dy < CLICK_THRESHOLD_PX_SQ;

  let frame: { x: number; y: number; w: number; h: number; rotation: number };
  if (isClick) {
    const size = defaultInsertSize(kind);
    frame = { x: start.x, y: start.y, w: size.w, h: size.h, rotation: 0 };
  } else {
    frame = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(dx),
      h: Math.abs(dy),
      rotation: 0,
    };
  }

  return { type: 'shape', frame, data: { kind, ...defaultsForShape(kind) } };
}
