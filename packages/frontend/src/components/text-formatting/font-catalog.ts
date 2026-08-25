/**
 * Single source of truth for the shared font-family picker and size
 * presets (Docs + Slides).
 *
 * The catalog itself lives in `font-catalog.data.ts`, generated from the
 * authoritative `google/fonts` repo metadata by
 * `scripts/build-font-catalog.mjs` (re-run on demand, output committed).
 * The picker contract stays open (`value: string`, not a closed union)
 * so the future "More fonts…" dialog can write any Google Fonts family.
 *
 * Loading model: only `eager` web fonts are requested in the bootstrap
 * CSS link; the long tail lazy-loads via `ensureFontLink` the first time
 * a family is picked or hovered. Merely *previewing* a row goes through
 * `ensurePreviewFontLink`, which requests only that row's glyphs.
 */
import { useEffect } from 'react';
import { FONT_CATALOG_DATA } from './font-catalog.data';

export type FontGroup =
  | 'Korean'
  | 'Sans-serif'
  | 'Serif'
  | 'Monospace'
  | 'Display'
  | 'Handwriting';

export type FontLicense = 'OFL' | 'APACHE2' | 'UFL';

export interface FontEntry {
  /** Display label shown in the picker. */
  label: string;
  /** Canonical family name written to InlineStyle.fontFamily. */
  family: string;
  /** Section header in the picker. */
  group: FontGroup;
  /**
   * Whether the family is served from Google Fonts (needs a CSS link +
   * `FontRegistry.ensureFont()` before paint) vs a local/system face.
   */
  webFont: boolean;
  /**
   * Google Fonts `wght@…` axis values to request. Defaults to `'400;700'`.
   * Single-cut faces (e.g. `Lobster`, `Pacifico`, `Black Han Sans`) must
   * narrow this — Google Fonts returns an error CSS payload when an
   * unavailable weight is requested, and a single bad family poisons the
   * whole `<link>`. The generator derives it from real font metadata.
   */
  weights?: string;
  /**
   * Open-source license the family ships under (sourced from the
   * `google/fonts` repo — the webfonts REST API does not expose it). All
   * three permit web serving and document embedding; carried for the
   * export-embed notices and per-font display, not for filtering.
   */
  license?: FontLicense;
  /** Google Fonts "subsets" (scripts) the family covers, minus `menu`. */
  scripts?: string[];
  /**
   * Loaded eagerly in the bootstrap CSS link (`true`) vs on demand via
   * `ensureFontLink` (absent/`false`). Only the small set the editors
   * shipped before the catalog expansion is eager, so the bootstrap
   * request stays small while the catalog grows.
   */
  eager?: boolean;
}

export const FONT_CATALOG: readonly FontEntry[] = FONT_CATALOG_DATA;

export const FONT_SIZE_PRESETS = [8, 10, 12, 14, 16, 18, 20, 24, 32, 48, 64, 96] as const;
export type FontSizePreset = (typeof FONT_SIZE_PRESETS)[number];

export const FONT_SIZE_MIN = 1;
export const FONT_SIZE_MAX = 400;

/**
 * Clamp a font size to the legal [FONT_SIZE_MIN, FONT_SIZE_MAX] range,
 * rounding to the nearest integer. Shared by `FontSizePicker`'s own
 * commit path and by callers driving `editor.stepSelectionFontSize`
 * (issue #343) so both apply the same bounds.
 */
export const clampFontSize = (fontSize: number): number =>
  Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(fontSize)));

export const LINE_SPACING_PRESETS = [1.0, 1.15, 1.5, 2.0] as const;
export const LINE_SPACING_MIN = 0.5;
export const LINE_SPACING_MAX = 10.0;

/** Case-sensitive index of catalog entries by canonical family name.
 *  Used by `ensureFontLink` to decide whether a family needs a network
 *  load (web vs system) and whether the bootstrap link already covers it. */
const CATALOG_INDEX: ReadonlyMap<string, FontEntry> = new Map(
  FONT_CATALOG.map((entry) => [entry.family, entry]),
);

