import type { Element, Frame } from '../../../model/element';
import type { ConnectionSite } from '../../../model/connection-site';
import { fourCardinal } from './defaults';

/**
 * Connection sites for an element. PR1 always returns the 4-cardinal
 * default; PR2 introduces per-ShapeKind overrides.
 */
export function getConnectionSites(_el: Element): readonly ConnectionSite[] {
  return fourCardinal();
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
