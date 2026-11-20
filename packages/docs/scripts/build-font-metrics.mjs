// @ts-nocheck
/**
 * Generates `src/view/font-metrics.data.ts`: the vertical metrics the docs
 * layout uses to size a line the way Google Docs does
 * (`docs/design/docs/docs-named-styles.md` § Leading is font-relative).
 *
 * Run on demand (NOT part of the build), then commit the output:
 *
 *   node packages/docs/scripts/build-font-metrics.mjs
 *
 * Why a committed table rather than a runtime `measureText()` read: the docs
 * layout runs in the browser, in Node (CLI pagination, PDF export) and before
 * web fonts finish loading. A metric read at runtime would differ between
 * those, and a different line height is a page break in a different place.
 *
 * What Google Docs does, as measured (2026-11-21, see the task's lessons
 * file): a font's single line is its "normal" line height — the `OS/2` typo
 * metrics when `USE_TYPO_METRICS` is set, else `hhea` — as
 * `(ascent + descent + lineGap) / unitsPerEm`, and CJK fonts get 1.3× that,
 * the extra split evenly above and below the glyphs. Seven Latin and four
 * Korean families matched within 0.003 em; Roboto did not (Docs serves its own
 * build) and is listed in `MEASURED` instead.
 *
 * Sources, in priority order:
 *   1. `MEASURED` — numbers read off Google Docs itself.
 *   2. `SYSTEM` — local/system families, whose files are not on Google Fonts
 *      (values read with fontkit from the macOS copies).
 *   3. Every web font in the curated catalog
 *      (`packages/frontend/.../font-catalog.data.ts`), fetched from Google
 *      Fonts as TTF.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = join(
  HERE,
  '../../frontend/src/components/text-formatting/font-catalog.data.ts',
);
const OUT = join(HERE, '../src/view/font-metrics.data.ts');

/** Google Docs gives a CJK font this multiple of its normal line height. */
const CJK_SCALE = 1.3;
const CJK_SCRIPTS = new Set([
  'korean', 'japanese', 'chinese-simplified', 'chinese-traditional', 'chinese-hongkong',
]);

/**
 * Measured in Google Docs at 72 pt, Single: `[above, below]` of the first
 * baseline, in em. Wins over anything computed.
 */
const MEASURED = {
  // Docs' own Roboto build: 1.2005 em per line, cap top 237 device px at
  // DPR 2, against 1.1719 em computed from the Google Fonts file.
  Roboto: { above: 0.9453, below: 0.2552 },
};

/**
 * Families with no Google Fonts file, as `[ascent, descent, lineGap]` em
 * (fontkit over the macOS Supplemental copies; none sets USE_TYPO_METRICS).
 * Helvetica takes Arial's metrics: Arial was drawn metric-compatible with it,
 * and the macOS Helvetica is a `.ttc` whose metrics differ by platform.
 * Cambria, 맑은 고딕 and 바탕 ship only with Windows/Office and are left to
 * the runtime fallback rather than guessed.
 */
const SYSTEM = {
  Arial: [0.9053, 0.2119, 0.0327],
  Helvetica: [0.9053, 0.2119, 0.0327],
  Tahoma: [1.0005, 0.2065, 0],
  Verdana: [1.0054, 0.21, 0],
  'Times New Roman': [0.8911, 0.2163, 0.0425],
  Georgia: [0.917, 0.2192, 0],
  'Courier New': [0.8325, 0.3003, 0],
};

/** `{ family, webFont, scripts }` for every curated catalog entry. */
async function readCatalog() {
  const src = await readFile(CATALOG, 'utf8');
  const out = [];
  for (const line of src.split('\n')) {
    const family = line.match(/family: "([^"]+)"/)?.[1];
    if (!family) continue;
    const webFont = /webFont: true/.test(line);
    const scripts = JSON.parse(line.match(/scripts: (\[[^\]]*\])/)?.[1] ?? '[]');
    // A single-cut face (Sunflower has no 400) must be asked for a weight it
    // has, or the CSS API answers with an error payload.
    const weight = line.match(/weights: "(\d+)/)?.[1] ?? '400';
    out.push({ family, webFont, scripts, weight });
  }
  return out;
}

/** One cut's TTF from the Google Fonts CSS API. */
async function fetchTtf(family, weight) {
  const query = `${encodeURIComponent(family)}:wght@${weight}`;
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${query}`)).text();
  const url = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
  if (!url) throw new Error(`${family}: no font URL in the CSS response`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${family}: ${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** `[ascent, descent, lineGap]` in em, the way a browser picks them. */
function normalMetrics(buf) {
  const font = fontkit.create(buf);
  const upm = font.unitsPerEm;
  const os2 = font['OS/2'];
  const useTypo = Boolean(os2?.fsSelection?.useTypoMetrics);
  const [a, d, g] = useTypo
    ? [os2.typoAscender, -os2.typoDescender, os2.typoLineGap]
    : [font.hhea.ascent, -font.hhea.descent, font.hhea.lineGap];
  return [a / upm, d / upm, g / upm];
}

/** `{ above, below }` of a single line, in em. */
function toLine([ascent, descent, lineGap], scale) {
  const normal = ascent + descent + lineGap;
  const single = normal * scale;
  // The line gap sits above the ascent (measured: Arial's first cap top is
  // one gap lower than ascent alone puts it); a CJK font's extra 0.3× is
  // split evenly.
  const above = lineGap + ascent + (single - normal) / 2;
  return { above, below: single - above };
}

const round = (n) => Math.round(n * 10000) / 10000;

async function main() {
  const entries = new Map();
  for (const [family, m] of Object.entries(SYSTEM)) entries.set(family, toLine(m, 1));

  for (const { family, webFont, scripts, weight } of await readCatalog()) {
    if (!webFont || entries.has(family)) continue;
    const scale = scripts.some((s) => CJK_SCRIPTS.has(s)) ? CJK_SCALE : 1;
    entries.set(family, toLine(normalMetrics(await fetchTtf(family, weight)), scale));
    process.stdout.write('.');
  }
  for (const [family, line] of Object.entries(MEASURED)) entries.set(family, line);

  const rows = [...entries]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, { above, below }]) =>
      `  ${JSON.stringify(family.toLowerCase())}: [${round(above)}, ${round(below)}],`);
  await writeFile(
    OUT,
    `// GENERATED by scripts/build-font-metrics.mjs — do not edit by hand.
// Re-run the generator to refresh, then commit the output.

/**
 * A single line of each family, as \`[above, below]\` its first baseline in
 * em, keyed by lowercase family name. See \`font-metrics.ts\`.
 */
export const FONT_LINE_METRICS: Readonly<Record<string, readonly [number, number]>> = {
${rows.join('\n')}
};
`,
  );
  console.log(`\nwrote ${entries.size} families → ${OUT}`);
}

await main();
