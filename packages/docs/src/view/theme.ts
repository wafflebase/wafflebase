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
}

const LightTheme: DocTheme = {
  defaultFontSize: 11,
  defaultFontFamily: 'Arial',
  defaultColor: '#000000',

  cursorColor: '#000000',
  cursorWidth: 2,
  cursorBlinkInterval: 530,

  selectionColor: 'rgba(66, 133, 244, 0.3)',
  selectionColorInactive: 'rgba(0, 0, 0, 0.1)',

  pageGap: 40,
  pageShadowColor: 'rgba(0, 0, 0, 0.15)',
  pageShadowBlur: 8,
  pageShadowOffsetX: 0,
  pageShadowOffsetY: 4,
  pageBackground: '#ffffff',
  canvasBackground: '#f0f0f0',

  rulerMarginBackground: '#e8e8e8',
  rulerContentBackground: '#ffffff',
  rulerTickColor: '#666666',
};

const DarkTheme: DocTheme = {
  defaultFontSize: 11,
  defaultFontFamily: 'Arial',
  defaultColor: '#e0e0e0',

  cursorColor: '#e0e0e0',
  cursorWidth: 2,
  cursorBlinkInterval: 530,

  selectionColor: 'rgba(100, 160, 255, 0.35)',
  selectionColorInactive: 'rgba(255, 255, 255, 0.1)',

  pageGap: 40,
  pageShadowColor: 'rgba(0, 0, 0, 0.4)',
  pageShadowBlur: 10,
  pageShadowOffsetX: 0,
  pageShadowOffsetY: 4,
  pageBackground: '#2b2b2b',
  canvasBackground: '#1e1e1e',

  rulerMarginBackground: '#333333',
  rulerContentBackground: '#2b2b2b',
  rulerTickColor: '#999999',
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
  const family = fontFamily ?? activeTheme.defaultFontFamily;
  return `${style}${weight}${size}px ${family}`;
}
