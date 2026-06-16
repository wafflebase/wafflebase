// @ts-nocheck
/**
 * Generates `src/components/text-formatting/font-catalog.data.ts` — the
 * data backing the shared font picker.
 *
 * Run on demand (NOT part of the build), then commit the output:
 *
 *   node packages/frontend/scripts/build-font-catalog.mjs
 *
 * Why a generator: the dangerous field is `weights`. Google Fonts'
 * css2 endpoint returns an error CSS payload when an unavailable weight
 * is requested, and a single bad family poisons the whole `<link>`. The
 * generator reads each family's authoritative `METADATA.pb` from the
 * `google/fonts` repo to derive the real weight axis (static `fonts {
 * weight }` entries plus any variable `axes { tag: "wght" }` range),
 * the `license` (the webfonts REST API does NOT expose it — only the
 * repo does), the `category`, and the `subsets` (scripts).
 *
 * System (non-Google) families — Arial, 맑은 고딕, etc. — are declared
 * inline here with no network lookup; the browser uses whatever is
 * installed.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/components/text-formatting/font-catalog.data.ts',
);

const RAW_BASE = 'https://raw.githubusercontent.com/google/fonts/main';
const LICENSE_DIRS = /** @type {const} */ (['ofl', 'apache', 'ufl']);
const LICENSE_OF = { ofl: 'OFL', apache: 'APACHE2', ufl: 'UFL' };

/**
 * Families loaded eagerly in the bootstrap CSS link so existing
 * documents render with no flash. Kept to the set the editors already
 * shipped before the catalog expansion — everything else lazy-loads.
 */
const EAGER = new Set([
  'Noto Sans KR', 'Noto Serif KR', 'Nanum Gothic', 'Nanum Myeongjo',
  'Gothic A1', 'Gowun Dodum', 'Gowun Batang', 'Roboto',
]);

/**
 * Curated Google Fonts seed. `label` overrides the display name (used
 * for Korean families); group is auto-derived from metadata (korean
 * subset → Korean, else the GF category) unless overridden.
 */
