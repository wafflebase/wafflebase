import { palette } from '@wafflebase/tokens';
import { resolveFontFamily } from './fonts.js';

/**
 * Theme mode type.
 */
export type ThemeMode = 'light' | 'dark';

/**
 * All themeable visual constants for the document editor.
 */
export interface DocTheme {
  /** Default font */
  defaultFontSize: number;
  defaultFontFamily: string;
  defaultColor: string;

  /** Cursor */
  cursorColor: string;
  cursorWidth: number;
  cursorBlinkInterval: number;

  /** Selection */
  selectionColor: string;
  selectionColorInactive: string;

  /** Page */
  pageGap: number;
  pageShadowColor: string;
  pageShadowBlur: number;
  pageShadowOffsetX: number;
  pageShadowOffsetY: number;
  pageBackground: string;
  canvasBackground: string;

  /** Ruler */
  rulerMarginBackground: string;
  rulerContentBackground: string;
  rulerTickColor: string;

  /** Header/Footer */
  headerFooterBorderColor: string;
  headerFooterDimAlpha: number;
}

const LightTheme: DocTheme = {
  defaultFontSize: 11,
  defaultFontFamily: 'Arial',
  defaultColor: palette.neutrals.light.ink,

  cursorColor: palette.neutrals.light.ink,
  cursorWidth: 2,
  cursorBlinkInterval: 530,

  selectionColor: `rgba(${palette.butterRgb}, 0.30)`,
  selectionColorInactive: 'rgba(0, 0, 0, 0.1)',

  pageGap: 40,
  pageShadowColor: 'rgba(0, 0, 0, 0.15)',
  pageShadowBlur: 8,
  pageShadowOffsetX: 0,
  pageShadowOffsetY: 4,
  // Paper surface stays pure white in light mode — office tools feel
  // professional when the page itself isn't tinted. Brand still appears
  // on selection wash, caret, and text via palette refs above.
  pageBackground: '#ffffff',
  canvasBackground: '#f0f0f0',

  rulerMarginBackground: '#e8e8e8',
  rulerContentBackground: '#ffffff',
  rulerTickColor: '#666666',

  headerFooterBorderColor: '#cccccc',
  headerFooterDimAlpha: 0.4,
};

const DarkTheme: DocTheme = {
  defaultFontSize: 11,
  defaultFontFamily: 'Arial',
  defaultColor: palette.neutrals.dark.ink,

  cursorColor: palette.neutrals.dark.ink,
  cursorWidth: 2,
  cursorBlinkInterval: 530,

  selectionColor: `rgba(${palette.butterRgb}, 0.35)`,
  selectionColorInactive: 'rgba(255, 255, 255, 0.1)',

  pageGap: 40,
  pageShadowColor: 'rgba(0, 0, 0, 0.4)',
  pageShadowBlur: 10,
  pageShadowOffsetX: 0,
  pageShadowOffsetY: 4,
  // Dark mode paper uses a neutral dark instead of the warm brand
  // neutrals — keeps the editor chrome quiet across both modes.
  pageBackground: '#2b2b2b',
  canvasBackground: '#1e1e1e',

  rulerMarginBackground: '#333333',
  rulerContentBackground: '#2b2b2b',
  rulerTickColor: '#999999',

  headerFooterBorderColor: '#555555',
  headerFooterDimAlpha: 0.4,
};

/**
 * Current active theme. Mutable so that setThemeMode() can switch it
 * without requiring every consumer to hold a reference.
 */
let activeTheme: DocTheme = LightTheme;

/**
 * Get the current active theme.
 */
export function getTheme(): DocTheme {
  return activeTheme;
}

/**
 * Switch the active theme mode.
 */
export function setThemeMode(mode: ThemeMode): void {
  activeTheme = mode === 'dark' ? DarkTheme : LightTheme;
}

/**
 * Convenience alias — reads from the active theme.
 * Kept as `Theme` for backward compatibility with existing call sites.
 */
export const Theme: DocTheme = new Proxy({} as DocTheme, {
  get(_target, prop: string) {
    return (activeTheme as unknown as Record<string, unknown>)[prop];
  },
});

/**
 * Convert a font size in points to pixels (1pt = 96/72 px).
 */
export function ptToPx(pt: number): number {
  return pt * (96 / 72);
}

/**
 * Build a CSS font string from inline style properties.
 * Font sizes are stored in pt; the CSS string uses px for Canvas compatibility.
 *
 * The family is routed through `resolveFontFamily` so Canvas paint
 * picks up the same Korean-fallback chain the DOM/CSS path uses. This
 * is what lets Hangul render correctly when the resolved face is a
 * Latin-only family like Arial or a brand font we don't have installed.
 */
export function buildFont(
  fontSize?: number,
  fontFamily?: string,
  bold?: boolean,
  italic?: boolean,
): string {
  const style = italic ? 'italic ' : '';
  const weight = bold ? 'bold ' : '';
  const size = ptToPx(fontSize ?? activeTheme.defaultFontSize);
  const family = resolveFontFamily(fontFamily ?? activeTheme.defaultFontFamily);
  return `${style}${weight}${size}px ${family}`;
}
