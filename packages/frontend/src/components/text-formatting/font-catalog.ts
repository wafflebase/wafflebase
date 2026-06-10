/**
 * Single source of truth for the Docs font-family picker and size presets.
 *
 * v1 keeps the catalog small (14 families) so the picker stays readable
 * and the Google Fonts CSS payload stays under one network request.
 * Future "More fonts…" work extends `FONT_CATALOG` without breaking the
 * picker contract (`value: string`, not a closed union).
 */

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

/** Build the `<link href="…">` URL for the Google Fonts CSS request.
 *  Returns an empty string when no entries have `webFont: true` — callers
 *  should skip injecting the link in that case. */
export function buildGoogleFontsHref(): string {
  const webEntries = FONT_CATALOG.filter((f) => f.webFont);
  if (webEntries.length === 0) return '';
  const params = webEntries
    .map(
      (entry) =>
        `family=${encodeURIComponent(entry.family)}:wght@${entry.weights ?? '400;700'}`,
    )
    .join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
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
