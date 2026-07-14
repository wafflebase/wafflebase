/**
 * Butter & Maple — raw brand colors.
 *
 * Values are authored as hex (#RRGGBB) so they can be assigned directly to
 * Canvas `fillStyle`/`strokeStyle` in the sheets/docs/slides packages, and
 * inlined into the generated `tokens.css` via the build script.
 */
export const palette = {
  // Brand
  syrup: '#B8651A',
  syrupDeep: '#8A4A12',
  syrupBright: '#E08A3A', // dark-mode brand
  butter: '#F4C95D',
  berry: '#C2484C',
  berryBright: '#E27A7E', // dark-mode berry
  leaf: '#5A7A3A',
  leafBright: '#A0C078',  // dark-mode leaf

  // RGB tuples — for composing `rgba(...)` strings in Canvas code.
  syrupRgb: '184, 101, 26',
  butterRgb: '244, 201, 93',
  berryRgb: '194, 72, 76',

  // Neutrals — paired light/dark surfaces.
  neutrals: {
    light: {
      bg: '#FBF6EC',
      paper: '#FFFDF7',
      ink: '#2A1E12',
      sub: '#6B584A',
      rule: '#E8DCC4',
    },
    dark: {
      bg: '#1C1610',
      paper: '#241D14',
      ink: '#FBF6EC',
      sub: '#B5A48A',
      rule: '#3A2E1F',
    },
  },

  // Terminal — locked dark surface across both modes (preserves the
  // existing wb-terminal-bg / wb-terminal-fg behavior in index.css).
  terminal: {
    bg: '#1C1610',
    fg: '#FBF6EC',
  },
} as const;

export type Palette = typeof palette;
