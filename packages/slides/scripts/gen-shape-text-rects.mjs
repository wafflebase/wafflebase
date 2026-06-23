// Generates `src/view/canvas/shapes/shape-text-rects.generated.ts` — a table
// of per-`ShapeKind` text rectangles (normalized fractions of the frame) ported
// from the canonical OOXML `presetShapeDefinitions.xml`.
//
// PowerPoint lays a shape's inline text inside the preset geometry's `<rect>`,
// which for non-rectangular shapes is meaningfully inset from the bounding box.
// We resolve each preset's `<rect l t r b>` by evaluating its DrawingML guide
// formulas (`<gdLst>`) at the default adjustments (`<avLst>`) on a UNIT SQUARE
// (w = h = 1), so the resolved l/t/r/b are directly fractions of width/height.
// Shapes whose rect equals the full frame are omitted (caller falls back to a
// uniform padding). Only `ShapeKind`s the renderer registers are emitted.
//
// Run: `pnpm slides gen:textrects` (or `node scripts/gen-shape-text-rects.mjs`).
// The committed output is verified to be in sync by `gen:textrects --check`.
//
// Provenance: scripts/presetShapeDefinitions.xml is the ECMA-376 preset
// geometry table (as vendored by docx4j). DO NOT hand-edit the generated file.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const XML_PATH = join(HERE, 'presetShapeDefinitions.xml');
const ELEMENT_PATH = join(HERE, '..', 'src', 'model', 'element.ts');
const OUT_PATH = join(
  HERE,
  '..',
  'src',
  'view',
  'canvas',
  'shapes',
  'shape-text-rects.generated.ts',
);

// OOXML preset name → wafflebase ShapeKind, for the few that differ. Mirrors
// `PRST_ALIASES` in src/import/pptx/geometry.ts.
const PRST_ALIASES = { homePlate: 'pentagonArrow' };

/** A rect is "full frame" (no entry needed) when within EPS of the box edges. */
const EPS = 1e-3;

// ── DrawingML guide-formula evaluator ──────────────────────────────────────
// Angles are in 60000ths of a degree; sin/cos/tan take (value, angle).
const DEG = Math.PI / 180 / 60000;

function builtinGuides(w, h) {
  const ss = Math.min(w, h);
  const ls = Math.max(w, h);
  return {
    l: 0, t: 0, r: w, b: h, w, h, hc: w / 2, vc: h / 2, '0': 0,
    wd2: w / 2, wd3: w / 3, wd4: w / 4, wd5: w / 5, wd6: w / 6,
    wd8: w / 8, wd10: w / 10, wd12: w / 12, wd32: w / 32,
    hd2: h / 2, hd3: h / 3, hd4: h / 4, hd5: h / 5, hd6: h / 6,
    hd8: h / 8, hd10: h / 10, hd12: h / 12, hd32: h / 32,
    ss, ls, ssd2: ss / 2, ssd4: ss / 4, ssd6: ss / 6,
    ssd8: ss / 8, ssd16: ss / 16, ssd32: ss / 32,
    cd2: 10800000, cd4: 5400000, cd8: 2700000,
    '3cd4': 16200000, '3cd8': 8100000, '5cd8': 13500000, '7cd8': 18900000,
  };
}

function applyOp(op, a, b, c) {
  switch (op) {
    case '*/': return (a * b) / c;
    case '+-': return a + b - c;
    case '+/': return (a + b) / c;
    case '?:': return a > 0 ? b : c;
    case 'val': return a;
    case 'abs': return Math.abs(a);
    case 'min': return Math.min(a, b);
    case 'max': return Math.max(a, b);
    case 'sqrt': return Math.sqrt(a);
    case 'mod': return Math.sqrt(a * a + b * b + c * c);
    case 'sin': return a * Math.sin(b * DEG);
    case 'cos': return a * Math.cos(b * DEG);
    case 'tan': return a * Math.tan(b * DEG);
    case 'pin': return b < a ? a : b > c ? c : b;
    case 'at2': return Math.atan2(c, b) / DEG;
    case 'cat2': return a * Math.cos(Math.atan2(c, b));
    case 'sat2': return a * Math.sin(Math.atan2(c, b));
    default: throw new Error(`unsupported guide op: ${op}`);
  }
}

/** Resolve a token (number, builtin guide, adjustment, or computed guide). */
function resolveToken(tok, table) {
  if (tok in table) return table[tok];
  const n = Number(tok);
  if (Number.isFinite(n)) return n;
  throw new Error(`unknown guide token: ${tok}`);
}

function evalFormula(fmla, table) {
  const parts = fmla.trim().split(/\s+/);
  const op = parts[0];
  const args = parts.slice(1).map((t) => resolveToken(t, table));
  return applyOp(op, args[0], args[1], args[2]);
}

