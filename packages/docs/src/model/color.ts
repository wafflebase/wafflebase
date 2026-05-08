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
  // No theme registered; role colors fall back to a sensible default.
  return undefined;
}

export function wrapLegacyColor(c: string | StoredColor): StoredColor {
  return c;
}
