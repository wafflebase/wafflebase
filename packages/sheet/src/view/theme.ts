export type Theme = 'light' | 'dark';

export const LightTheme = {
  cellBorderColor: '#D3D3D3',
  cellBGColor: '#FFFFFF',
  cellTextColor: '#000000',
  activeCellColor: '#E6C746',
  selectionBGColor: 'rgba(230, 199, 70, 0.1)',
  headerBGColor: '#F0F0F0',
  headerActiveBGColor: '#E6C746',
  ['tokens.REFERENCE']: '#E6C746',
  ['tokens.NUM']: '#4DA6FF',
};

export const DarkTheme = {
  cellBorderColor: '#4A4A4A',
  cellBGColor: '#1E1E1E',
  cellTextColor: '#FFFFFF',
  activeCellColor: '#D4B73E',
  selectionBGColor: 'rgba(212, 183, 62, 0.1)',
  headerBGColor: '#2D2D2D',
  headerActiveBGColor: '#D4B73E',
  ['tokens.REFERENCE']: '#D4B73E',
  ['tokens.NUM']: '#4DA6FF',
};

export type ThemeKey = keyof typeof LightTheme;

export function getThemeColor(theme: Theme, key: ThemeKey): string {
  if (theme === 'light') {
    return LightTheme[key];
  }
  return DarkTheme[key];
}
