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

/**
 * Named Miro sticky color → hex, falling back to the default yellow.
 *
 * The lookup is own-property-only. `named` arrives verbatim from externally
 * supplied Miro JSON, and a bare index would resolve inherited
 * `Object.prototype` keys — `'constructor'`, `'toString'`, `'__proto__'` etc.
 * would return a function rather than a hex string, silently violating the
 * declared return type. `tsc` cannot catch this because `Record<string, T>`
 * does not model prototype fallthrough.
 */
export function stickyHex(named: string | undefined): string {
  const mapped =
    named && Object.prototype.hasOwnProperty.call(STICKY_HEX, named)
      ? STICKY_HEX[named]
      : undefined;
  return mapped || DEFAULT_STICKY;
}
