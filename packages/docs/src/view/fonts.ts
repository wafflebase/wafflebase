/**
 * Font registry — maps font family names to web-safe fallback chains
 * and handles on-demand font loading via the CSS Font Loading API.
 */

const FONT_MAP: Record<string, string> = {
  '맑은 고딕': "'Malgun Gothic', 'Noto Sans KR', sans-serif",
  'Malgun Gothic': "'Malgun Gothic', 'Noto Sans KR', sans-serif",
  '바탕': "'Batang', 'Noto Serif KR', serif",
  'Batang': "'Batang', 'Noto Serif KR', serif",
  'HY헤드라인M': "'Noto Sans KR', sans-serif",
  'Arial': "'Arial', sans-serif",
  'Tahoma': "'Tahoma', sans-serif",
};

const SERIF_FONTS = new Set(['바탕', 'Batang', 'Noto Serif KR', 'Times New Roman', 'Georgia']);

/**
 * Resolve a font family name to a CSS fallback chain string.
 */
export function resolveFontFamily(family: string): string {
  const mapped = FONT_MAP[family];
  if (mapped) return mapped;

  const generic = SERIF_FONTS.has(family) ? 'serif' : 'sans-serif';
  return `'${family}', ${generic}`;
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

    if (document.fonts.check(`12px "${family}"`)) {
      this.status.set(key, 'loaded');
      return;
    }

    this.status.set(key, 'loading');
    try {
      await document.fonts.load(`12px "${family}"`);
      this.status.set(key, 'loaded');
      this.listeners.forEach((cb) => cb());
    } catch {
      this.status.set(key, 'error');
    }
  }

  getFontStatus(family: string): FontStatus {
    return this.status.get(family) ?? 'pending';
  }
}
