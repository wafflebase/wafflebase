import type { FreeformPath, Frame } from '../../model/element.js';

/**
 * The custGeom path coordinate space uses a fixed 100 000-unit guide so
 * that the renderer can scale the path to any frame size.  The importer
 * normalizes all coordinates to `[0, 1]` of the `<a:path w h>` extents;
 * we scale back to `GUIDE` on export so the round-trip is lossless.
 */
const GUIDE = 100_000;

/** Convert a [0,1]-normalized coordinate to GUIDE path-space. */
const g = (v: number): number => Math.round(v * GUIDE);

/**
 * Convert radians to OOXML 60 000ths-of-a-degree angle units.
 * Inverse of `angToRad` in `src/import/pptx/freeform.ts`.
 */
const radTo60k = (rad: number): number => Math.round(rad * (180 / Math.PI) * 60_000);

/**
 * Serialize a normalized {@link FreeformPath} to an OOXML `<a:custGeom>`.
 *
 * Coordinate space: the importer stores commands normalized to `[0, 1]`
 * of the path's own `<a:path w h>` extents.  We export with
 * `w = h = GUIDE (100 000)` so coordinates round-trip without loss.
 *
 * Arc encoding: the importer reduces OOXML `<a:arcTo wR hR stAng swAng>`
 * (a pen-relative arc) to a centre-parametrised form
 * `{ cx, cy, rx, ry, start, sweep }` with angles in radians.  The
 * inverse here re-emits `<a:arcTo>` using the GUIDE-scaled radii and
 * the angles converted back to OOXML 60 000ths-of-a-degree.
 *
 * Note: OOXML `<a:arcTo>` does NOT carry the arc centre — it is
 * pen-relative (the centre is inferred from the current point + start
 * angle + radii, exactly as the importer reverses it).  Re-emitting it
 * with `wR/hR/stAng/swAng` is therefore the correct inverse.
 */
export function freeformToCustGeom(path: FreeformPath, _frame: Frame): string {
  const cmds = path.commands
    .map((c) => {
      switch (c.c) {
        case 'M':
          return `<a:moveTo><a:pt x="${g(c.x)}" y="${g(c.y)}"/></a:moveTo>`;
        case 'L':
          return `<a:lnTo><a:pt x="${g(c.x)}" y="${g(c.y)}"/></a:lnTo>`;
        case 'Q':
          return (
            `<a:quadBezTo>` +
            `<a:pt x="${g(c.x1)}" y="${g(c.y1)}"/>` +
            `<a:pt x="${g(c.x)}" y="${g(c.y)}"/>` +
            `</a:quadBezTo>`
          );
        case 'C':
          return (
            `<a:cubicBezTo>` +
            `<a:pt x="${g(c.x1)}" y="${g(c.y1)}"/>` +
            `<a:pt x="${g(c.x2)}" y="${g(c.y2)}"/>` +
            `<a:pt x="${g(c.x)}" y="${g(c.y)}"/>` +
            `</a:cubicBezTo>`
          );
        case 'A':
          // rx/ry are normalized to [0,1]; scale to GUIDE for OOXML wR/hR.
          // start/sweep are in radians; convert to OOXML 60000ths of a degree.
          return (
            `<a:arcTo` +
            ` wR="${g(c.rx)}"` +
            ` hR="${g(c.ry)}"` +
            ` stAng="${radTo60k(c.start)}"` +
            ` swAng="${radTo60k(c.sweep)}"/>`
          );
        case 'Z':
          return `<a:close/>`;
      }
    })
    .join('');
  return (
    `<a:custGeom>` +
    `<a:avLst/>` +
    `<a:gdLst/>` +
    `<a:rect l="0" t="0" r="${GUIDE}" b="${GUIDE}"/>` +
    `<a:pathLst>` +
    `<a:path w="${GUIDE}" h="${GUIDE}">${cmds}</a:path>` +
    `</a:pathLst>` +
    `</a:custGeom>`
  );
}
