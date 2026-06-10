import type { ConnectionSite } from '../../../model/connection-site';
import {
  DIR_E,
  DIR_N,
  DIR_NE,
  DIR_NW,
  DIR_S,
  DIR_SE,
  DIR_SW,
  DIR_W,
} from '../../../model/connection-site';
import type { ShapeKind } from '../../../model/element';

/**
 * Per-`ShapeKind` connection-site overrides. Shapes whose default
 * 4-cardinal midpoints are wrong for their geometry (4-sided shapes
 * with vertex-anchored cxnLst or skewed quadrilaterals) declare their
 * own anchor list here. Shapes not in the map fall back to
 * `fourCardinal()`.
 *
 * Scope is intentionally narrow. Overrides ship only for shapes whose
 * OOXML `cxnLst` ordering matches the importer's rect-family
 * `[T,L,B,R] → [N,E,S,W]` index remap
 * (`OOXML_TO_WAFFLE_RECT_SITE_INDEX` in `import/pptx/shape.ts`):
 *
 * - 4-sided shapes following the rect `[T, L, B, R]` cxnLst convention
 *   — diamond, parallelogram, trapezoid. Native authoring AND PPTX
 *   import both land on the correct anchor.
 *
 * Held back pending a per-shape `cxnLst → waffle` index table:
 *
 * - Triangle / rtTriangle (3-site OOXML cxnLst) — the rect remap
 *   would scramble idx 1 / 2 onto the wrong vertex.
 * - n-gons (pentagon / hexagon / octagon / star4..star10) — vertex
 *   ordering is clockwise-from-apex, not `[T, L, B, R]`. Idx 0..3 in
 *   PPTX cxnLst would still pass through the rect remap and land on
 *   the wrong vertex. Native-authored connectors would work, but a
 *   round-tripped PPTX file targeting an n-gon's idx 1 or 3 site
 *   would render at the wrong tip. The follow-up adds per-shape
 *   remap tables for these.
 */

/** 4-vertex diamond, ordered [N, E, S, W] for rect-remap compatibility. */
const DIAMOND_SITES: readonly ConnectionSite[] = Object.freeze([
  { x: 0.5, y: 0,   angle: DIR_N },
  { x: 1,   y: 0.5, angle: DIR_E },
  { x: 0.5, y: 1,   angle: DIR_S },
  { x: 0,   y: 0.5, angle: DIR_W },
]);

/**
 * Parallelogram with the default 25% skew (matching OOXML `prstGeom
 * prst="parallelogram"` adj=25000). Top edge mid sits 12.5% right of
 * the bbox top-left; bottom edge mid 12.5% left of the bbox bottom-
 * right. Sides remain at x=0/x=1 midpoint. Ordered [N, E, S, W].
 */
const PARALLELOGRAM_SITES: readonly ConnectionSite[] = Object.freeze([
  { x: 0.625, y: 0,   angle: DIR_N },
  { x: 1,     y: 0.5, angle: DIR_E },
  { x: 0.375, y: 1,   angle: DIR_S },
  { x: 0,     y: 0.5, angle: DIR_W },
]);

/**
 * Trapezoid with default 25% top-edge inset (matching OOXML
 * `prst="trapezoid"`). Top edge runs from x=0.25 to x=0.75; its
 * midpoint is the perpendicular north anchor. Ordered [N, E, S, W].
 */
const TRAPEZOID_SITES: readonly ConnectionSite[] = Object.freeze([
  { x: 0.5, y: 0,   angle: DIR_N },
  { x: 1,   y: 0.5, angle: DIR_E },
  { x: 0.5, y: 1,   angle: DIR_S },
  { x: 0,   y: 0.5, angle: DIR_W },
]);

/**
 * Ellipse with 8 connection sites — 4 cardinals + 4 diagonals on the
 * ellipse outline. Ordered to match the PPTX `ellipse` preset `cxnLst`
 * (CCW from top), so a PPTX `<a:endCxn idx>` is the site index verbatim:
 *
 *   0 = N    1 = NW   2 = W    3 = SW
 *   4 = S    5 = SE   6 = E    7 = NE
 *
 * Diagonal coordinates are the 45° points on the unit-bbox ellipse:
 * `0.5 ± cos(45°)/2 ≈ 0.5 ± 0.3536 = 0.1464 / 0.8536` on each axis.
 */
const DIAG_LO = 0.5 - Math.SQRT1_2 / 2;
const DIAG_HI = 0.5 + Math.SQRT1_2 / 2;
const ELLIPSE_SITES: readonly ConnectionSite[] = Object.freeze([
  { x: 0.5,     y: 0,       angle: DIR_N  }, // 0: N
  { x: DIAG_LO, y: DIAG_LO, angle: DIR_NW }, // 1: NW
  { x: 0,       y: 0.5,     angle: DIR_W  }, // 2: W
  { x: DIAG_LO, y: DIAG_HI, angle: DIR_SW }, // 3: SW
  { x: 0.5,     y: 1,       angle: DIR_S  }, // 4: S
  { x: DIAG_HI, y: DIAG_HI, angle: DIR_SE }, // 5: SE
  { x: 1,       y: 0.5,     angle: DIR_E  }, // 6: E
  { x: DIAG_HI, y: DIAG_LO, angle: DIR_NE }, // 7: NE
]);

export const CONNECTION_SITES: ReadonlyMap<
  ShapeKind,
  readonly ConnectionSite[]
> = new Map(
  Object.entries({
    diamond: DIAMOND_SITES,
    parallelogram: PARALLELOGRAM_SITES,
    trapezoid: TRAPEZOID_SITES,
    ellipse: ELLIPSE_SITES,
  } satisfies Partial<Record<ShapeKind, readonly ConnectionSite[]>>) as Array<
    [ShapeKind, readonly ConnectionSite[]]
  >,
);
