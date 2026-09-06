import type { Element, Frame, ShapeKind } from '../../../model/element';
import type { ConnectionSite } from '../../../model/connection-site';
import { fourCardinal } from './defaults';
import { CONNECTION_SITES } from './overrides';

/**
 * Connection sites for an element. Shapes with a `ShapeKind` entry in
 * `CONNECTION_SITES` (diamond / parallelogram / trapezoid today) use
 * the override list; everything else falls back to the default
 * 4-cardinal midpoints. Connectors and non-shape elements (text /
 * image / table / chart) always get the cardinal set. See
 * `overrides.ts` for the scope rationale and the held-back shape list
 * (triangle / rtTriangle / n-gons), which need a per-shape
 * `cxnLst → waffle` index table before they can ship.
 */
export function getConnectionSites(el: Element): readonly ConnectionSite[] {
  return connectionSitesForKind(el.type === 'shape' ? el.data.kind : undefined);
}

/**
 * The same site list, addressed by shape KIND rather than by a built element.
 *
 * Importers choose a `siteIndex` while assembling `ElementInit`s, before any
 * `Element` exists to pass to {@link getConnectionSites}. Without this they
 * have to assume the four-cardinal list, and that assumption is wrong for
 * every kind in `CONNECTION_SITES` — most damagingly `ellipse`, whose eight
 * sites put NW at index 1 where the cardinal list has E, so a connector meant
 * for a circle's right-hand side attaches to its top-left and bows away along
 * that outward normal.
 *
 * `undefined` (a non-shape element: text, image, table, chart, or a connector)
 * gets the cardinal set, matching `getConnectionSites`.
 */
export function connectionSitesForKind(
  kind: ShapeKind | undefined,
): readonly ConnectionSite[] {
  const override = kind ? CONNECTION_SITES.get(kind) : undefined;
  return override ?? fourCardinal();
}

/**
 * World-space position and outward-normal angle of a connection site
 * on `el`. `el.frame` is in slide-logical coordinates.
 *
 * Mirrors the paint-time transform order in `element-renderer.ts`:
 * `translate(centre) → rotate → scale(flip) → translate(-w/2,-h/2)`.
 * Applied to a local point that means flip first (centre-relative),
 * then rotate, then place in world coords. OOXML `cxnLst` entries
 * (and therefore stored `ConnectionSite`s) are in pre-flip local
 * coords, so attached connectors land on the visually-correct edge
 * even when the target has `flipH`/`flipV` set.
 */
export function siteWorldPos(
  el: { frame: Frame },
  site: ConnectionSite,
): { x: number; y: number; angle: number } {
  let lx = site.x * el.frame.w;
  let ly = site.y * el.frame.h;
  if (el.frame.flipH) lx = el.frame.w - lx;
  if (el.frame.flipV) ly = el.frame.h - ly;
  const cx = el.frame.w / 2;
  const cy = el.frame.h / 2;
  const r = el.frame.rotation;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rx = cos * (lx - cx) - sin * (ly - cy) + cx;
  const ry = sin * (lx - cx) + cos * (ly - cy) + cy;
  let a = site.angle;
  if (el.frame.flipH) a = Math.PI - a;
  if (el.frame.flipV) a = -a;
  return {
    x: el.frame.x + rx,
    y: el.frame.y + ry,
    angle: a + r,
  };
}
