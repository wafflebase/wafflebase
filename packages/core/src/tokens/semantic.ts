import { palette } from './palette';

type SemanticColorMap = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  /**
   * The one accent as a fill or as text. Light mode uses syrup-strong rather
   * than syrup: the cream label on syrup is 4.11:1 and syrup text on white
   * 4.27:1, both under AA. Every pairing is asserted in `contrast.test.ts`.
   */
  primary: string;
  primaryForeground: string;
  /**
   * Hover fill for a primary control. Always a step *darker* than `primary`:
   * the old `bg-primary/90` composited toward the background, which lightens
   * a light-mode fill (3.49:1 under its label) instead of pressing it.
   * Light syrup-deep is 6.58:1 under `primaryForeground`; dark #C97A30 is
   * 5.39:1 under roast.
   */
  primaryHover: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  /**
   * Qualified success — an operation completed, but not cleanly. Distinct from
   * `destructive`, which says the operation failed.
   *
   * Unlike every other colour here it is NOT one hue rendered lighter in dark
   * mode, and that is not a fact about amber — **no colour of any hue can
   * clear 4.5:1 against both of this file's `background` values.** WCAG
   * contrast is `(Yhi + 0.05) / (Ylo + 0.05)` over relative luminance alone,
   * so hue and chroma reach it only through `Y`, and the question collapses
   * to one number. Against `oklch(1 0 0)` (#ffffff, Y = 1) and
   * `oklch(0.141 0.005 285.823)` (#09090b, Y ≈ 0.00279):
   *
   *     light: 1.05 / (Y + 0.05)        — falls as Y rises
   *     dark:  (Y + 0.05) / 0.05279     — rises as Y rises
   *
   * The worse of the two is largest where they cross, at
   * `(Y + 0.05)² = 1.05 × 0.05279`, i.e. `Y ≈ 0.1854` — where both are
   * **4.46:1**. That is the ceiling for a single value, and it is under the
   * AA floor for text. Two independently chosen values are therefore forced,
   * not a shortcut; trying a different hue cannot recover it.
   *
   * The two shipped stops sit either side of that ceiling, each clearing AA
   * on its own background: amber-700 is 5.05:1 on white and 3.94:1 on the
   * dark one, amber-500 inverts it at 2.15:1 and 9.27:1.
   */
  warning: string;
  /**
   * Success — an operation completed cleanly, or a connection is live. Leaf
   * from the brand palette rather than a stock green, so status stays inside
   * the Butter & Maple world. Like `warning` it carries one value per theme:
   * leaf is 4.91:1 on the light `background` (#ffffff) and leaf-bright is
   * 9.76:1 on the dark one (#09090b).
   */
  success: string;
  border: string;
  input: string;
  /**
   * Form-control boundary (Input, Select trigger, Switch off-track). `border`
   * is a hairline between regions and measures ~1.3:1; a control's edge is
   * what tells you where to click, so it must clear WCAG 1.4.11's 3:1. Light
   * is 3.37:1 on `background` (3.07:1 on `muted`); dark is 3.60:1 on
   * `background` and 3.21:1 on `popover`, where most dialog inputs sit.
   */
  inputBorder: string;
  ring: string;
  /**
   * Hyperlink text. One hue per theme (see `palette.link`), AA on
   * `background`: 5.37:1 light, 9.44:1 dark.
   */
  link: string;
  /**
   * The on state of a toggle, pressed tool or picked option. Separate from
   * `accent`, which shadcn spends on hover and keyboard focus in every menu —
   * sharing that value made an "on" toggle look exactly like a hovered one.
   * It is the sidebar's active-item butter wash (DESIGN.md: "active is butter
   * wash"), so every "this one is chosen" signal in the chrome reads alike.
   *
   * `selectedForeground` on the wash composited over `background`: light
   * syrup-deep on #FCEFCE is 5.99:1, dark butter on #332C1A is 8.81:1 — both
   * clear AA for text, not just the 3:1 floor for icons.
   */
  selected: string;
  selectedForeground: string;
  /**
   * Five chart series, syrup first. Hues step orange → denim → teal → rose →
   * olive gold so neighbours differ in hue and lightness. No purple, and none
   * equal to a status token (rose sits at h355, clear of `destructive`'s h27;
   * there is no green, which `success` owns). Ratios against `background`
   * are noted per theme below; every series clears the 3:1 graphics floor.
   */
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
  /**
   * Per-document-type identity hues (list icons, filter and create menus,
   * template cards) — Drive's convention of one recognisable color per type.
   * Drawn from the Butter & Maple world rather than Tailwind stock hues: no
   * purple or fuchsia, and nothing in syrup's orange band, so a type icon is
   * never mistaken for the one accent. They are non-text graphics, so the bar
   * is 3:1 against `background`; each value notes its ratio.
   */
  typeSheet: string;
  typeDoc: string;
  typeNote: string;
  typeSlides: string;
  typePdf: string;
  typeImage: string;
  typeBoard: string;
  typeFile: string;
};

