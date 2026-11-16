import { palette } from '@wafflebase/core/tokens';

export type Theme = 'light' | 'dark';

export const LightTheme = {
  cellBorderColor: '#D3D3D3',
  customBorderColor: '#000000',
  cellBGColor: '#FFFFFF',
  cellTextColor: '#000000',
  cellLinkColor: palette.link,
  // Butter & Maple — active cell ring uses syrup, selection fill uses
  // butter. Every header a selection spans (Google lights them all, not only
  // the active cell's) gets a butter wash laid over `headerBGColor` — a wash
  // rather than solid butter, so a wide selection does not paint a loud band
  // across the header strip.
  activeCellColor: palette.syrup,
  selectionBGColor: `rgba(${palette.butterRgb}, 0.18)`,
  headerBGColor: '#F0F0F0',
  headerActiveBGColor: `rgba(${palette.butterRgb}, 0.5)`,
  ['tokens.REFERENCE']: palette.syrup,
  ['tokens.NUM']: '#4DA6FF',
  // Peer cursor colors — yellow slots swapped to rose / lavender so they
  // stop competing with the syrup-amber design language.
  peerCursor1: '#FF6B6B',
  peerCursor2: '#4ECDC4',
  peerCursor3: '#45B7D1',
  peerCursor4: '#96CEB4',
  peerCursor5: '#FB7185',
  peerCursor6: '#DDA0DD',
  peerCursor7: '#98D8C8',
  peerCursor8: '#A78BFA',
  // Handles, drop guides and the whole-row/column header follow the one
  // accent (syrup) instead of Google blue, so the grid agrees with the
  // docs/slides selection chrome. The fully selected header is a syrup tint,
  // deeper than the solid butter of a partly selected one, so selecting a
  // whole column reads as the stronger state.
  resizeHandleColor: palette.syrup,
  headerSelectedBGColor: `rgba(${palette.syrupRgb}, 0.45)`,
  // A neutral hover for header-embedded buttons (filter), weaker than the
  // pressed state's selection wash.
  headerButtonHoverBGColor: 'rgba(0, 0, 0, 0.08)',
  dropIndicatorColor: palette.syrup,
  freezeLineColor: '#BBBBBB',
  freezeHandleColor: '#9E9E9E',
  freezeHandleHoverColor: '#5F6368',
  formulaRange1: '#1A73E8',
  formulaRange2: '#E84C3D',
  formulaRange3: '#9B59B6',
  formulaRange4: '#27AE60',
  formulaRange5: '#F39C12',
  formulaRange6: '#00ACC1',
  // The filter frame is chrome, not a reference color: the one accent.
  filterRangeBorderColor: palette.syrup,
  searchHighlightColor: 'rgba(255, 200, 0, 0.35)',
  searchCurrentColor: 'rgba(255, 150, 0, 0.55)',
};

export const DarkTheme = {
  cellBorderColor: '#4A4A4A',
  customBorderColor: '#FFFFFF',
  cellBGColor: '#1E1E1E',
  cellTextColor: '#FFFFFF',
  cellLinkColor: palette.linkBright,
  // Butter & Maple — dark variant. Syrup brightens to maple-amber. Solid
  // butter behind white header labels was the loudest thing on the dark grid,
  // and would be a glaring band once a selection spans many headers, so
  // spanned headers take a low butter wash; the syrup tint stays the
  // stronger whole-row/column state.
  activeCellColor: palette.syrupBright,
  selectionBGColor: `rgba(${palette.butterRgb}, 0.16)`,
  headerBGColor: '#2D2D2D',
  headerActiveBGColor: `rgba(${palette.butterRgb}, 0.22)`,
  ['tokens.REFERENCE']: palette.syrupBright,
  ['tokens.NUM']: '#4DA6FF',
  // Peer cursor colors — yellow slots swapped to rose / lavender.
  peerCursor1: '#FF7979',
  peerCursor2: '#55EFC4',
  peerCursor3: '#74B9FF',
  peerCursor4: '#A4D4C4',
  peerCursor5: '#FB7185',
  peerCursor6: '#E17055',
  peerCursor7: '#81ECEC',
  peerCursor8: '#A78BFA',
  resizeHandleColor: palette.syrupBright,
  headerSelectedBGColor: `rgba(${palette.syrupRgb}, 0.55)`,
  headerButtonHoverBGColor: 'rgba(255, 255, 255, 0.10)',
  dropIndicatorColor: palette.syrupBright,
  freezeLineColor: '#5A5A5A',
  freezeHandleColor: '#8E8E8E',
  freezeHandleHoverColor: '#CCCCCC',
  formulaRange1: '#8AB4F8',
  formulaRange2: '#FF7979',
  formulaRange3: '#BB86FC',
  formulaRange4: '#66BB6A',
  formulaRange5: '#FFB74D',
  formulaRange6: '#4DD0E1',
  filterRangeBorderColor: palette.syrupBright,
  searchHighlightColor: 'rgba(255, 200, 0, 0.35)',
  searchCurrentColor: 'rgba(255, 150, 0, 0.55)',
};

