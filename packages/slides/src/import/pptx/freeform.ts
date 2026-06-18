import type { FreeformCommand, FreeformPath } from '../../model/element';
import { attrInt, child, children } from './xml';

/** OOXML angles are in 60000ths of a degree. */
function angToRad(v: number): number {
  return (v / 60_000) * (Math.PI / 180);
}

function pt(el: Element | undefined): { x: number; y: number } | undefined {
  if (!el) return undefined;
  const x = attrInt(el, 'x');
  const y = attrInt(el, 'y');
  if (x == null || y == null) return undefined;
  return { x, y };
}

/**
 * Parse an OOXML `<a:custGeom>` into a normalized {@link FreeformPath}.
 *
 * Each `<a:path w h>` declares its own coordinate space; we normalize
 * every point to `[0, 1]` of that path's `w`/`h` so the renderer can scale
 * the stored geometry to any frame. Multiple `<a:path>` elements are
 * concatenated into one command list (each begins with its own `moveTo`)
 * and painted with the default nonzero winding rule, matching PowerPoint;
 * oppositely-wound sub-paths therefore read as holes, same-wound ones as a
 * union. (A leading `moveTo` per `<a:path>` is assumed, as PowerPoint
 * always emits one.)
 *
 * Supports the segment kinds real-world decks use: `moveTo`, `lnTo`,
 * `quadBezTo`, `cubicBezTo`, `arcTo`, `close`. `arcTo` is reduced to a
 * centre-parametrised elliptical arc by deriving the centre from the
 * current point. Returns `undefined` when there is no usable geometry.
 */
export function parseCustGeomPath(custGeom: Element): FreeformPath | undefined {
  const pathLst = child(custGeom, 'pathLst');
  if (!pathLst) return undefined;

  const commands: FreeformCommand[] = [];

  for (const path of children(pathLst, 'path')) {
    const w = attrInt(path, 'w');
    const h = attrInt(path, 'h');
    // Without a positive viewBox we cannot normalize; skip this sub-path
    // rather than divide by zero and emit NaN coordinates.
    if (!w || !h || w <= 0 || h <= 0) continue;

    const nx = (x: number) => x / w;
    const ny = (y: number) => y / h;
    // Current point in path-space px, needed to centre-parametrise arcs.
    let cur = { x: 0, y: 0 };

    for (let i = 0; i < path.childNodes.length; i++) {
      const node = path.childNodes[i];
      if (node.nodeType !== 1) continue;
      const seg = node as Element;
      switch (seg.localName) {
        case 'moveTo': {
          const p = pt(child(seg, 'pt'));
          if (!p) break;
          cur = p;
          commands.push({ c: 'M', x: nx(p.x), y: ny(p.y) });
          break;
        }
        case 'lnTo': {
          const p = pt(child(seg, 'pt'));
          if (!p) break;
          cur = p;
          commands.push({ c: 'L', x: nx(p.x), y: ny(p.y) });
          break;
        }
        case 'quadBezTo': {
          const pts = children(seg, 'pt');
          const c = pt(pts[0]);
          const end = pt(pts[1]);
          if (!c || !end) break;
          cur = end;
          commands.push({
            c: 'Q',
            x1: nx(c.x),
            y1: ny(c.y),
            x: nx(end.x),
            y: ny(end.y),
          });
          break;
        }
        case 'cubicBezTo': {
          const pts = children(seg, 'pt');
          const c1 = pt(pts[0]);
          const c2 = pt(pts[1]);
          const end = pt(pts[2]);
          if (!c1 || !c2 || !end) break;
          cur = end;
          commands.push({
            c: 'C',
            x1: nx(c1.x),
            y1: ny(c1.y),
            x2: nx(c2.x),
            y2: ny(c2.y),
            x: nx(end.x),
            y: ny(end.y),
          });
          break;
        }
        case 'arcTo': {
          const wR = attrInt(seg, 'wR');
          const hR = attrInt(seg, 'hR');
          const stAngRaw = attrInt(seg, 'stAng');
          const swAngRaw = attrInt(seg, 'swAng');
          if (wR == null || hR == null || stAngRaw == null || swAngRaw == null) {
            break;
          }
          // A non-positive radius is malformed and would make
          // `Path2D.ellipse` throw at render time (negative radius), so
          // skip the segment rather than poison the whole shape's paint.
          if (wR <= 0 || hR <= 0) break;
          const start = angToRad(stAngRaw);
          const sweep = angToRad(swAngRaw);
          // Derive the ellipse centre so it passes through the current
          // point at angle `start` (OOXML's arcTo is relative to the pen).
          const cx = cur.x - wR * Math.cos(start);
          const cy = cur.y - hR * Math.sin(start);
          cur = {
            x: cx + wR * Math.cos(start + sweep),
            y: cy + hR * Math.sin(start + sweep),
          };
          commands.push({
            c: 'A',
            cx: nx(cx),
            cy: ny(cy),
            rx: wR / w,
            ry: hR / h,
            start,
            sweep,
          });
          break;
        }
        case 'close':
          commands.push({ c: 'Z' });
          break;
      }
    }
  }

  return commands.length ? { commands } : undefined;
}
