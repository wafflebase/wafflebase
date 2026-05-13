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
      'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon',
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
 * pointer's drag start and end. Shapes use the drag rectangle as the
 * frame; text uses a default-sized box anchored at the start point
 * (insert text is a single-click operation, not a drag).
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

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  const frame = { x, y, w, h, rotation: 0 };

  return { type: 'shape', frame, data: { kind, ...defaultsForShape(kind) } };
}