const GOOGLE_SEED = [
  // Korean
  { family: 'Noto Sans KR', label: 'Noto Sans KR' },
  { family: 'Noto Serif KR', label: 'Noto Serif KR' },
  { family: 'Nanum Gothic', label: '나눔고딕' },
  { family: 'Nanum Myeongjo', label: '나눔명조' },
  { family: 'Nanum Gothic Coding', label: '나눔고딕코딩' },
  { family: 'Nanum Pen Script', label: '나눔손글씨 펜' },
  { family: 'Nanum Brush Script', label: '나눔손글씨 붓' },
  { family: 'Gothic A1' },
  { family: 'Gowun Dodum', label: '고운돋움' },
  { family: 'Gowun Batang', label: '고운바탕' },
  { family: 'IBM Plex Sans KR' },
  { family: 'Black Han Sans', label: '검은고딕' },
  { family: 'Jua', label: '주아' },
  { family: 'Do Hyeon', label: '도현' },
  { family: 'Gugi', label: '구기' },
  { family: 'Gamja Flower', label: '감자꽃' },
  { family: 'Sunflower', label: '해바라기' },
  { family: 'Song Myung', label: '송명' },
  { family: 'Gaegu', label: '개구' },
  { family: 'Hi Melody', label: '하이멜로디' },
  // Sans-serif
  { family: 'Open Sans' },
  { family: 'Lato' },
  { family: 'Montserrat' },
  { family: 'Poppins' },
  { family: 'Inter' },
  { family: 'Work Sans' },
  { family: 'Nunito' },
  { family: 'Nunito Sans' },
  { family: 'Raleway' },
  { family: 'Oswald' },
  { family: 'Source Sans 3' },
  { family: 'PT Sans' },
  { family: 'Rubik' },
  { family: 'Mulish' },
  { family: 'DM Sans' },
  { family: 'Manrope' },
  { family: 'Karla' },
  { family: 'Barlow' },
  { family: 'Quicksand' },
  { family: 'Josefin Sans' },
  { family: 'Figtree' },
  { family: 'Outfit' },
  { family: 'Archivo' },
  { family: 'Roboto' },
  // Serif
  { family: 'Merriweather' },
  { family: 'Playfair Display' },
  { family: 'Lora' },
  { family: 'PT Serif' },
  { family: 'Noto Serif' },
  { family: 'Source Serif 4' },
  { family: 'EB Garamond' },
  { family: 'Cormorant' },
  { family: 'Cormorant Garamond' },
  { family: 'Crimson Text' },
  { family: 'Bitter' },
  { family: 'Libre Baskerville' },
  { family: 'Spectral' },
  { family: 'Zilla Slab' },
  // Monospace
  { family: 'Roboto Mono' },
  { family: 'JetBrains Mono' },
  { family: 'Source Code Pro' },
  { family: 'Space Mono' },
  { family: 'IBM Plex Mono' },
  { family: 'Inconsolata' },
  { family: 'Fira Code' },
  { family: 'Ubuntu Mono' },
  // Display
  { family: 'Bebas Neue' },
  { family: 'Anton' },
  { family: 'Lobster' },
  { family: 'Abril Fatface' },
  { family: 'Righteous' },
  { family: 'Comfortaa' },
  { family: 'Archivo Black' },
  { family: 'Pacifico' },
  { family: 'Fredoka' },
  { family: 'Teko' },
  { family: 'Alfa Slab One' },
  { family: 'Bungee' },
  { family: 'Passion One' },
  { family: 'Titan One' },
  // Handwriting
  { family: 'Caveat' },
  { family: 'Dancing Script' },
  { family: 'Shadows Into Light' },
  { family: 'Satisfy' },
  { family: 'Sacramento' },
  { family: 'Great Vibes' },
  { family: 'Indie Flower' },
  { family: 'Permanent Marker' },
  { family: 'Amatic SC' },
  { family: 'Kalam' },
  { family: 'Patrick Hand' },
  { family: 'Gloria Hallelujah' },
  { family: 'Courgette' },
  { family: 'Cookie' },
];

/**
 * System (non-Google) families. No web font is fetched — the renderer
 * relies on the OS-installed face, falling back through the docs font
 * registry's CSS stacks.
 */
const SYSTEM_SEED = [
  { family: '맑은 고딕', group: 'Korean' },
  { family: '바탕', group: 'Korean' },
  { family: 'Arial', group: 'Sans-serif' },
  { family: 'Helvetica', group: 'Sans-serif' },
  { family: 'Tahoma', group: 'Sans-serif' },
  { family: 'Verdana', group: 'Sans-serif' },
  { family: 'Times New Roman', group: 'Serif' },
  { family: 'Georgia', group: 'Serif' },
  { family: 'Cambria', group: 'Serif' },
  { family: 'Courier New', group: 'Monospace' },
];

const CATEGORY_TO_GROUP = {
  SANS_SERIF: 'Sans-serif',
  SERIF: 'Serif',
  MONOSPACE: 'Monospace',
  DISPLAY: 'Display',
  HANDWRITING: 'Handwriting',
};