const DEFAULT_WEIGHTS = '400;700';

/** A single `family=Name:wght@…` query segment for the css2 endpoint. */
function familyParam(family: string, weights?: string): string {
  return `family=${encodeURIComponent(family)}:wght@${weights ?? DEFAULT_WEIGHTS}`;
}

/** Assemble a css2 URL from one or more `family=…` segments. */
function css2Url(params: readonly string[]): string {
  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`;
}

/** Build the `<link href="…">` URL for the bootstrap Google Fonts CSS
 *  request — only the `eager` web fonts (the small set existing
 *  documents render with). Returns an empty string when none are eager
 *  (callers skip injecting the link). The long tail loads on demand via
 *  `ensureFontLink`. */
export function buildGoogleFontsHref(): string {
  const webEntries = FONT_CATALOG.filter((f) => f.webFont && f.eager);
  if (webEntries.length === 0) return '';
  return css2Url(webEntries.map((entry) => familyParam(entry.family, entry.weights)));
}

/** Find an already-injected per-family link, matching by the
 *  `data-wafflebase-font` attribute rather than an id so the lookup is
 *  robust for any family-name charset (Korean families included) and
 *  survives HMR module reloads (the DOM, not module state, is the
 *  source of truth). */
function findFontLink(family: string): HTMLLinkElement | null {
  const links = document.head.querySelectorAll<HTMLLinkElement>(
    'link[data-wafflebase-font]',
  );
  for (const link of links) {
    if (link.dataset.wafflebaseFont === family) return link;
  }
  return null;
}

/** The promise that settles when a full link's stylesheet has parsed (or
 *  failed), hung off the link ELEMENT rather than off the family name: the
 *  DOM stays the single source of truth for what has been requested, so a
 *  removed link is genuinely re-requestable and module state can never
 *  claim a link exists when the head says otherwise. */
const fullLinkSettled = new WeakMap<HTMLLinkElement, Promise<void>>();

/**
 * On-demand counterpart to `ensureGoogleFontsLink`: inject a per-family
 * Google Fonts CSS `<link>` the first time a non-bootstrap family is
 * needed (picker hover, or selection). After the CSS link resolves,
 * `FontRegistry.ensureFont` (`@wafflebase/docs`) can `document.fonts.load()`
 * the face and trigger a Canvas re-layout. Row previews go through
 * `ensurePreviewFontLink` instead, which fetches only the glyphs the row
 * paints.
 *
 * Returns a promise that settles once the stylesheet has parsed — the point
 * at which the family's real faces are in `document.fonts` and the Font
 * Loading API can be asked about them truthfully. It NEVER rejects: a font
 * that fails to load is a fallback face, not an error a caller should have
 * to handle. Callers that only want the fetch started can ignore it.
 *
 * AWAIT IT BEFORE `document.fonts.load()`/`check()`. Injecting the element
 * is synchronous but its `@font-face` rules are not: ask the Font Loading
 * API in that window and it answers about whatever faces ARE connected —
 * nothing (so it resolves instantly and the caller paints a fallback), or,
 * since previews became subsets, this family's `&text=` face, whose handful
 * of glyphs would then be what a PDF export rasterises.
 *
 * No-ops when:
 *   - running under SSR (no `document`);
 *   - the family is a known SYSTEM font (`webFont: false`) — there is no
 *     web face to fetch;
 *   - the family is an `eager` web font already in the bootstrap link —
 *     a second request would be redundant;
 *   - a link for this family is already present (idempotent / HMR-safe).
 *
 * Unknown families (e.g. an arbitrary Google Font chosen from the full
 * library) load with their provided `weights`, or `400;700` by default.
 */
export function ensureFontLink(family: string, weights?: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const entry = CATALOG_INDEX.get(family);
  if (entry && !entry.webFont) return Promise.resolve(); // system font: nothing to fetch
  if (entry && entry.eager) return Promise.resolve(); // already in bootstrap link
  const existing = findFontLink(family);
  // Already requested. Its promise is normally there to await; a link with none
  // beside it survived an HMR module reload, and the request it made cannot be
  // waited on any more — report it settled rather than issuing a second one.
  if (existing) return fullLinkSettled.get(existing) ?? Promise.resolve();

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.wafflebaseFont = family;
  link.href = css2Url([familyParam(family, weights ?? entry?.weights)]);
  const settled = new Promise<void>((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
  }).then(() => {
    // The full face is connected now and declared later, so it wins the
    // cascade for painting — but the subset face is still in `document.fonts`,
    // where `check()`/`load()` would keep counting it. Dropping it leaves one
    // authoritative face for the family. Done on settle rather than on inject
    // so the previewed row never flashes back to a fallback.
    removePreviewFontLink(family);
  });
  fullLinkSettled.set(link, settled);
  document.head.appendChild(link);
  return settled;
}

/** Find an already-injected per-family *preview* link. Deliberately a
 *  separate marker attribute from `data-wafflebase-font`: an attribute
 *  selector matches the whole attribute name, so a subsetted link is
 *  invisible to `findFontLink` and cannot be mistaken for a full load. */
function findPreviewFontLink(family: string): HTMLLinkElement | null {
  const links = document.head.querySelectorAll<HTMLLinkElement>(
    'link[data-wafflebase-font-preview]',
  );
  for (const link of links) {
    if (link.dataset.wafflebaseFontPreview === family) return link;
  }
  return null;
}

/** Drop a family's subset link once its full stylesheet has parsed. The
 *  subset face has no `unicode-range`, so while it is connected it is a
 *  face `document.fonts.check()`/`load()` will match for this family —
 *  which is how a whole slide deck could export rasterised with only the
 *  glyphs a picker row happened to paint. */
function removePreviewFontLink(family: string): void {
  findPreviewFontLink(family)?.remove();
}

/** The single weight a preview requests: the first cut of the family's
 *  `weights` spec. Never a hardcoded 400 — `Sunflower` ships only 700 and
 *  `css2?family=Sunflower:wght@400` answers HTTP 400 with an HTML error
 *  page, which would strand that row in a fallback face forever. */
function previewWeight(weights: string | undefined): string {
  const first = (weights ?? DEFAULT_WEIGHTS).split(';')[0].trim();
  return first || DEFAULT_WEIGHTS;
}

/** Unique characters of `text`, in first-appearance order, so the `&text=`
 *  query carries each glyph once. */
function uniqueChars(text: string): string {
  return [...new Set([...text])].join('');
}

/**
 * Is this family already requested IN FULL by *some* stylesheet link in the
 * document — ours or not?
 *
 * `findFontLink` only sees links this module injected, and the catalog's
 * `eager` flag only describes `buildGoogleFontsHref`'s bootstrap link. Neither
 * knows about the app shell's own `<link>` in `packages/frontend/index.html`,
 * which loads `Inter`, `Fraunces` and `JetBrains Mono` in full — all three are
 * curated-catalog entries with `eager` absent. A subset link for one of them is
 * not merely redundant: `&text=` returns a face with no `unicode-range`, so
 * being declared later it wins the cascade for every codepoint and *removes*
 * glyphs (and the bold cut) from a family that already had them.
 *
 * Matched on the href rather than on a marker attribute, because the shell's
 * link carries none. Every `family=` segment is compared whole — a css2 URL
 * carries many, and `Inter` must not match `Inter+Tight` — against both
 * spellings of the space: the shell writes `JetBrains+Mono`,
 * `encodeURIComponent` produces `JetBrains%20Mono`.
 */
function hasFullFamilyLink(family: string): boolean {
  const encoded = encodeURIComponent(family);
  const names = new Set([encoded, encoded.replace(/%20/g, '+')]);
  const links = document.head.querySelectorAll<HTMLLinkElement>(
    'link[rel="stylesheet"]',
  );
  for (const link of links) {
    // Our own subset links are stylesheet links to the same host; they are the
    // thing this function exists to distinguish from a full load.
    if (link.dataset.wafflebaseFontPreview !== undefined) continue;
    const href = link.href;
    if (!href.includes('fonts.googleapis.com')) continue;
    if (/[?&]text=/.test(href)) continue; // somebody else's subset request
    for (const segment of href.matchAll(/[?&]family=([^&]*)/g)) {
      // Everything after `:` is the axis spec, not part of the name.
      if (names.has(segment[1].split(':')[0])) return true;
    }
  }
  return false;
}

/**
 * Preview counterpart to `ensureFontLink`: request only the glyphs a row
 * actually paints, via the css2 `&text=` parameter, instead of the whole
 * family. Painting one label in the "More fonts…" list costs a few
 * hundred bytes rather than the family's full character set.
 *
 * The link is marked with `data-wafflebase-font-preview`, NOT
 * `data-wafflebase-font`, so `findFontLink` — and therefore
 * `ensureFontLink` — cannot mistake a subset for a full load. Selecting a
 * family that was only ever previewed still injects the complete family.
 *
 * Shares `ensureFontLink`'s no-op conditions (SSR, system fonts, eager
 * bootstrap families, idempotency) and adds one: if a full link for the
 * family already exists there is nothing to save, and a subset link —
 * declared later, so winning the cascade — would *remove* glyphs from a
 * face that had them. "Already exists" means ANY full css2 link in the
 * head, not just one this module injected: see `hasFullFamilyLink`.
 *
 * `text` is what the row renders (its `textContent`), not a catalog
 * lookup: recents and the full library both contain families absent from
 * `CATALOG_INDEX`, and a row's text is more than its label whenever the
 * `font-family` is set on a container.
 */
export function ensurePreviewFontLink(
  family: string,
  text: string,
  weights?: string,
): void {
  if (typeof document === 'undefined') return;
  const entry = CATALOG_INDEX.get(family);
  if (entry && !entry.webFont) return; // system font: nothing to fetch
  if (entry && entry.eager) return; // already in bootstrap link
  if (findPreviewFontLink(family)) return;
  // Covers `findFontLink`'s per-family links, the bootstrap link, AND the app
  // shell's own `index.html` stylesheet — the last of which no attribute or
  // catalog flag can see.
  if (hasFullFamilyLink(family)) return; // fully loaded already: nothing to save

  const subset = uniqueChars(text);
  if (!subset) return; // nothing painted: nothing to request

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.wafflebaseFontPreview = family;
  link.href = css2Url([
    familyParam(family, previewWeight(weights ?? entry?.weights)),
    `text=${encodeURIComponent(subset)}`,
  ]);
  document.head.appendChild(link);
}

/**
 * Idempotently inject the Google Fonts CSS `<link>` into `document.head`.
 * Call from surfaces that need the web fonts (e.g. the Docs editor mount)
 * rather than from the app root — every non-docs route would otherwise
 * pay the third-party request and CSP cost for fonts it never paints.
 *
 * SSR-safe (no-op when `document` is undefined) and HMR-safe (guarded by
 * an id). Subsequent calls return immediately.
 */
export function ensureGoogleFontsLink(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('wafflebase-google-fonts')) return;
  const href = buildGoogleFontsHref();
  if (!href) return;
  const link = document.createElement('link');
  link.id = 'wafflebase-google-fonts';
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

/**
 * React mount-effect that triggers `ensureGoogleFontsLink()` once on
 * mount. Called from the view shells (`SlidesView`, `DocsView`) — and
 * only from them — so read-only and shared-URL viewers, which never
 * mount a toolbar or font picker, still get the link injected. The
 * underlying function is idempotent (id-guarded), so React strict-mode's
 * double-fire is harmless and any nested mount on the same page
 * (toolbars, pickers re-mounted via HMR) only injects the link once.
 */
export function useGoogleFontsLink(): void {
  useEffect(() => {
    ensureGoogleFontsLink();
  }, []);
}
