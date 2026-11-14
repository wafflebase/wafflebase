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
  // The syrup step that carries text and text-bearing fills in light mode.
  // `syrup` itself is 4.11:1 under its cream label and 4.27:1 as text on
  // white — fine for strokes and handles (≥3:1), short of AA for words.
  // syrup-strong is 5.32:1 under #FFFAF0, 5.53:1 on white, 5.14:1 on cream.
  syrupStrong: '#9E5614',
  syrupDeep: '#8A4A12',
  syrupBright: '#E08A3A', // dark-mode brand
  butter: '#F4C95D',
  berry: '#C2484C',
  berryBright: '#E27A7E', // dark-mode berry
  leaf: '#5A7A3A',
  leafBright: '#A0C078',  // dark-mode leaf

  // Hyperlinks — the one non-syrup hue in chrome, because a link has to read
  // as a link. Google's own pair, so a URL looks the same in the editors as
  // in the suite they mirror: #1967D2 is 5.37:1 on white and 4.98:1 on
  // cream; #8AB4F8 is 9.44:1 on the dark background.
  link: '#1967D2',
  linkBright: '#8AB4F8', // dark-mode link

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
  // Its syntax hues are locked too: the mode-flipping `--wb-berry` /
  // `--wb-leaf` are the light-mode stops in light mode, 3.69:1 / 3.65:1 on
  // this roast. The bright stops are 6.25:1 / 8.80:1.
  terminal: {
    bg: '#1C1610',
    fg: '#FBF6EC',
    keyword: '#E27A7E', // = berryBright
    flag: '#A0C078', // = leafBright
  },
} as const;

export type Palette = typeof palette;
