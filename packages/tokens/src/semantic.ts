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
