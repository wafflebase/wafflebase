import type { ConnectionSite } from '../../../model/connection-site';
import {
  DIR_E,
  DIR_N,
  DIR_S,
  DIR_W,
} from '../../../model/connection-site';
import type { ShapeKind } from '../../../model/element';

/**
 * Per-`ShapeKind` connection-site overrides. Shapes whose default
 * 4-cardinal midpoints are clearly wrong (vertex-anchored geometry,
 * skewed quadrilaterals, regular n-gons) declare their own anchor list
 * here so attached connectors land on the visually-correct point.
 * Shapes not in the map fall back to `fourCardinal()`.
 *
 * Overrides are gated to shapes whose OOXML `cxnLst` ordering is
 * compatible with the importer's rect-family `[T,L,B,R] → [N,E,S,W]`
 * index remap (`OOXML_TO_WAFFLE_RECT_SITE_INDEX` in
 * `import/pptx/shape.ts`):
 *
 * - 4-sided shapes whose OOXML cxnLst follows the rect convention
 *   ([T, L, B, R]) — diamond, parallelogram, trapezoid, star4.
 * - 5+ sided shapes where OOXML `idx >= 4` bypasses the remap entirely
 *   (`?? idx`) — pentagon, hexagon, octagon, star5/6/7/8/10.
 *
 * Triangle / rtTriangle (3-site OOXML cxnLst) are intentionally absent
 * — the rect remap would scramble their indices. Adding them needs a
 * per-shape ooxml→waffle index table.
 */

const TOP_VERTEX: ConnectionSite = { x: 0.5, y: 0, angle: DIR_N };

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
 * Regular polygon outer-vertex helper — apex-up, evenly spaced around
 * centre. Index 0 = top vertex; subsequent indices step clockwise.
 */
function regularPolygonVertices(n: number): ConnectionSite[] {
  const sites: ConnectionSite[] = [];
  for (let i = 0; i < n; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = 0.5 + 0.5 * Math.cos(theta);
    const y = 0.5 + 0.5 * Math.sin(theta);
    sites.push({ x, y, angle: theta });
  }
  return sites;
}

const PENTAGON_SITES = Object.freeze(regularPolygonVertices(5));
const HEXAGON_SITES = Object.freeze(regularPolygonVertices(6));
const OCTAGON_SITES = Object.freeze(regularPolygonVertices(8));

/**
 * N-pointed star outer-tip anchors. PowerPoint also exposes inner
 * vertices for stars; we ship the outer ring only, which covers the
 * "connect to a star tip" case.
 */
function starOuterTips(n: number): readonly ConnectionSite[] {
  return Object.freeze(regularPolygonVertices(n));
}

const STAR_SITES: Partial<Record<ShapeKind, readonly ConnectionSite[]>> = {
  star4: starOuterTips(4),
  star5: starOuterTips(5),
  star6: starOuterTips(6),
  star7: starOuterTips(7),
  star8: starOuterTips(8),
  star10: starOuterTips(10),
};

export const CONNECTION_SITES: ReadonlyMap<
  ShapeKind,
  readonly ConnectionSite[]
> = new Map(
  Object.entries({
    diamond: DIAMOND_SITES,
    parallelogram: PARALLELOGRAM_SITES,
    trapezoid: TRAPEZOID_SITES,
    pentagon: PENTAGON_SITES,
    hexagon: HEXAGON_SITES,
    octagon: OCTAGON_SITES,
    ...STAR_SITES,
  } satisfies Partial<Record<ShapeKind, readonly ConnectionSite[]>>) as Array<
    [ShapeKind, readonly ConnectionSite[]]
  >,
);

export { TOP_VERTEX };
