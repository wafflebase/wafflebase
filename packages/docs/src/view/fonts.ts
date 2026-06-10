/**
 * Font registry — maps font family names to web-safe fallback chains
 * and handles on-demand font loading via the CSS Font Loading API.
 */

const FONT_MAP: Record<string, string> = {
  '맑은 고딕': "'Malgun Gothic', 'Noto Sans KR', sans-serif",
  'Malgun Gothic': "'Malgun Gothic', 'Noto Sans KR', sans-serif",
  '바탕': "'Batang', 'Noto Serif KR', serif",
  'Batang': "'Batang', 'Noto Serif KR', serif",
  'Noto Sans KR': "'Noto Sans KR', sans-serif",
  'Noto Serif KR': "'Noto Serif KR', serif",
  'Nanum Gothic': "'Nanum Gothic', sans-serif",
  'HY헤드라인M': "'Noto Sans KR', sans-serif",
  'Arial': "'Arial', sans-serif",
  'Helvetica': "'Helvetica', 'Arial', sans-serif",
  'Roboto': "'Roboto', sans-serif",
  'Tahoma': "'Tahoma', sans-serif",
  'Verdana': "'Verdana', sans-serif",
  'Times New Roman': "'Times New Roman', 'Times', serif",
  'Georgia': "'Georgia', serif",
  'Cambria': "'Cambria', 'Georgia', serif",
  'Courier New': "'Courier New', 'Courier', monospace",
};

const SERIF_FONTS = new Set([
  '바탕', 'Batang',
  'Noto Serif KR',
  'Times New Roman', 'Georgia', 'Cambria',
]);

const MONOSPACE_FONTS = new Set(['Courier New', 'Courier', 'Consolas']);

/**
 * Families that already carry Korean glyph coverage. When the resolved
 * stack already names one of these (either as the primary face or via
 * a FONT_MAP-injected secondary face like Malgun Gothic), we skip the
 * Korean-fallback splice in `resolveFontFamily` to avoid duplicating
 * the Noto KR entry.
 */
const KOREAN_CAPABLE_SANS = new Set([
  'Noto Sans KR',
  'Malgun Gothic', '맑은 고딕',
  'Nanum Gothic', '나눔고딕',
  'HY헤드라인M',
]);

const KOREAN_CAPABLE_SERIF = new Set([
  'Noto Serif KR',
  'Batang', '바탕',
]);

/**
 * Escape a font family name for use in a CSS single-quoted string.
 * The CSS spec requires backslashes and single quotes to be escaped.
 */
function escapeFontFamily(family: string): string {
  // Escape backslashes first, then single quotes.
  return family.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function stackContainsKoreanFamily(stack: string): boolean {
  for (const family of KOREAN_CAPABLE_SANS) {
    if (stack.includes(`'${family}'`)) return true;
  }
  for (const family of KOREAN_CAPABLE_SERIF) {
    if (stack.includes(`'${family}'`)) return true;
  }
  return false;
}

/**
 * Splice a Korean-capable family into `stack` right before the trailing
 * CSS generic so the browser's per-glyph font selection has a Korean
 * face available even when the original `family` only carries Latin
 * glyphs. No-op when `stack` already names a Korean-capable family.
 */
function injectKoreanFallback(stack: string, generic: 'sans-serif' | 'serif'): string {
  if (stackContainsKoreanFamily(stack)) return stack;
  const ko = generic === 'serif' ? "'Noto Serif KR'" : "'Noto Sans KR'";
  const suffix = `, ${generic}`;
  if (stack.endsWith(suffix)) {
    return stack.slice(0, -suffix.length) + `, ${ko}${suffix}`;
  }
  return `${stack}, ${ko}, ${generic}`;
}

/**
 * Resolve a font family name to a CSS fallback chain string.
 *
 * Every sans-serif or serif resolution ends with a Noto KR fallback so
 * Hangul text remains legible even when the requested family has no
 * Korean glyphs (e.g. Arial, or a brand font like "NanumSquare Neo OTF
 * Bold" that the user's machine does not have installed). The browser
 * picks the Korean face per-glyph via the standard CSS cascade.
 *
 * Monospace resolutions are NOT augmented — mixing Noto Sans KR's
 * variable-width glyphs into a Courier stack would break code alignment.
 */
export function resolveFontFamily(family: string): string {
  const mapped = FONT_MAP[family];
  const generic: 'sans-serif' | 'serif' | 'monospace' = MONOSPACE_FONTS.has(family)
    ? 'monospace'
    : SERIF_FONTS.has(family)
      ? 'serif'
      : 'sans-serif';
  const base = mapped ?? `'${escapeFontFamily(family)}', ${generic}`;
  if (generic === 'monospace') return base;
  return injectKoreanFallback(base, generic);
}

type FontStatus = 'pending' | 'loading' | 'loaded' | 'error';

/**
 * FontRegistry manages on-demand web font loading and notifies
 * listeners when fonts finish loading (to trigger re-layout).
 */
export class FontRegistry {
  private status = new Map<string, FontStatus>();
  private listeners: Array<() => void> = [];

  /**
   * Register a callback to be called when any font finishes loading.
   */
  onFontLoaded(cb: () => void): void {
    this.listeners.push(cb);
  }

  /**
   * Ensure a font is loaded. If not yet loaded, triggers async loading
   * and calls listeners when done.
   */
  async ensureFont(family: string): Promise<void> {
    if (typeof document === 'undefined') return; // SSR guard
    const key = family;
    const current = this.status.get(key);
    if (current === 'loaded' || current === 'loading') return;

    // Use JSON.stringify to produce a correctly quoted font name for the
    // Font Loading API, handling embedded quotes and special characters.
    const fontSpec = `12px ${JSON.stringify(family)}`;
    if (document.fonts.check(fontSpec)) {
      this.status.set(key, 'loaded');
      return;
    }

    this.status.set(key, 'loading');
    try {
      await document.fonts.load(fontSpec);
      this.status.set(key, 'loaded');
    } catch {
      this.status.set(key, 'error');
      return;
    }

    // Listeners are invoked after the status is settled so that a
    // listener throwing cannot flip the font into 'error' via the
    // surrounding catch block. Each callback is wrapped individually so
    // one failing subscriber does not block notifications for the rest.
    for (const cb of this.listeners) {
      try {
        cb();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('FontRegistry listener threw:', e);
      }
    }
  }

  getFontStatus(family: string): FontStatus {
    return this.status.get(family) ?? 'pending';
  }
}