/** Google Fonts slug: lowercase, strip everything but [a-z0-9]. */
function slug(family) {
  return family.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchMetadata(family) {
  const s = slug(family);
  for (const dir of LICENSE_DIRS) {
    const res = await fetch(`${RAW_BASE}/${dir}/${s}/METADATA.pb`);
    if (res.ok) return { dir, text: await res.text() };
  }
  return null;
}

function parseMetadata(text) {
  const name = (text.match(/^name: "([^"]+)"/m) || [])[1];
  const category = (text.match(/^category: "([^"]+)"/m) || [])[1];
  const staticWeights = new Set(
    [...text.matchAll(/^\s*weight: (\d+)/gm)].map((m) => Number(m[1])),
  );
  const subsets = [...text.matchAll(/^subsets: "([^"]+)"/gm)]
    .map((m) => m[1])
    .filter((s) => s !== 'menu');
  // Variable wght axis range, when present.
  const axis = text.match(
    /axes \{\s*tag: "wght"\s*min_value: ([\d.]+)\s*max_value: ([\d.]+)/,
  );
  const wghtRange = axis ? { min: Number(axis[1]), max: Number(axis[2]) } : null;
  return { name, category, staticWeights, subsets, wghtRange };
}

/** css2 `wght@…` spec from the real axis. Prefers 400;700; falls back to
 *  the single available weight so single-cut display/script faces don't
 *  request a missing 700 (which would error the whole CSS payload). */
function weightsSpec({ staticWeights, wghtRange }) {
  const has = (w) =>
    staticWeights.has(w) || (wghtRange && w >= wghtRange.min && w <= wghtRange.max);
  const wanted = [400, 700].filter(has);
  if (wanted.length > 0) return wanted.join(';');
  if (staticWeights.size > 0) return String([...staticWeights].sort((a, b) => a - b)[0]);
  return '400';
}

async function build() {
  /** @type {any[]} */
  const entries = [];
  /** @type {string[]} */
  const missing = [];

  // Google families (sequential-ish with a small concurrency pool).
  const pool = 8;
  for (let i = 0; i < GOOGLE_SEED.length; i += pool) {
    const chunk = GOOGLE_SEED.slice(i, i + pool);
    const results = await Promise.all(
      chunk.map(async (seed) => {
        const md = await fetchMetadata(seed.family);
        if (!md) {
          missing.push(seed.family);
          return null;
        }
        const parsed = parseMetadata(md.text);
        const group =
          seed.group ??
          (parsed.subsets.includes('korean')
            ? 'Korean'
            : (CATEGORY_TO_GROUP[parsed.category] ?? 'Sans-serif'));
        const entry = {
          label: seed.label ?? seed.family,
          family: seed.family,
          group,
          webFont: true,
          weights: weightsSpec(parsed),
          license: LICENSE_OF[md.dir],
          scripts: parsed.subsets,
        };
        if (EAGER.has(seed.family)) entry.eager = true;
        return entry;
      }),
    );
    for (const r of results) if (r) entries.push(r);
  }

  // A curated seed is hand-picked (some are eager bootstrap fonts), so a
  // miss silently shrinks the menu. Fail loudly instead of emitting a
  // catalog that's quietly missing entries.
  if (missing.length > 0) {
    throw new Error(`curated families not found on google/fonts: ${missing.join(", ")}`);
  }

  for (const seed of SYSTEM_SEED) {
    entries.push({
      label: seed.label ?? seed.family,
      family: seed.family,
      group: seed.group,
      webFont: false,
    });
  }

  await writeFile(OUT, emit(entries), 'utf8');
  console.log(
    `wrote ${entries.length} families (${entries.filter((e) => e.webFont).length} web, ` +
      `${entries.filter((e) => e.eager).length} eager) → ${OUT}`,
  );
}

function emit(entries) {
  const lines = entries.map((e) => {
    const parts = [
      `label: ${JSON.stringify(e.label)}`,
      `family: ${JSON.stringify(e.family)}`,
      `group: ${JSON.stringify(e.group)}`,
      `webFont: ${e.webFont}`,
    ];
    if (e.weights) parts.push(`weights: ${JSON.stringify(e.weights)}`);
    if (e.license) parts.push(`license: ${JSON.stringify(e.license)}`);
    if (e.scripts) parts.push(`scripts: ${JSON.stringify(e.scripts)}`);
    if (e.eager) parts.push(`eager: true`);
    return `  { ${parts.join(', ')} },`;
  });
  return (
    `// GENERATED by scripts/build-font-catalog.mjs — do not edit by hand.\n` +
    `// Re-run the generator to refresh, then commit the output.\n` +
    `import type { FontEntry } from "./font-catalog";\n\n` +
    `export const FONT_CATALOG_DATA: readonly FontEntry[] = [\n` +
    `${lines.join('\n')}\n];\n`
  );
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
