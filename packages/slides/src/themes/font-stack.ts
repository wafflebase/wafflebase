/**
 * Extracts the first family name from a CSS font stack.
 *
 * OOXML `FontScheme` slots store a single family name (e.g. `"Fraunces"`),
 * while `@wafflebase/tokens` exposes typography as full CSS stacks
 * (`'"Fraunces", ui-serif, Georgia, serif'`). The theme factories pull the
 * leading family so the OOXML defaults remain authoring-friendly while the
 * tokens package stays a CSS-first source.
 */
export function firstFamily(stack: string): string {
  return stack.split(',')[0].replace(/"/g, '').trim();
}