const light: SemanticColorMap = {
  background: 'oklch(1 0 0)',
  foreground: 'oklch(0.141 0.005 285.823)',
  card: 'oklch(1 0 0)',
  cardForeground: 'oklch(0.141 0.005 285.823)',
  popover: 'oklch(1 0 0)',
  popoverForeground: 'oklch(0.141 0.005 285.823)',
  primary: palette.syrupStrong,
  primaryForeground: '#FFFAF0',
  primaryHover: palette.syrupDeep,
  secondary: 'oklch(0.967 0.001 286.375)',
  secondaryForeground: 'oklch(0.21 0.006 285.885)',
  muted: 'oklch(0.967 0.001 286.375)',
  mutedForeground: 'oklch(0.552 0.016 285.938)',
  accent: 'oklch(0.967 0.001 286.375)',
  accentForeground: 'oklch(0.21 0.006 285.885)',
  destructive: 'oklch(0.577 0.245 27.325)',
  // amber-700 — 5.05:1 on `background` (#ffffff). amber-600 would be 3.19:1,
  // under the floor and *less* legible than the destructive red beside it.
  warning: 'oklch(0.555 0.163 48.998)',
  success: palette.leaf,
  border: 'oklch(0.92 0.004 286.32)',
  input: 'oklch(0.92 0.004 286.32)',
  inputBorder: 'oklch(0.64 0.016 285.938)',
  // The ring stays base syrup: it is a 3px graphic (≥3:1), not text.
  ring: palette.syrup,
  link: palette.link,
  selected: `rgba(${palette.butterRgb}, 0.30)`,
  selectedForeground: palette.syrupDeep,
  // On #ffffff: 4.27 / 5.99 / 4.07 / 4.65 / 3.36.
  chart1: palette.syrup,
  chart2: 'oklch(0.50 0.12 250)',
  chart3: 'oklch(0.58 0.10 185)',
  chart4: 'oklch(0.58 0.15 355)',
  chart5: 'oklch(0.64 0.12 95)',
  // Sidebar chrome is intentionally neutral — brand colors should appear on
  // interaction (active item, hover, focus ring), not on the surface itself.
  // Editor tools feel more professional when the chrome is quiet.
  sidebar: 'oklch(0.985 0 0)',
  sidebarForeground: 'oklch(0.141 0.005 285.823)',
  sidebarPrimary: palette.syrupStrong,
  sidebarPrimaryForeground: '#FFFAF0',
  sidebarAccent: `rgba(${palette.butterRgb}, 0.30)`,
  sidebarAccentForeground: palette.syrupDeep,
  sidebarBorder: 'oklch(0.92 0.004 286.32)',
  sidebarRing: palette.syrup,
  // Ratios on #ffffff.
  typeSheet: palette.leaf, // 4.91:1
  typeDoc: 'oklch(0.52 0.12 250)', // denim, 5.50:1
  typeNote: palette.neutrals.light.sub, // cocoa ink, 6.73:1
  typeSlides: 'oklch(0.55 0.09 195)', // teal, 4.64:1
  typePdf: palette.berry, // 4.86:1
  typeImage: 'oklch(0.56 0.15 355)', // rose, 5.05:1
  typeBoard: 'oklch(0.62 0.12 95)', // sticky-note gold, 3.64:1
  typeFile: 'oklch(0.552 0.016 285.938)', // = mutedForeground, 4.83:1
};