export type ThemeKey = keyof typeof LightTheme;

/**
 * Returns the color for a specific theme key in light or dark mode.
 */
export function getThemeColor(theme: Theme, key: ThemeKey): string {
  if (theme === 'light') {
    return LightTheme[key];
  }
  return DarkTheme[key];
}

/**
 * `relativeLuminance` reads a `#RGB`, `#RRGGBB` or `rgb()/rgba()` fill into
 * WCAG relative luminance, or `undefined` for anything else.
 */
function relativeLuminance(color: string): number | undefined {
  const c = color.trim();
  let rgb: number[] | undefined;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
    if (fn) rgb = [fn[1], fn[2], fn[3]].map(Number);
  }
  if (!rgb || rgb.some((v) => Number.isNaN(v))) return undefined;
  const [r, g, b] = rgb.map((v) => {
    const s = Math.min(255, v) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Returns the ink for a cell's text. An explicit `tc` always wins, and an
 * unfilled cell takes the theme's ink.
 *
 * A filled cell is the one case the theme cannot decide alone: its fill is
 * painted as authored, not themed. The light theme's ink *is* the authored
 * ink, so light mode keeps it, as Google Sheets does. In dark mode the theme's
 * white ink would land on pale fills (a conditional-format `#B7E1CD`) at about
 * 1.2:1, so the dark theme takes whichever of its own ink and the authored ink
 * reads better on that fill: dark fills keep white, pale fills get black.
 */
export function getCellTextColor(
  theme: Theme | undefined,
  themeInk: string,
  bg: string | undefined,
  tc?: string,
): string {
  if (tc) return tc;
  if (!bg || theme !== 'dark') return themeInk;
  const fill = relativeLuminance(bg);
  const themeLum = relativeLuminance(themeInk);
  const authoredInk = LightTheme.cellTextColor;
  const authoredLum = relativeLuminance(authoredInk);
  if (
    fill === undefined ||
    themeLum === undefined ||
    authoredLum === undefined
  ) {
    return themeInk;
  }
  return contrast(authoredLum, fill) > contrast(themeLum, fill)
    ? authoredInk
    : themeInk;
}

const formulaRangeColorKeys: ThemeKey[] = [
  'formulaRange1',
  'formulaRange2',
  'formulaRange3',
  'formulaRange4',
  'formulaRange5',
  'formulaRange6',
];

/**
 * Get a formula range color by index (cycles through available colors).
 */
export function getFormulaRangeColor(theme: Theme, index: number): string {
  return getThemeColor(
    theme,
    formulaRangeColorKeys[index % formulaRangeColorKeys.length],
  );
}

/**
 * Get a peer cursor color based on client ID
 */
export function getPeerCursorColor(theme: Theme, clientID: string): string {
  const colors: ThemeKey[] = [
    'peerCursor1',
    'peerCursor2',
    'peerCursor3',
    'peerCursor4',
    'peerCursor5',
    'peerCursor6',
    'peerCursor7',
    'peerCursor8',
  ];

  // Simple hash function to consistently assign colors to client IDs
  let hash = 0;
  for (let i = 0; i < clientID.length; i++) {
    const char = clientID.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  const colorIndex = Math.abs(hash) % colors.length;
  return getThemeColor(theme, colors[colorIndex]);
}
