// Color picker palettes for text/foreground (TEXT_COLORS) and background/
// highlight (BG_COLORS). 6 columns × 3 rows = 18 swatches per palette.
//
// Layout:
//   Row 1  Warm neutrals (ink → paper / paper → warm tan)
//   Row 2  Butter & Maple brand accents (warm) / brand-tinted pastels
//   Row 3  Cool counterpoint (brand has no cools — keep so users still
//          have full color expression) / cool pastels
//
// Sourced from `@wafflebase/tokens` palette where the value matches;
// cool-side hex stays inline since tokens doesn't define cools.

import { palette } from "@wafflebase/tokens";

export const TEXT_COLORS = [
  // Row 1 — warm neutrals
  palette.neutrals.light.ink, // #2A1E12
  "#4A3826",
  palette.neutrals.light.sub, // #6B584A
  "#857060",
  "#A89784",
  "#FFFFFF",
  // Row 2 — Butter & Maple brand accents
  palette.syrupDeep, // #8A4A12
  palette.syrup, // #B8651A
  palette.syrupBright, // #E08A3A
  palette.butter, // #F4C95D
  palette.berry, // #C2484C
  palette.leaf, // #5A7A3A
  // Row 3 — cool counterpoint (not in brand palette)
  "#1A73E8",
  "#039BE5",
  "#00897B",
  "#3F51B5",
  "#7B1FA2",
  "#D81B60",
] as const;

export const BG_COLORS = [
  // Row 1 — warm light surfaces
  "#FFFFFF",
  palette.neutrals.light.paper, // #FFFDF7
  palette.neutrals.light.bg, // #FBF6EC
  "#F4ECDB",
  palette.neutrals.light.rule, // #E8DCC4
  "#D7C5A0",
  // Row 2 — brand-tinted highlights
  "#F4E4D2",
  "#FBE8A8",
  "#F8DADC",
  "#E0EAD0",
  "#FAD7B0",
  "#F0E6CC",
  // Row 3 — cool pastels
  "#D9E8FB",
  "#D6EAF8",
  "#CFE8E5",
  "#DCDFF4",
  "#E6D7EC",
  "#F8D7E2",
] as const;
