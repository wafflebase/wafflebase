// docs ships with no theme system of its own. To support themed slides
// (which embed docs Tree blocks), Inline.style.color accepts either a
// concrete hex string or a ThemeColor-shaped object. The renderer
// receives an optional `colorResolver` callback that maps that value to
// a hex string.

export type StoredColor =
  | string
  | { kind: 'role'; role: string; tint?: number; shade?: number }
  | { kind: 'srgb'; value: string };

export type ColorResolver = (c: StoredColor | undefined) => string | undefined;

export function defaultColorResolver(c: StoredColor | undefined): string | undefined {
  if (c == null) return undefined;
  if (typeof c === 'string') return c;
  if (c.kind === 'srgb') return c.value;
  // Role colors require a theme-aware resolver. Return undefined so the
  // caller can supply its own fallback, e.g. `resolve(c) ?? '#000000'`.
  // Do NOT paint `undefined` literally.
  return undefined;
}

/**
 * Value-based equality for `StoredColor` so callers like
 * `inlineStylesEqual` don't suffer reference-equality false negatives
 * after color migration / Yorkie deserialization produces fresh object
 * instances with identical contents.
 */
export function storedColorsEqual(
  a: StoredColor | undefined,
  b: StoredColor | undefined,
): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'srgb' && b.kind === 'srgb') return a.value === b.value;
  if (a.kind === 'role' && b.kind === 'role') {
    return a.role === b.role && a.tint === b.tint && a.shade === b.shade;
  }
  return false;
}

export function wrapLegacyColor(c: string | StoredColor): StoredColor {
  return c;
}

/**
 * Resolve the visible text color at a character offset inside a single
 * block. Finds the inline whose span covers `offset` (with the standard
 * "cursor at the seam between two inlines belongs to the leading
 * inline" rule used by `getStyleAtCursor` / `getSelectionStyle`), runs
 * its `style.color` through `colorResolver`, and falls back when the
 * inline has no color or the resolver returns `undefined`.
 *
 * The caret painter consumes this so the cursor tracks the text color
 * it would assume on the next keystroke — important in slides on dark
 * themes, where the docs `Theme.cursorColor` (light/dark mode of the
 * docs package) does not know about deck-theme backgrounds and would
 * otherwise paint a dark caret on a dark slide.
 */
export function resolveColorAtPosition(
  block: { inlines: ReadonlyArray<{ text: string; style: { color?: StoredColor } }> } | undefined,
  offset: number,
  colorResolver: ColorResolver,
  fallback: string,
): string {
  if (!block || block.inlines.length === 0) return fallback;
  let pos = 0;
  for (const inline of block.inlines) {
    const inlineEnd = pos + inline.text.length;
    if (offset <= inlineEnd) {
      return colorResolver(inline.style.color) ?? fallback;
    }
    pos = inlineEnd;
  }
  const last = block.inlines[block.inlines.length - 1];
  return colorResolver(last.style.color) ?? fallback;
}
