// @ts-nocheck
/**
 * Generates `src/components/text-formatting/font-files.data.ts` — the
 * per-family TTF download URLs used by the PDF export embed path
 * (`@wafflebase/docs` `pdf-fonts.ts`).
 *
 * Run on demand (NOT part of the build), then commit the output:
 *
 *   node packages/frontend/scripts/build-font-files.mjs
 *
 * Why a generator (same reasoning as the catalog generators): the TTF
 * filename on `google/fonts` is non-deterministic — static faces ship
 * one file per weight (`Roboto-Bold.ttf`) while variable faces ship a
 * single axis file (`Roboto[wght].ttf`) that pdf-lib/fontkit cannot
 * instance to a specific weight at embed time. So we resolve the exact
 * *static* per-weight TTF URL from fontsource's `google-font-metadata`
 * (`variants[weight].normal.<subset>.url.truetype`, hosted on gstatic
 * and version-pinned in the URL path, e.g. `.../roboto/v50/...ttf`).
 *
 * Scope (P3-a): only the curated catalog's Latin web fonts. Korean-group
 * families are excluded — their CJK glyphs are served by the dedicated
 * Noto KR embed path in `pdf-fonts.ts`, and `splitMixedScript` keeps each
 * script's segment on the right font. We embed `regular` (400) and a
 * `bold` cut (nearest available weight to 700); italic is synthesized via
 * the painter's oblique shim, so no italic file is fetched.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GOOGLE_SEED } from "./build-font-catalog.mjs";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/components/text-formatting/font-files.data.ts",
);

const METADATA_URL =
  "https://unpkg.com/google-font-metadata/data/google-fonts-v2.json";
const GH_TREES = "https://api.github.com/repos/google/fonts/git/trees";
const LICENSE_OF = { ofl: "OFL", apache: "APACHE2", ufl: "UFL" };

/** fontsource id: lowercase, non-alphanumerics → single hyphen. */
function fontsourceId(family) {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** google/fonts dir slug: lowercase, strip everything but [a-z0-9]. */
function ghSlug(family) {
  return family.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

/** Map google/fonts dir slug → license, via the git-trees API. */
async function fetchLicenseMap() {
  const map = new Map();
  const root = await fetchJson(`${GH_TREES}/main`);
  for (const node of root.tree ?? []) {
    const license = LICENSE_OF[node.path];
    if (!license || node.type !== "tree") continue;
    const sub = await fetchJson(`${GH_TREES}/${node.sha}`);
    for (const fam of sub.tree ?? []) {
      if (fam.type === "tree") map.set(fam.path, license);
    }
  }
  if (map.size === 0) {
    throw new Error("license map is empty — google/fonts trees unavailable");
  }
  return map;
}

/** Pick the static Latin TTF URL for a given weight, preferring the
 *  `latin` subset and falling back to the family's default subset. */
function ttfUrl(meta, weight) {
  const variant = meta.variants?.[String(weight)]?.normal;
  if (!variant) return null;
  const subset = variant.latin ?? variant[meta.defSubset] ?? Object.values(variant)[0];
  return subset?.url?.truetype ?? null;
}

/** Nearest available weight to 700 for the bold cut: prefer 700, then the
 *  closest weight heavier than 400, else none (bold reuses the regular
 *  face). */
function boldWeight(weights) {
  const set = new Set(weights);
  if (set.has(700)) return 700;
  const heavier = weights.filter((w) => w > 400).sort((a, b) => Math.abs(a - 700) - Math.abs(b - 700));
  return heavier[0] ?? null;
}

async function build() {
  const data = await fetchJson(METADATA_URL);
  const licenseMap = await fetchLicenseMap();

  /** @type {Record<string, { license: string, regular: string, bold?: string }>} */
  const out = {};
  const skipped = [];

  for (const seed of GOOGLE_SEED) {
    const meta = data[fontsourceId(seed.family)];
    if (!meta) {
      skipped.push(`${seed.family} (no fontsource metadata)`);
      continue;
    }
    const subsets = (meta.subsets ?? []).filter((s) => s !== "menu");
    // Korean-group families render through the Noto KR embed path.
    if (subsets.includes("korean")) continue;
    // Must carry Latin glyphs — that's all this path embeds.
    if (!subsets.includes("latin")) {
      skipped.push(`${seed.family} (no latin subset)`);
      continue;
    }
    const regular = ttfUrl(meta, 400) ?? ttfUrl(meta, (meta.weights ?? [])[0]);
    if (!regular) {
      skipped.push(`${seed.family} (no static regular ttf)`);
      continue;
    }
    const license = licenseMap.get(ghSlug(seed.family)) ?? "OFL";
    const entry = { license, regular };
    const bw = boldWeight(meta.weights ?? []);
    const bold = bw ? ttfUrl(meta, bw) : null;
    if (bold && bold !== regular) entry.bold = bold;
    out[seed.family] = entry;
  }

  await writeFile(OUT, emit(out), "utf8");
  console.log(
    `wrote ${Object.keys(out).length} families → ${OUT}` +
      (skipped.length ? `\nskipped ${skipped.length}: ${skipped.join(", ")}` : ""),
  );
}

function emit(out) {
  const families = Object.keys(out).sort((a, b) => a.localeCompare(b));
  const lines = families.map((family) => {
    const e = out[family];
    const parts = [
      `license: ${JSON.stringify(e.license)}`,
      `regular: ${JSON.stringify(e.regular)}`,
    ];
    if (e.bold) parts.push(`bold: ${JSON.stringify(e.bold)}`);
    return `  ${JSON.stringify(family)}: { ${parts.join(", ")} },`;
  });
  return (
    `// GENERATED by scripts/build-font-files.mjs — do not edit by hand.\n` +
    `// Per-family static TTF URLs (version-pinned gstatic) for the PDF\n` +
    `// export embed path. Re-run the generator to refresh, then commit.\n\n` +
    `export type FontFileLicense = "OFL" | "APACHE2" | "UFL";\n\n` +
    `export interface FontFiles {\n` +
    `  license: FontFileLicense;\n` +
    `  /** Static TTF URL for the regular (400) cut. */\n` +
    `  regular: string;\n` +
    `  /** Static TTF URL for the bold cut (nearest weight to 700). */\n` +
    `  bold?: string;\n` +
    `}\n\n` +
    `export const FONT_FILES: Readonly<Record<string, FontFiles>> = {\n` +
    `${lines.join("\n")}\n};\n`
  );
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
