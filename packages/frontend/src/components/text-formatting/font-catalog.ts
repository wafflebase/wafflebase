/**
 * Single source of truth for the Docs font-family picker and size presets.
 *
 * v1 keeps the catalog small (14 families) so the picker stays readable
 * and the Google Fonts CSS payload stays under one network request.
 * Future "More fonts…" work extends `FONT_CATALOG` without breaking the
 * picker contract (`value: string`, not a closed union).
 */
import { useEffect } from 'react';

export type FontGroup = 'Korean' | 'Sans-serif' | 'Serif' | 'Monospace';

export interface FontEntry {
  /** Display label shown in the picker. */
  label: string;
  /** Canonical family name written to InlineStyle.fontFamily. */
  family: string;
  /** Section header in the picker. */
  group: FontGroup;
  /**
   * Whether the family needs the Google Fonts CSS link at bootstrap and
   * `FontRegistry.ensureFont()` before paint. Local/system fonts skip both.
   */
  webFont: boolean;
  /**
   * Google Fonts `wght@…` axis values to request. Defaults to `'400;700'`
   * for two-weight families. Display fonts that only ship a single
   * weight (e.g. `Jua`, `Black Han Sans`) must override this — Google
   * Fonts returns an error CSS payload when an unavailable weight is
   * requested, and a single bad family poisons the whole `<link>`.
   */
  weights?: string;
  /**
   * Whether this family is loaded eagerly in the bootstrap CSS link
   * (`true`/absent) or only on demand via `ensureFontLink` (`false`).
   * Absent means curated — every family in today's catalog is curated,
   * so the bootstrap link is unchanged. As the catalog grows past a
   * single network request, the long tail is marked `curated: false`
   * and lazy-loaded the first time a user picks or previews it.
   */
  curated?: boolean;
}

export const FONT_CATALOG: readonly FontEntry[] = [
  // Korean — body text faces (display faces deferred to a later catalog
  // pass; today's priority is broader coverage for imported PPTX/DOCX
  // decks, which lean on text bodies, not headlines).
  { label: '맑은 고딕', family: '맑은 고딕', group: 'Korean', webFont: false },
  { label: '바탕', family: '바탕', group: 'Korean', webFont: false },
  { label: 'Noto Sans KR', family: 'Noto Sans KR', group: 'Korean', webFont: true },
  { label: 'Noto Serif KR', family: 'Noto Serif KR', group: 'Korean', webFont: true },
  { label: '나눔고딕', family: 'Nanum Gothic', group: 'Korean', webFont: true },
  { label: '나눔명조', family: 'Nanum Myeongjo', group: 'Korean', webFont: true },
  { label: 'Gothic A1', family: 'Gothic A1', group: 'Korean', webFont: true },
  { label: 'Gowun Dodum', family: 'Gowun Dodum', group: 'Korean', webFont: true, weights: '400' },
  { label: 'Gowun Batang', family: 'Gowun Batang', group: 'Korean', webFont: true },
  // Sans-serif
  { label: 'Arial', family: 'Arial', group: 'Sans-serif', webFont: false },
  { label: 'Helvetica', family: 'Helvetica', group: 'Sans-serif', webFont: false },
  { label: 'Roboto', family: 'Roboto', group: 'Sans-serif', webFont: true },
  { label: 'Tahoma', family: 'Tahoma', group: 'Sans-serif', webFont: false },
  { label: 'Verdana', family: 'Verdana', group: 'Sans-serif', webFont: false },
  // Serif
  { label: 'Times New Roman', family: 'Times New Roman', group: 'Serif', webFont: false },
  { label: 'Georgia', family: 'Georgia', group: 'Serif', webFont: false },
  { label: 'Cambria', family: 'Cambria', group: 'Serif', webFont: false },
  // Monospace
  { label: 'Courier New', family: 'Courier New', group: 'Monospace', webFont: false },
];

export const FONT_SIZE_PRESETS = [8, 10, 12, 14, 16, 18, 20, 24, 32, 48, 64, 96] as const;
export type FontSizePreset = (typeof FONT_SIZE_PRESETS)[number];

export const FONT_SIZE_MIN = 1;
export const FONT_SIZE_MAX = 400;

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
 *  request — the curated web fonts shown in the picker menu. Returns an
 *  empty string when no curated entries have `webFont: true` (callers
 *  skip injecting the link in that case). The long tail (`curated:
 *  false`) is excluded here and loaded on demand via `ensureFontLink`. */
export function buildGoogleFontsHref(): string {
  const webEntries = FONT_CATALOG.filter(
    (f) => f.webFont && f.curated !== false,
  );
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

/**
 * On-demand counterpart to `ensureGoogleFontsLink`: inject a per-family
 * Google Fonts CSS `<link>` the first time a non-bootstrap family is
 * needed (picker hover, selection, or in-view preview in the "More
 * fonts…" dialog). After the CSS link resolves, `FontRegistry.ensureFont`
 * (`@wafflebase/docs`) can `document.fonts.load()` the face and trigger
 * a Canvas re-layout.
 *
 * No-ops when:
 *   - running under SSR (no `document`);
 *   - the family is a known SYSTEM font (`webFont: false`) — there is no
 *     web face to fetch;
 *   - the family is a curated web font already in the bootstrap link —
 *     a second request would be redundant;
 *   - a link for this family is already present (idempotent / HMR-safe).
 *
 * Unknown families (e.g. an arbitrary Google Font chosen from the full
 * library) load with their provided `weights`, or `400;700` by default.
 */
export function ensureFontLink(family: string, weights?: string): void {
  if (typeof document === 'undefined') return;
  const entry = CATALOG_INDEX.get(family);
  if (entry && !entry.webFont) return; // system font: nothing to fetch
  if (entry && entry.curated !== false) return; // already in bootstrap link
  if (findFontLink(family)) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.wafflebaseFont = family;
  link.href = css2Url([familyParam(family, weights ?? entry?.weights)]);
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
