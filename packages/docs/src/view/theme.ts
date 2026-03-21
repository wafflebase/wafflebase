/**
 * Visual constants for the document editor.
 */
export const Theme = {
  /** Page padding from canvas edges */
  pagePaddingX: 72,
  pagePaddingTop: 48,

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

  /** Background */
  backgroundColor: '#ffffff',
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