const dark: SemanticColorMap = {
  background: 'oklch(0.141 0.005 285.823)',
  foreground: 'oklch(0.985 0 0)',
  card: 'oklch(0.21 0.006 285.885)',
  cardForeground: 'oklch(0.985 0 0)',
  popover: 'oklch(0.21 0.006 285.885)',
  popoverForeground: 'oklch(0.985 0 0)',
  primary: palette.syrupBright,
  primaryForeground: palette.neutrals.dark.bg,
  // Darker than syrup-bright, not lighter: a lighter fill would read as lit,
  // and roast-on-syrup must stay ≥4.5:1 (5.39:1 here).
  primaryHover: '#C97A30',
  secondary: 'oklch(0.274 0.006 286.033)',
  secondaryForeground: 'oklch(0.985 0 0)',
  muted: 'oklch(0.274 0.006 286.033)',
  mutedForeground: 'oklch(0.705 0.015 286.067)',
  accent: 'oklch(0.274 0.006 286.033)',
  accentForeground: 'oklch(0.985 0 0)',
  destructive: 'oklch(0.704 0.191 22.216)',
  // amber-500 — 9.27:1 on `background` (#09090b). The light stop would be
  // 3.94:1 here, which is why this token carries two values rather than one.
  warning: 'oklch(0.769 0.188 70.08)',
  success: palette.leafBright,
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  inputBorder: 'oklch(0.52 0.016 285.938)',
  ring: palette.syrupBright,
  link: palette.linkBright,
  selected: `rgba(${palette.butterRgb}, 0.18)`,
  selectedForeground: palette.butter,
  // The light hues lifted for the dark surface. On #09090b:
  // 7.45 / 8.07 / 9.02 / 7.53 / 12.98.
  chart1: palette.syrupBright,
  chart2: 'oklch(0.72 0.11 250)',
  chart3: 'oklch(0.74 0.10 185)',
  chart4: 'oklch(0.72 0.13 355)',
  chart5: 'oklch(0.86 0.13 90)',
  // Sidebar chrome is intentionally neutral — see light-mode comment.
  sidebar: 'oklch(0.205 0.006 285.885)',
  sidebarForeground: 'oklch(0.985 0 0)',
  sidebarPrimary: palette.syrupBright,
  sidebarPrimaryForeground: 'oklch(0.205 0.006 285.885)',
  sidebarAccent: `rgba(${palette.butterRgb}, 0.18)`,
  sidebarAccentForeground: palette.butter,
  sidebarBorder: 'oklch(1 0 0 / 10%)',
  sidebarRing: palette.syrupBright,
  // Ratios on #09090b.
  typeSheet: palette.leafBright, // 9.76:1
  typeDoc: 'oklch(0.74 0.10 250)', // 8.68:1
  typeNote: palette.neutrals.dark.sub, // 8.19:1
  typeSlides: 'oklch(0.76 0.09 195)', // 9.62:1
  typePdf: palette.berryBright, // 6.93:1
  typeImage: 'oklch(0.75 0.12 355)', // 8.45:1
  typeBoard: palette.butter, // 12.66:1
  typeFile: 'oklch(0.705 0.015 286.067)', // = mutedForeground, 7.57:1
};

export const semantic = { light, dark } as const;
export type SemanticTokens = typeof semantic;
