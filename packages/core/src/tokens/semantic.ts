import { palette } from './palette';

type SemanticColorMap = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
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
  border: string;
  input: string;
  ring: string;
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
};

const light: SemanticColorMap = {
  background: 'oklch(1 0 0)',
  foreground: 'oklch(0.141 0.005 285.823)',
  card: 'oklch(1 0 0)',
  cardForeground: 'oklch(0.141 0.005 285.823)',
  popover: 'oklch(1 0 0)',
  popoverForeground: 'oklch(0.141 0.005 285.823)',
  primary: palette.syrup,
  primaryForeground: '#FFFAF0',
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
  border: 'oklch(0.92 0.004 286.32)',
  input: 'oklch(0.92 0.004 286.32)',
  ring: palette.syrup,
  chart1: palette.syrup,
  chart2: 'oklch(0.6 0.118 184.704)',
  chart3: 'oklch(0.398 0.07 227.392)',
  chart4: 'oklch(0.828 0.189 84.429)',
  chart5: 'oklch(0.769 0.188 70.08)',
  // Sidebar chrome is intentionally neutral — brand colors should appear on
  // interaction (active item, hover, focus ring), not on the surface itself.
  // Editor tools feel more professional when the chrome is quiet.
  sidebar: 'oklch(0.985 0 0)',
  sidebarForeground: 'oklch(0.141 0.005 285.823)',
  sidebarPrimary: palette.syrup,
  sidebarPrimaryForeground: '#FFFAF0',
  sidebarAccent: `rgba(${palette.butterRgb}, 0.30)`,
  sidebarAccentForeground: palette.syrupDeep,
  sidebarBorder: 'oklch(0.92 0.004 286.32)',
  sidebarRing: palette.syrup,
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
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: palette.syrupBright,
  chart1: palette.syrupBright,
  chart2: 'oklch(0.696 0.17 162.48)',
  chart3: 'oklch(0.769 0.188 70.08)',
  chart4: 'oklch(0.627 0.265 303.9)',
  chart5: 'oklch(0.645 0.246 16.439)',
  // Sidebar chrome is intentionally neutral — see light-mode comment.
  sidebar: 'oklch(0.205 0.006 285.885)',
  sidebarForeground: 'oklch(0.985 0 0)',
  sidebarPrimary: palette.syrupBright,
  sidebarPrimaryForeground: 'oklch(0.205 0.006 285.885)',
  sidebarAccent: `rgba(${palette.butterRgb}, 0.18)`,
  sidebarAccentForeground: palette.butter,
  sidebarBorder: 'oklch(1 0 0 / 10%)',
  sidebarRing: palette.syrupBright,
};

export const semantic = { light, dark } as const;
export type SemanticTokens = typeof semantic;
