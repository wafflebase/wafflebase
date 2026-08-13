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
 * Resolve a `StoredColor` to a paintable color string, treating the
 * legacy "reset color" empty string as *unset* (issue #728). Returns
 * `undefined` when there is nothing paintable, so every caller supplies
 * its own fallback: `resolveStoredColor(resolve, c) ?? theme.defaultColor`.
 *
 * The empty string is normalized on BOTH sides of the resolver, and both
 * halves matter:
 *
 * - **Before** — an empty color is collapsed to `undefined` so a
 *   theme-aware resolver (slides' `makeColorResolver`) takes its "no color
 *   set" branch and returns the deck theme's text color, exactly as it does
 *   for a run that was never colored. Normalizing only afterwards would
 *   send a cleared run to the docs default color, painting near-black
 *   text on a dark deck. Both spellings of "empty" count: the bare `''`
 *   and the wrapped `{ kind: 'srgb', value: '' }` a theme-color migration
 *   or PPTX import can produce.
 * - **After** — a resolver can still hand back an empty string (a custom
 *   resolver, or an `{ kind: 'srgb', value: '' }` shape), and
 *   `ctx.fillStyle = ''` is an invalid assignment the canvas IGNORES,
 *   leaving the run painted in whatever the previous pass set (typically
 *   the selection fill). That was the visible bug in #728.
 */
export function resolveStoredColor(
  resolve: ColorResolver,
  c: StoredColor | undefined,
): string | undefined {
  return resolve(isEmptyStoredColor(c) ? undefined : c) || undefined;
}

/**
 * Whether a `StoredColor` carries no color at all — the legacy `''` reset
 * of issue #728 in either of its two shapes (bare string, or wrapped as an
 * `srgb` theme color by the color migration / PPTX import path).
 *
 * `StoredColor` is a *persisted* shape: it arrives from the content PUT API,
 * PPTX/DOCX import and older schema versions, so the static type is a claim
 * rather than a guarantee. Anything that is not a string and not an object
 * with a string `value` is treated as "no color" instead of being
 * dereferenced — a `null` or `{ kind: 'srgb', value: 42 }` would otherwise
 * throw inside the paint loop and take down the renderer for every viewer of
 * the document.
 */
function isEmptyStoredColor(c: StoredColor | undefined): boolean {
  if (c == null) return true;
  if (typeof c === 'string') return c.trim() === '';
  if (typeof c !== 'object') return true;
  const value = (c as { kind?: unknown; value?: unknown }).value;
  if ((c as { kind?: unknown }).kind !== 'srgb') return false;
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * Whether a CSS alpha component (`rgba()`'s fourth argument) means fully
 * transparent. Accepts the number and percentage forms; anything
 * unparseable is treated as opaque, so a color the user can see is never
 * dropped because its alpha was written in a syntax we don't read.
 */
function isTransparentAlpha(raw: string): boolean {
  const a = raw.trim();
  const n = a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a);
  return Number.isFinite(n) && n <= 0;
}

/**
 * Normalize a concrete color string into an RGB hex value — six upper-case
 * hex digits, no leading `#` — or `undefined` when it cannot be expressed
 * as one.
 *
 * Every export sink that writes a color into an OOXML attribute needs this:
 * DOCX `w:color/@w:val` and `w:shd/@w:fill` are typed `ST_HexColor`, PPTX
 * `<a:srgbClr val>` is `ST_HexColorRGB`, but `StoredColor` holds whatever
 * string reached the model. The HTML-paste path (`view/clipboard.ts`)
 * copies browser-normalized CSS verbatim, so `rgb(255, 0, 0)` is routine;
 * the legacy `''` reset of issue #728 and DOCX/PPTX import add more
 * shapes. Emitting those verbatim yields a schema-invalid file that Word /
 * PowerPoint refuse to open, so the recognized CSS forms are converted and
 * everything else returns `undefined` — the caller drops the attribute and
 * the run inherits the document/theme default.
 *
 * A **fully transparent** color also returns `undefined`: none of these
 * attributes carry alpha, so keeping the triplet would paint an opaque
 * block (a black highlight behind `rgba(0,0,0,0)` text) where the screen
 * shows nothing. Partial alpha keeps the triplet and renders opaque, which
 * is closer to what the user sees than dropping the color entirely.
 *
 * Returning only `[0-9A-F]{6}` also makes these attributes injection-proof
 * by construction — the validation subsumes any XML attribute escaping.
 */
export function toRgbHexColor(color: string | undefined): string | undefined {
  // `string` is a claim, not a guarantee: the value reaches here from
  // `defaultColorResolver`, which passes a persisted `{ kind: 'srgb', value }`
  // through untouched even when `value` is not a string (content PUT API,
  // hand-edited CRDT). Fail closed rather than throwing inside an export.
  if (!color || typeof color !== 'string') return undefined;
  const v = color.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
  // #RGB shorthand — expand each nibble (CSS rule: #abc === #aabbcc).
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    return v.split('').map((ch) => ch + ch).join('').toUpperCase();
  }
  // #RRGGBBAA — keep the RGB and drop the alpha, except when the color is
  // fully transparent, which has no opaque equivalent at all.
  if (/^[0-9a-fA-F]{8}$/.test(v)) {
    if (v.slice(6).toUpperCase() === '00') return undefined;
    return v.slice(0, 6).toUpperCase();
  }
  // Channels accept a sign so an out-of-gamut `rgb(300, -5, 0)` clamps
  // below instead of falling through to "not a color" and dropping a
  // background the user can see.
  const rgb = /^rgba?\(\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*(?:,([^)]*))?\)$/i.exec(v);
  if (rgb) {
    if (rgb[4] !== undefined && isTransparentAlpha(rgb[4])) return undefined;
    const channels = [rgb[1], rgb[2], rgb[3]].map((n) =>
      Math.max(0, Math.min(255, Math.round(Number(n)))),
    );
    if (channels.some((n) => Number.isNaN(n))) return undefined;
    return channels.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
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
 * its `style.color` through `resolveStoredColor` (so a legacy "reset
 * color" empty string is treated as unset — see issue #728), and falls
 * back when the inline has no color or nothing paintable resolves.
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
      return resolveStoredColor(colorResolver, inline.style.color) ?? fallback;
    }
    pos = inlineEnd;
  }
  const last = block.inlines[block.inlines.length - 1];
  return resolveStoredColor(colorResolver, last.style.color) ?? fallback;
}