// ── XML extraction (the preset file is uniform; a light scan suffices) ──────
function gdEntries(block) {
  const out = [];
  const re = /<gd\s+name="([^"]+)"\s+fmla="([^"]+)"\s*\/>/g;
  let m;
  while ((m = re.exec(block))) out.push([m[1], m[2]]);
  return out;
}

function section(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : '';
}

function resolveRect(block) {
  const rm = block.match(
    /<rect\s+l="([^"]+)"\s+t="([^"]+)"\s+r="([^"]+)"\s+b="([^"]+)"/,
  );
  if (!rm) return null;
  const table = builtinGuides(1, 1);
  for (const [name, fmla] of gdEntries(section(block, 'avLst'))) {
    table[name] = evalFormula(fmla, table);
  }
  for (const [name, fmla] of gdEntries(section(block, 'gdLst'))) {
    table[name] = evalFormula(fmla, table);
  }
  const [l, t, r, b] = rm.slice(1, 5).map((tok) => resolveToken(tok, table));
  if (![l, t, r, b].every(Number.isFinite)) return null;
  return { l, t, r, b };
}

function isFullFrame({ l, t, r, b }) {
  return l < EPS && t < EPS && r > 1 - EPS && b > 1 - EPS;
}

/**
 * Degenerate rect (zero/negative width or height). Happens for presets whose
 * text rect depends on adjustments we evaluate at a single default — e.g.
 * `pie`, whose rect collapses at the default sweep. The renderer falls back to
 * uniform padding for these, which is far better than a 0-wide text box.
 */
function isDegenerate({ l, t, r, b }) {
  return r - l < EPS || b - t < EPS;
}

function shapeKinds() {
  const src = readFileSync(ELEMENT_PATH, 'utf8');
  const start = src.indexOf('export type ShapeKind =');
  const end = src.indexOf(';', start);
  const body = src.slice(start, end);
  return new Set([...body.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]));
}

// ── Generate ────────────────────────────────────────────────────────────────
function generate() {
  // The vendored XML uses CRLF; normalize so the LF-based scans below match.
  const xml = readFileSync(XML_PATH, 'utf8').replace(/\r\n/g, '\n');
  const kinds = shapeKinds();
  const names = [...xml.matchAll(/\n {2}<([A-Za-z0-9]+)>\n/g)].map((m) => ({
    name: m[1],
    pos: m.index,
  }));
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < names.length; i++) {
    const { name, pos } = names[i];
    const block = xml.slice(pos, i + 1 < names.length ? names[i + 1].pos : xml.length);
    const kind = PRST_ALIASES[name] ?? name;
    if (!kinds.has(kind)) continue;
    // The canonical file lists a few presets (e.g. `upDownArrow`) twice; keep
    // the first so the emitted object has no duplicate keys.
    if (seen.has(kind)) continue;
    let rect;
    try {
      rect = resolveRect(block);
    } catch {
      // A preset whose rect needs an op/guide we don't model, or whose source
      // formula has a typo (e.g. `leftArrow` references an undefined guide in
      // the canonical file): skip it (renderer falls back to uniform padding).
      seen.add(kind);
      rows.push({ kind, skipped: true });
      continue;
    }
    seen.add(kind);
    if (!rect || isFullFrame(rect) || isDegenerate(rect)) continue;
    rows.push({ kind, rect });
  }
  return rows;
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

function render(rows) {
  const entries = rows
    .filter((r) => r.rect)
    .sort((a, b) => a.kind.localeCompare(b.kind))
    .map(
      (r) =>
        `  ${/^[A-Za-z_$][\w$]*$/.test(r.kind) ? r.kind : `'${r.kind}'`}: { ` +
        `l: ${round(r.rect.l)}, t: ${round(r.rect.t)}, ` +
        `r: ${round(r.rect.r)}, b: ${round(r.rect.b)} },`,
    )
    .join('\n');
  return `// @generated by scripts/gen-shape-text-rects.mjs — DO NOT EDIT.
// Regenerate with \`pnpm slides gen:textrects\`.
//
// Per-ShapeKind text rectangle (fractions of the frame: l/r of width,
// t/b of height) resolved from the OOXML preset \`<rect>\` on a unit square.
// Only kinds whose rect differs from the full frame are listed.
import type { ShapeKind } from '../../../model/element';

export const GENERATED_SHAPE_TEXT_RECTS: Partial<
  Record<ShapeKind, { l: number; t: number; r: number; b: number }>
> = {
${entries}
};
`;
}

const rows = generate();
const out = render(rows);
const check = process.argv.includes('--check');

if (check) {
  const current = readFileSync(OUT_PATH, 'utf8');
  if (current !== out) {
    console.error(
      '[gen:textrects] generated file is stale — run `pnpm slides gen:textrects`.',
    );
    process.exit(1);
  }
  console.log('[gen:textrects] up to date.');
} else {
  writeFileSync(OUT_PATH, out);
  const emitted = rows.filter((r) => r.rect).length;
  const skipped = rows.filter((r) => r.skipped).map((r) => r.kind);
  console.log(`[gen:textrects] wrote ${emitted} text rects to ${OUT_PATH}`);
  if (skipped.length) {
    console.log(
      `[gen:textrects] ${skipped.length} kind(s) skipped (unmodeled formula): ${skipped.join(', ')}`,
    );
  }
}
