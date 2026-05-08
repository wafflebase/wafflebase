import type { FontRole, ThemeFont } from "@wafflebase/slides";

/**
 * System fallbacks the themed font picker offers under "System fonts"
 * once the user wants a concrete family that ignores the active theme.
 * Curated to roughly match Google Slides' default system list — no
 * dynamic font loading here, the browser uses whatever is installed.
 *
 * Lives in `.ts` (not the `.tsx` component) so node:test can import it
 * without going through the JSX-stub loader (`tests/resolve-hooks.mjs`).
 */
export const SYSTEM_FONTS: readonly string[] = [
  "Arial",
  "Helvetica",
  "Inter",
  "Roboto",
  "Lora",
  "Times New Roman",
  "Georgia",
  "Courier New",
];

export function isFontRoleSelected(
  value: ThemeFont | undefined,
  role: FontRole,
): boolean {
  return value?.kind === "role" && value.role === role;
}

export function makeRoleFont(role: FontRole): ThemeFont {
  return { kind: "role", role };
}

export function makeFamilyFont(family: string): ThemeFont {
  return { kind: "family", family };
}
