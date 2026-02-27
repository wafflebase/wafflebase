export type Theme = 'light' | 'dark';

export const LightTheme = {
  cellBorderColor: '#D3D3D3',
  customBorderColor: '#000000',
  cellBGColor: '#FFFFFF',
  cellTextColor: '#000000',
  activeCellColor: '#E6C746',
  selectionBGColor: 'rgba(230, 199, 70, 0.1)',
  headerBGColor: '#F0F0F0',
  headerActiveBGColor: '#E6C746',
  ['tokens.REFERENCE']: '#E6C746',
  ['tokens.NUM']: '#4DA6FF',
  // Peer cursor colors
  peerCursor1: '#FF6B6B',
  peerCursor2: '#4ECDC4',
  peerCursor3: '#45B7D1',
  peerCursor4: '#96CEB4',
  peerCursor5: '#FFEAA7',
  peerCursor6: '#DDA0DD',
  peerCursor7: '#98D8C8',
  peerCursor8: '#F7DC6F',
  resizeHandleColor: '#1A73E8',
  headerSelectedBGColor: 'rgba(26, 115, 232, 0.3)',
  dropIndicatorColor: '#1A73E8',
  freezeLineColor: '#BBBBBB',
  freezeHandleColor: '#9E9E9E',
  freezeHandleHoverColor: '#5F6368',
  formulaRange1: '#1A73E8',
  formulaRange2: '#E84C3D',
  formulaRange3: '#9B59B6',
  formulaRange4: '#27AE60',
  formulaRange5: '#F39C12',
  formulaRange6: '#00ACC1',
  filterRangeBorderColor: '#1A73E8',
};

export const DarkTheme = {
  cellBorderColor: '#4A4A4A',
  customBorderColor: '#FFFFFF',
  cellBGColor: '#1E1E1E',
  cellTextColor: '#FFFFFF',
  activeCellColor: '#D4B73E',
  selectionBGColor: 'rgba(212, 183, 62, 0.1)',
  headerBGColor: '#2D2D2D',
  headerActiveBGColor: '#D4B73E',
  ['tokens.REFERENCE']: '#D4B73E',
  ['tokens.NUM']: '#4DA6FF',
  // Peer cursor colors (slightly different for dark theme)
  peerCursor1: '#FF7979',
  peerCursor2: '#55EFC4',
  peerCursor3: '#74B9FF',
  peerCursor4: '#A4D4C4',
  peerCursor5: '#FDCB6E',
  peerCursor6: '#E17055',
  peerCursor7: '#81ECEC',
  peerCursor8: '#F8D84F',
  resizeHandleColor: '#8AB4F8',
  headerSelectedBGColor: 'rgba(138, 180, 248, 0.3)',
  dropIndicatorColor: '#8AB4F8',
  freezeLineColor: '#5A5A5A',
  freezeHandleColor: '#8E8E8E',
  freezeHandleHoverColor: '#CCCCCC',
  formulaRange1: '#8AB4F8',
  formulaRange2: '#FF7979',
  formulaRange3: '#BB86FC',
  formulaRange4: '#66BB6A',
  formulaRange5: '#FFB74D',
  formulaRange6: '#4DD0E1',
  filterRangeBorderColor: '#8AB4F8',
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
