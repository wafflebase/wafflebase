/**
 * Visual constants for the document editor.
 */
export const Theme = {
  /** Default font */
  defaultFontSize: 16,
  defaultFontFamily: 'sans-serif',
  defaultColor: '#000000',

  /** Cursor */
  cursorColor: '#000000',
  cursorWidth: 2,
  cursorBlinkInterval: 530,

  /** Selection */
  selectionColor: 'rgba(66, 133, 244, 0.3)',

  /** Page */
  pageGap: 40,
  pageShadowColor: 'rgba(0, 0, 0, 0.15)',
  pageShadowBlur: 8,
  pageShadowOffsetX: 0,
  pageShadowOffsetY: 4,
  pageBackground: '#ffffff',
  canvasBackground: '#f0f0f0',
} as const;

/**
 * Build a CSS font string from inline style properties.
 */
export function buildFont(
  fontSize?: number,
  fontFamily?: string,
  bold?: boolean,
  italic?: boolean,
): string {
  const style = italic ? 'italic ' : '';
  const weight = bold ? 'bold ' : '';
  const size = fontSize ?? Theme.defaultFontSize;
  const family = fontFamily ?? Theme.defaultFontFamily;
  return `${style}${weight}${size}px ${family}`;
}
