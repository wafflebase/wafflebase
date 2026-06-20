import type { FrameSize, Point } from '../builder';

/**
 * `actionButtonHelp` glyph — a question mark, transcribed from the
 * OOXML `actionButtonHelp` preset (hook + stem as one closed subpath,
 * plus a separate dot). The preset draws it with `<a:arcTo>` segments;
 * we replay each arc with a polyline so JSDOM's partial bezier support
 * is never touched, and so the same path strokes cleanly in the picker
 * preview.
 *
 * OOXML `arcTo` is relative: starting from the current point `P`, with
 * radii `(wR, hR)` and a start angle `st`, the ellipse centre is
 * `C = P − (wR·cos st, hR·sin st)`; the arc then sweeps `st → st + sw`.
 * `appendArc` reproduces that and returns the new current point.
 */
const DEG = Math.PI / 180;

function appendArc(
  path: Path2D,
  cur: Point,
  wR: number,
  hR: number,
  stDeg: number,
  swDeg: number,
  segments = 24,
): Point {
  const st = stDeg * DEG;
  const sw = swDeg * DEG;
  const cx = cur.x - wR * Math.cos(st);
  const cy = cur.y - hR * Math.sin(st);
  let end = cur;
  for (let i = 1; i <= segments; i++) {
    const a = st + sw * (i / segments);
    end = { x: cx + wR * Math.cos(a), y: cy + hR * Math.sin(a) };
    path.lineTo(end.x, end.y);
  }
  return end;
}

export function buildHelpGlyph({ w, h }: FrameSize): Path2D {
  const ss = Math.min(w, h);
  const dx2 = (3 / 8) * ss;
  const g9 = h / 2 - dx2; // icon box top
  const g11 = w / 2 - dx2; // icon box left
  const g13 = (3 / 4) * ss; // icon size
  const g14 = g13 / 7;
  const g15 = (g13 * 3) / 14;
  const g16 = (g13 * 2) / 7;
  const g19 = (g13 * 3) / 7;
  const g20 = (g13 * 4) / 7;
  const g21 = (g13 * 17) / 28;
  const g23 = (g13 * 21) / 28;
  const g24 = (g13 * 11) / 14;
  const g41 = g13 / 14;
  const g42 = (g13 * 3) / 28;
  const g27 = g9 + g16;
  const g29 = g9 + g21;
  const g30 = g9 + g23;
  const g31 = g9 + g24;
  const g33 = g11 + g15;
  const g36 = g11 + g19;
  const g37 = g11 + g20;
  const hc = w / 2;

  const path = new Path2D();
  // Hook + stem.
  let cur: Point = { x: g33, y: g27 };
  path.moveTo(cur.x, cur.y);
  cur = appendArc(path, cur, g16, g16, 180, 180);
  cur = appendArc(path, cur, g14, g15, 0, 90);
  cur = appendArc(path, cur, g41, g42, 270, -90);
  path.lineTo(g37, g30);
  cur = { x: g37, y: g30 };
  path.lineTo(g36, g30);
  path.lineTo(g36, g29);
  cur = { x: g36, y: g29 };
  cur = appendArc(path, cur, g14, g15, 180, 90);
  cur = appendArc(path, cur, g41, g42, 90, -90);
  cur = appendArc(path, cur, g14, g14, 0, -180);
  path.closePath();
  // Dot.
  cur = { x: hc, y: g31 };
  path.moveTo(cur.x, cur.y);
  appendArc(path, cur, g42, g42, 270, 360);
  path.closePath();
  return path;
}
