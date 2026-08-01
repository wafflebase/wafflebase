/**
 * Miro sticky notes use NAMED colors (not hex). Map them onto pastel hexes in
 * the same family as the SP2 sticky palette so an imported board looks like a
 * natively-created one.
 */
const STICKY_HEX: Record<string, string> = {
  gray: '#E6E6E6',
  light_yellow: '#FFF8B8',
  yellow: '#FFF176',
  orange: '#FFE0B2',
  light_green: '#DCEDC8',
  green: '#CDEFC4',
  dark_green: '#A5D6A7',
  cyan: '#B2EBF2',
  light_pink: '#FFD6E7',
  pink: '#F8BBD0',
  violet: '#E5D4FF',
  red: '#FFCDD2',
  light_blue: '#C7E5FF',
  blue: '#BBDEFB',
  dark_blue: '#AEC7F0',
  black: '#CFCFCF',
};

/** Miro's documented default sticky color. */
const DEFAULT_STICKY = STICKY_HEX.light_yellow;

/** Named Miro sticky color → hex, falling back to the default yellow. */
export function stickyHex(named: string | undefined): string {
  return (named && STICKY_HEX[named]) || DEFAULT_STICKY;
}
