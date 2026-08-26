import type MarkdownIt from 'markdown-it';

// `markdown-it`'s `export =` shape means its `MarkdownIt.StateInline` /
// `MarkdownIt.Token` namespace types aren't reachable through the default
// import (see the same note in `preview.ts`). Derive the types we need from
// the instance shape instead of naming the namespace.
type StateInline = InstanceType<MarkdownIt['inline']['State']>;

/**
 * Sized images (`<img src="…" width="200">`) for the notes preview.
 *
 * Markdown has no image-sizing syntax — CommonMark's image is only
 * `![alt](src "title")` — so what everyone pastes from GitHub is raw HTML.
 * The preview runs markdown-it with `html: false` on purpose (raw HTML in a
 * collaborator's note is a stored-XSS vector — see the SECURITY note in
 * `preview.ts`), which escapes that snippet to literal text.
 *
 * Rather than flip that safety off, this plugin follows the
 * `<details>`/`<summary>` precedent in `details-plugin.ts`: allowlist ONE tag
 * with ONE fixed attribute set. It recognizes `<img …>` as an inline token and
 * accepts only:
 *
 *   src     required, run through markdown-it's own `normalizeLink` +
 *           `validateLink` — the same gate the `![]()` path uses, so
 *           `javascript:` and friends never reach the DOM
 *   alt     plain text
 *   width   digits, optionally `%`
 *   height  digits, optionally `%`
 *
 * Anything else — an unknown attribute, a `200px`/`calc()` dimension, a
 * refused URL, a missing `src` — makes the rule decline, and the tag falls
 * through to the normal `html: false` pipeline and is escaped as literal
 * text, exactly as it is today. Declining rather than dropping the offending
 * attribute is deliberate: silently ignoring `style="width:200px"` would
 * render at intrinsic size with no hint why.
 *
 * The token pushed is a normal `image` token, so markdown-it escapes the
 * attribute values it emits and `preview.ts`'s existing image rule
 * (`loading="lazy"` / `decoding="async"`) applies unchanged.
 *
 * Supported source shapes (attribute order is free, quoting may be double,
 * single, or absent, and the tag may or may not self-close):
 *
 *   <img src="drawing.jpg" alt="drawing" width="200" />
 *   <img width=50% src='drawing.jpg'>
 */

/**
 * The whole tag. `[^<>]` for the attribute region keeps the match from
 * running past a malformed tag into the rest of the line — an attribute value
 * containing a raw `<` or `>` is not something we need to support.
 */
const IMG_TAG_RE = /^<img(\s[^<>]*?)?\s*\/?>/i;

/**
 * One `name` or `name=value` pair. The unquoted-value form excludes the
 * characters HTML forbids there, so `src=a b` reads as two attributes rather
 * than one value with a space.
 */
const ATTR_RE = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'`=<>]+))?/g;

/** Dimensions are numbers or percentages — nothing that could carry CSS. */
const DIMENSION_RE = /^\d+%?$/;

type Attrs = { src?: string; alt?: string; width?: string; height?: string };

/**
 * Splits a tag's attribute region into our four names, or returns null if it
 * contains anything else (including a syntactically malformed run that the
 * pair regex cannot account for).
 */
function parseAttrs(md: MarkdownIt, region: string): Attrs | null {
  const attrs: Attrs = {};
  let cursor = 0;
  ATTR_RE.lastIndex = 0;

  for (
    let match = ATTR_RE.exec(region);
    match !== null;
    match = ATTR_RE.exec(region)
  ) {
    // Text skipped between pairs must be whitespace only; anything else means
    // the region isn't a plain attribute list (e.g. a stray quote or `=`).
    if (region.slice(cursor, match.index).trim() !== '') return null;
    cursor = match.index + match[0].length;

    const name = match[1].toLowerCase();
    if (
      name !== 'src' &&
      name !== 'alt' &&
      name !== 'width' &&
      name !== 'height'
    ) {
      return null;
    }
    // Repeated attribute: ambiguous, so refuse rather than pick one.
    if (attrs[name] !== undefined) return null;

    const raw = match[2];
    // A valueless attribute (`<img src>`) carries nothing we can use.
    if (raw === undefined) return null;
    const quoted = raw[0] === '"' || raw[0] === "'";
    // `unescapeAll` resolves backslash escapes and character references, the
    // same treatment markdown-it gives a link destination.
    attrs[name] = md.utils.unescapeAll(quoted ? raw.slice(1, -1) : raw);
  }

  if (region.slice(cursor).trim() !== '') return null;
  return attrs;
}

function imgRule(state: StateInline, silent: boolean): boolean {
  // Cheap bail before the regex: every match starts `<i`.
  if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;

  const match = IMG_TAG_RE.exec(state.src.slice(state.pos, state.posMax));
  if (!match) return false;

  const attrs = parseAttrs(state.md, match[1] ?? '');
  if (!attrs) return false;

  const { src, alt = '', width, height } = attrs;
  if (src === undefined || src === '') return false;
  if (width !== undefined && !DIMENSION_RE.test(width)) return false;
  if (height !== undefined && !DIMENSION_RE.test(height)) return false;

  const href = state.md.normalizeLink(src);
  if (!state.md.validateLink(href)) return false;

  if (!silent) {
    const token = state.push('image', 'img', 0);
    // `alt` must be present and precede the optional dimensions: markdown-it's
    // default image renderer writes the rendered children into whatever
    // position `attrIndex('alt')` reports, and throws if there is none.
    token.attrs = [
      ['src', href],
      ['alt', ''],
    ];
    if (width !== undefined) token.attrs.push(['width', width]);
    if (height !== undefined) token.attrs.push(['height', height]);
    // The alt text of an HTML attribute is literal, not markdown, so it goes
    // in as a single text child rather than through the inline parser. The
    // renderer reads the `alt` attribute off these children (see above), so
    // `token.content` alone would render as `alt=""`.
    const text = new state.Token('text', '', 0);
    text.content = alt;
    token.children = [text];
    token.content = alt;
  }

  state.pos += match[0].length;
  return true;
}

/**
 * markdown-it plugin: registers the `<img>` inline rule ahead of
 * `html_inline`, the rule that would otherwise own a `<` opening a tag (and
 * that is inert under `html: false`).
 */
export function imgPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('html_inline', 'note_img', imgRule);
}
