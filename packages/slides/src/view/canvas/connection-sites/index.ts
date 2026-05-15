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
 */
export function siteWorldPos(
  el: { frame: Frame },
  site: ConnectionSite,
): { x: number; y: number; angle: number } {
  const lx = site.x * el.frame.w;
  const ly = site.y * el.frame.h;
  const cx = el.frame.w / 2;
  const cy = el.frame.h / 2;
  const r = el.frame.rotation;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rx = cos * (lx - cx) - sin * (ly - cy) + cx;
  const ry = sin * (lx - cx) + cos * (ly - cy) + cy;
  return {
    x: el.frame.x + rx,
    y: el.frame.y + ry,
    angle: site.angle + r,
  };
}
