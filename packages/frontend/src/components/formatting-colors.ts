// Color picker palettes for text/foreground (TEXT_COLORS) and background/
// highlight (BG_COLORS). 8 columns × 4 rows = 32 swatches per palette.
//
// Layout:
//   Row 1  Neutrals (black → ink → mid → light → white)
//   Row 2  Butter & Maple brand accents (warm)
//   Row 3  Cool counterpoint (brand has no cools — keep so users still
//          have full color expression)
//   Row 4  Earthy + status accents (browns, alarm, warning, success)
//
// Sourced from `@wafflebase/core/tokens` palette where the value matches.

import { palette } from "@wafflebase/core/tokens";

export const TEXT_COLORS = [
  // Row 1 — neutrals
  "#000000",
  palette.neutrals.light.ink, // #2A1E12
  "#4A3826",
  palette.neutrals.light.sub, // #6B584A
  "#857060",
  "#A89784",
  "#CFC3B0",
  "#FFFFFF",
  // Row 2 — Butter & Maple brand accents
  palette.syrupDeep, // #8A4A12
  palette.syrup, // #B8651A
  palette.syrupBright, // #E08A3A
  palette.butter, // #F4C95D
  palette.berry, // #C2484C
  palette.berryBright, // #E27A7E
  palette.leaf, // #5A7A3A
  palette.leafBright, // #A0C078
  // Row 3 — cool counterpoint (not in brand palette)
  "#1A73E8",
  "#039BE5",
  "#00897B",
  "#00BCD4",
  "#3F51B5",
  "#673AB7",
  "#7B1FA2",
  "#D81B60",
  // Row 4 — earthy + status
  "#4E342E",
  "#795548",
  "#5D4037",
  "#607D8B",
  "#455A64",
  "#FF5722",
  "#FFC107",
  "#4CAF50",
] as const;

export const BG_COLORS = [
  // Row 1 — light warm surfaces
  "#FFFFFF",
  palette.neutrals.light.paper, // #FFFDF7
  palette.neutrals.light.bg, // #FBF6EC
  "#F4ECDB",
  palette.neutrals.light.rule, // #E8DCC4
  "#D7C5A0",
  "#BFA67C",
  "#A89784",
  // Row 2 — brand-tinted highlights
  "#FBE8A8",
  "#F4E4D2",
  "#FAD7B0",
  "#F8DADC",
  "#F4C2C5",
  "#E0EAD0",
  "#C7DAA9",
  "#F0E6CC",
  // Row 3 — cool pastels
  "#D9E8FB",
  "#BBD9F5",
  "#CFE8E5",
  "#B0DAD0",
  "#DCDFF4",
  "#C1C6E8",
  "#E6D7EC",
  "#F8D7E2",
  // Row 4 — light grays + status pastels
  "#F5F5F5",
  "#E8E8E8",
  "#D5D5D5",
  "#BBBBBB",
  "#FFE0B2",
  "#FFECB3",
  "#C8E6C9",
  "#B2DFDB",
] as const;
