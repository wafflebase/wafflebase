import type {
  Block,
  Document,
  HeaderFooter,
  Inline,
  TableCell,
  TableData,
} from '../model/types.js';
// Straight from `@wafflebase/core/url` rather than through
// `view/url-detect.js` (which only re-exports it): a serializer has no
// business reaching into the view layer.
import { isSafeUrl } from '@wafflebase/core/url';

/**
 * Options for the Markdown serializer.
 *
 * - `inlineImages` — when `false` (default), `data:` URLs are replaced
 *   with the `[image]` placeholder so the produced Markdown stays
 *   readable in a terminal. When `true`, the full `src` is emitted as
 *   the link target (useful when piping to a Markdown renderer).
 * - `includeHeaderFooter` — emit the document header before, and footer
 *   after, the body. Defaults to `false`; headers/footers are page-level
 *   chrome and don't fit a single linear stream.
 */
export interface MarkdownOptions {
  inlineImages?: boolean;
  includeHeaderFooter?: boolean;
}

/**
 * Serialize a `Document` to GitHub-Flavoured Markdown per design § 5.1.
 *
 * Lossy by intention — alignment, indent, line-height, color, font
 * choice, sup/sub, underline, table merges, and nested tables are all
 * dropped. The CLI prints a one-line stderr notice on first use; this
 * pure function does **not** print to stderr.
 */
export function serializeMarkdown(
  doc: Document,
  opts: MarkdownOptions = {},
): string {
  const includeHF = opts.includeHeaderFooter === true;
  const sections: string[] = [];

  if (includeHF && doc.header) {
    sections.push(serializeHeaderFooter(doc.header, opts));
  }

  sections.push(serializeBlocks(doc.blocks, opts));

  if (includeHF && doc.footer) {
    sections.push(serializeHeaderFooter(doc.footer, opts));
  }

  // Block-level entries inside a section are joined with a single \n;
  // the whole sections (header/body/footer) get a blank line between
  // them so they render as separate Markdown blocks.
  return sections.filter((s) => s.length > 0).join('\n\n');
}

function serializeHeaderFooter(
  region: HeaderFooter,
  opts: MarkdownOptions,
): string {
  return serializeBlocks(region.blocks, opts);
}

function serializeBlocks(blocks: Block[], opts: MarkdownOptions): string {
  // Block-level boundaries (paragraph→paragraph, paragraph→table,
  // list-end→paragraph, …) need a blank line between them so each side
  // renders as its own GFM block. The one exception is consecutive
  // list-items in the same list — they stay tight on adjacent lines so
  // they coalesce into one list rather than fragmenting.
  //
  // Empty-rendered blocks (e.g., an empty subtitle) must not contribute
  // separators of their own, otherwise an empty middle block would
  // double the spacing between the two real blocks around it. Track the
  // last non-empty block's type for the tight-list decision.
  let out = '';
  let prevType: Block['type'] | null = null;
  for (const b of blocks) {
    const rendered = blockToMarkdown(b, opts);
    if (rendered.length === 0) continue;
    if (out.length > 0) {
      const tight = prevType === 'list-item' && b.type === 'list-item';
      out += tight ? '\n' : '\n\n';
    }
    out += rendered;
    prevType = b.type;
  }
  return out;
}

function blockToMarkdown(block: Block, opts: MarkdownOptions): string {
  const text = inlinesToMarkdown(block.inlines, opts);

  switch (block.type) {
    case 'title':
      return `# ${text}`;

    case 'subtitle':
      // Italic paragraph; an empty subtitle would emit a stray `*`,
      // so collapse it to an empty string and let the block joiner
      // skip past it.
      return text.length > 0 ? `*${text}*` : '';

    case 'heading': {
      const level = clampHeadingLevel(block.headingLevel);
      return `${'#'.repeat(level)} ${text}`;
    }

    case 'paragraph':
      return text;

    case 'list-item': {
      const indent = '  '.repeat(Math.max(0, block.listLevel ?? 0));
      const marker = block.listKind === 'ordered' ? '1.' : '-';
      return `${indent}${marker} ${text}`;
    }

    case 'horizontal-rule':
      return '---';

    case 'page-break':
      return '<!-- pagebreak -->';

    case 'table':
      return tableToMarkdown(block.tableData, opts);
  }
}

function clampHeadingLevel(level: number | undefined): number {
  if (typeof level !== 'number' || level < 1) return 1;
  if (level > 6) return 6;
  return Math.floor(level);
}

function tableToMarkdown(
  tableData: TableData | undefined,
  opts: MarkdownOptions,
): string {
  if (!tableData || tableData.rows.length === 0) return '';

  const rows = tableData.rows.map((row) =>
    row.cells.map((cell) => cellToMarkdown(cell, opts)),
  );

  // Pad shorter rows with empty cells so the column count is uniform —
  // GFM tables require it. We can't faithfully represent merges (the
  // design explicitly drops them), so this is the most honest choice.
  const colCount = Math.max(...rows.map((r) => r.length));
  for (const r of rows) {
    while (r.length < colCount) r.push('');
  }

  const [header, ...body] = rows;
  const sep = Array.from({ length: colCount }, () => '---');

  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function cellToMarkdown(cell: TableCell, opts: MarkdownOptions): string {
  // Cells may hold multiple blocks. For GFM table compatibility we
  // collapse them to a single line — newlines inside a cell would break
  // the table layout. Nested tables are replaced with a placeholder per
  // design § 5.1.
  const parts: string[] = [];
  for (const inner of cell.blocks) {
    if (inner.type === 'table') {
      parts.push('[nested table]');
      continue;
    }
    parts.push(inlinesToMarkdown(inner.inlines, opts));
  }
  // Pipe characters inside cell text would break the table syntax.
  return parts.join(' ').replace(/\|/g, '\\|');
}

/**
 * Convert a flat list of inlines to a Markdown text fragment, wrapping
 * each run independently in any active formatting markers. Image and
 * page-number inlines are special-cased ahead of any text-style logic
 * since they shouldn't be wrapped in `**`/`*`/`~~`.
 */
function inlinesToMarkdown(inlines: Inline[], opts: MarkdownOptions): string {
  let out = '';
  for (const inline of inlines) {
    out += inlineToMarkdown(inline, opts);
  }
  return out;
}

function inlineToMarkdown(inline: Inline, opts: MarkdownOptions): string {
  const { style, text } = inline;

  if (style.image) {
    return imageInline(style.image, opts);
  }
  if (style.pageNumber) {
    return '#';
  }

  // Strip stray ORC characters that aren't carrying a special role.
  const stripped = text.replace(/\uFFFC/g, '');

  if (stripped.length === 0) {
    return '';
  }

  // Escape Markdown special chars in plain text so a paragraph like
  // "Use * for emphasis" doesn't accidentally turn into emphasis.
  let body = escapeMarkdownText(stripped);

  // Same protocol gate the editor and the PDF exporter apply. A run can
  // carry any string as its `href` (DOCX/HTML import, a pasted document, the
  // CRDT itself), and the produced `.md` is opened by a renderer that will
  // happily make `javascript:` or `data:text/html` clickable. An unsafe href
  // degrades to the plain text it wrapped rather than becoming a live link.
  if (style.href && isEmittableUrl(style.href)) {
    body = `[${body}](${escapeMarkdownHref(style.href)})`;
  }
  if (style.strikethrough) {
    body = `~~${body}~~`;
  }
  if (style.italic) {
    body = `*${body}*`;
  }
  if (style.bold) {
    body = `**${body}**`;
  }
  return body;
}

/**
 * Characters that disqualify a URL from being written into a Markdown link
 * destination, checked against the **raw** string before anything parses it.
 *
 * Without this the gate is a parser differential. `isSafeUrl` validates what
 * WHATWG `new URL()` makes of the input, and that parser silently *deletes*
 * every tab, LF and CR (and trims leading/trailing C0-or-space) before it
 * looks at the scheme — but the serializer writes the raw string. So
 * `https://example.com/\n\n<img src=x onerror=…>` passes the protocol check
 * and then closes the `(...)` destination, and everything after the newline
 * lands in the exported `.md` as live Markdown or raw HTML. The value is
 * attacker-influenceable: HTML paste, DOCX import, a collaborator's CRDT
 * write.
 *
 * Refusing these characters — rather than emitting `new URL(href).href`, the
 * other way to close the differential — keeps every accepted URL byte-for-byte
 * as the author wrote it (normalizing would percent-encode every non-ASCII
 * path, turning a readable link into `%ED%95%9C…`), and covers one case
 * normalization does not: a space is not stripped but still terminates a
 * CommonMark link destination.
 *
 * `\s` carries the Unicode spaces; the two ranges add the C0 and C1 controls
 * (`\t`, `\n` and `\r` are in both).
 */
const UNEMITTABLE_URL_CHARS = /[\s\u0000-\u001F\u007F-\u009F]/;

/**
 * Every character an emitted link destination may contain: the RFC 3986 URI
 * character set — unreserved (`A-Za-z0-9-._~`), gen-delims (`:/?#[]@`),
 * sub-delims (`!$&'()*+,;=`) and `%` for percent-encoding — plus any
 * non-ASCII character.
 *
 * This is the allowlist half of the invariant below. Its power is in what
 * RFC 3986 leaves *out*: `<`, `>` and `\` are not URI characters at all, and
 * those are exactly the three characters a CommonMark renderer acts on when
 * it reads a destination. Nothing here has to enumerate them.
 *
 * Non-ASCII is admitted rather than percent-encoded so a link written
 * `/uploads/한글.png` survives the export as the author wrote it; it can name
 * no scheme, no authority and no Markdown construct. The whitespace and
 * control characters `UNEMITTABLE_URL_CHARS` refuses are checked separately,
 * because that class reaches into the non-ASCII range this one admits.
 */
const URI_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%\u0080-\uFFFF]+$/;

/**
 * An HTML entity reference: `&` followed by a name, `&#` decimal digits, or
 * `&#x` hex digits, terminated by `;`.
 *
 * `&` is a legitimate URI sub-delim — `?x=1&y=2` is the single most common
 * shape a query string has — so it cannot simply be excluded from
 * `URI_CHARS`. But it is also the one admitted character that *starts a
 * decoder*, and CommonMark decodes entity references inside a link
 * destination. Only `&` immediately followed by an entity's shape is refused;
 * a query separator is not, since `&y=2` has no terminating `;`.
 *
 * Any `&name;` is refused, not just the HTML5 names CommonMark actually
 * decodes: the conservative superset costs nothing (a URL wanting a literal
 * ampersand spells it `%26`) and needs no copy of the entity table.
 */
const ENTITY_REFERENCE = /&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/;

/**
 * Is `url` written the same way the consumer will read it?
 *
 * This is the invariant the whole gate rests on, and the one round 3 got
 * wrong: it judged raw bytes while the consumer resolves a *transformed*
 * string, so every transform was a hole. A CommonMark renderer applies three
 * of them to a link destination before any URL parser sees it —
 *
 *  - it accepts the `[text](<destination>)` form and strips the angle
 *    brackets, so `<javascript:alert(1)>` carries no scheme as raw bytes but
 *    resolves as one (and `<script>` lands in the `.md` as raw HTML, since
 *    `escapeMarkdownHref` never escaped `<`);
 *  - it decodes HTML entity references, so `&#106;avascript:` and
 *    `&#47;&#47;evil.example/x` have neither a literal scheme nor a leading
 *    `//` until the moment they do;
 *  - it resolves backslash escapes, which the WHATWG parser then compounds by
 *    folding `\` into `/` for special schemes.
 *
 * — and a URL parser adds its own (deleting tabs/CR/LF, trimming C0-or-space)
 * which `UNEMITTABLE_URL_CHARS` already covers. Rather than model each
 * rewrite, this refuses any destination that *has* one to apply, so the
 * string the gate judges and the string the consumer resolves are the same
 * string. `(` and `)` are the deliberate exception: they are ordinary URI
 * characters that would truncate the `(…)` segment, so they are admitted here
 * and escaped on the way out by `escapeMarkdownHref`, which is a
 * transformation we control and which restores the exact original bytes.
 */
function isLiteralDestination(url: string): boolean {
  if (url.length === 0) return false;
  if (UNEMITTABLE_URL_CHARS.test(url)) return false;
  if (!URI_CHARS.test(url)) return false;
  return !ENTITY_REFERENCE.test(url);
}

/**
 * Does this reference begin with a scheme? Mirrors RFC 3986's `scheme` rule,
 * which is also what a URL parser uses to decide whether a reference is
 * absolute. Anything matching must clear `isSafeUrl`'s allowlist; anything
 * not matching carries no scheme at all and so cannot name a protocol.
 *
 * A relative reference whose *first segment* holds a colon — `foo:bar/x.png`
 * — matches, fails the allowlist, and is dropped. That is deliberate, not a
 * misclassification: RFC 3986 §4.2 says such a segment cannot begin a
 * relative-path reference precisely because every parser reads it as a
 * scheme, and the RFC's own remedy (`./foo:bar/x.png`) is accepted here.
 * Guessing "relative" for a string the consumer will read as absolute is the
 * same class of mistake as the ones above.
 */
const HAS_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * A relative reference that is really an *origin* change. `//host/x` keeps
 * the reader's scheme but swaps the authority, so it reaches an attacker's
 * server exactly as an absolute link would. The backslash spellings
 * (`\\host/x`, `/\host/x`), which the WHATWG parser folds to the same thing,
 * never reach here — `\` is not a URI character — but stay matched so this
 * rule reads as the whole rule rather than half of one.
 */
const SCHEME_RELATIVE = /^[/\\]{2}/;

/**
 * Is `url` both safe to link to *and* safe to write verbatim into a link
 * destination? Every emitted `href`/`src` goes through here.
 *
 * `isLiteralDestination` first, so everything after it judges the same bytes
 * the consumer resolves. Then a protocol allowlist, which can only judge a
 * reference that *has* a protocol. Relative references — `/uploads/x.png`
 * from the app's own upload path, `./a.png` and `#anchor` from HTML paste —
 * name no protocol, so gating on `isSafeUrl` alone rejects every one of them
 * and silently strips legitimate content from the export (an href degrades to
 * bare text, an image to `[image]`). They are accepted on the strength of
 * what they cannot be: with no scheme they cannot select a dangerous one, and
 * with no authority they cannot leave the document's own origin.
 */
function isEmittableUrl(url: string): boolean {
  if (!isLiteralDestination(url)) return false;
  if (HAS_SCHEME.test(url)) return isSafeUrl(url);
  return !SCHEME_RELATIVE.test(url);
}

/**
 * `data:` URLs that are safe to emit as an image target: an image MIME type
 * and nothing else. `isSafeUrl` refuses every `data:` URL — right for a
 * hyperlink, too strict for `inlineImages`, whose whole purpose is to carry
 * the pasted bytes into the file. `data:text/html`, `data:image/svg+xml`
 * (which can script) and every other payload stay out.
 */
const SAFE_IMAGE_DATA_URI =
  /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|avif);base64,[A-Za-z0-9+/=]*$/i;

/** Is `src` something we are willing to write as an image target? */
function isSafeImageSrc(src: string): boolean {
  // The literal-destination gate first, so it also covers the `data:image`
  // branch — which bypasses `isEmittableUrl` entirely and is therefore the one
  // path where no parser would ever look at the string. Without it,
  // `<data:image/png;base64,…>` and `data:image&#47;png;…` reach
  // `SAFE_IMAGE_DATA_URI`, whose `^`/`$` anchors judge bytes the renderer will
  // have rewritten before it resolves them.
  if (!isLiteralDestination(src)) return false;
  return SAFE_IMAGE_DATA_URI.test(src) || isEmittableUrl(src);
}

function imageInline(
  image: NonNullable<Inline['style']['image']>,
  opts: MarkdownOptions,
): string {
  const alt = escapeMarkdownAlt(image.alt ?? '');
  // Case-insensitive to agree with `SAFE_IMAGE_DATA_URI` (and with every URL
  // parser, for which a scheme is case-insensitive). Spelled `DATA:` this
  // test used to answer `false`, so a data URL was emitted inline with
  // `inlineImages` off — the one thing this branch exists to prevent.
  const isDataUri = /^data:/i.test(image.src);
  if (isDataUri && !opts.inlineImages) {
    return '[image]';
  }
  // An image `src` is a URL the reader's Markdown renderer will fetch (or,
  // for `javascript:`/`data:text/html`, may execute). Nothing validates it
  // on the way into the model, so gate it here — the same argument as the
  // hyperlink above, and the same fallback: the placeholder, not a live URL.
  if (!isSafeImageSrc(image.src)) {
    return '[image]';
  }
  return `![${alt}](${escapeMarkdownHref(image.src)})`;
}

/**
 * Line separators, which no backslash escape neutralizes.
 *
 * A `\n` inside a run is **not** import noise: it is this model's soft line
 * break — word-processor Shift+Enter — and the layout engine implements it as
 * a first-class feature (`MeasuredSegment.softBreak`, a zero-width run that
 * forces a wrap without splitting the paragraph). Three importers produce
 * one: DOCX `<w:br/>`, PPTX `<a:br>`, and an HTML `<br>` pasted inside a
 * table cell, whose content is a single paragraph and so cannot be split into
 * blocks. An earlier revision of this comment claimed the model "never" puts
 * a break inside a run; that was wrong, and it is corrected here rather than
 * left to justify the fold.
 *
 * The fold itself stands, for two reasons that survive the correction:
 *
 *  - it is what a soft break *means* in Markdown. GFM renders a source line
 *    break inside a paragraph as a space, so folding to a space reproduces
 *    the break's rendered effect in a format that has no other spelling for
 *    it (the two-trailing-spaces hard break is a different construct, and a
 *    lossy export is this serializer's stated contract).
 *  - emitted verbatim it ends whatever construct encloses it: a blank line
 *    closes the paragraph and everything after it is re-parsed as document
 *    structure, a single newline truncates a GFM table row, and inside
 *    `![...]` it closes the image. So a break that *is* an injection — the
 *    same character, arriving from a paste or a collaborator's CRDT write —
 *    is neutralized by the same rule.
 *
 * NEL (U+0085) and the Unicode line/paragraph separators are included
 * alongside CR and LF because a downstream renderer or editor may treat
 * them as breaks too.
 */
const LINE_SEPARATORS = /[\r\n\u0085\u2028\u2029]/g;

/**
 * Backslash-escape Markdown special characters in a plain-text run so
 * literal characters like `*`, `_`, `[`, `` ` `` survive the round trip.
 * Backslash itself is escaped first; otherwise the escapes inserted for
 * the other characters would themselves be unescaped on parse.
 *
 * Line separators cannot be escaped, so they are folded to a space first —
 * this does not fight the block joiner, which builds its `\n` / `\n\n`
 * separators from the *rendered blocks*, never from run text.
 */
function escapeMarkdownText(text: string): string {
  return text
    .replace(LINE_SEPARATORS, ' ')
    .replace(/[\\*_[\]`~<]/g, (ch) => `\\${ch}`);
}

/**
 * Escape an image alt.
 *
 * `alt` is as attacker-influenceable as `src`: it arrives from clipboard
 * JSON paste, `insertImage`, DOCX/HTML import and a collaborator's CRDT
 * write, and nothing validates it on the way into the model. Escaping only
 * `]` left the `![...]` segment closable by a line break — after which the
 * payload lands in the exported `.md` as live Markdown or, since `<` was
 * also unescaped, as raw HTML. It gets the same treatment as body text,
 * which already covers `]`, `[`, `\` and `<`.
 */
function escapeMarkdownAlt(alt: string): string {
  return escapeMarkdownText(alt);
}

/**
 * Escape the parentheses inside a link/image href so a URL like
 * `https://en.wikipedia.org/wiki/Foo_(bar)` doesn't truncate — or unbalance —
 * the enclosing `(...)` destination.
 *
 * Both are escaped, not just `)`: CommonMark accepts unescaped parentheses in
 * a destination only when they *balance*, so a URL carrying a lone `(` needs
 * the escape as much as one carrying a lone `)`.
 *
 * This is the only rewriting the serializer does to a destination, and it is
 * information-preserving — a CommonMark reader resolves `\(` back to `(` — so
 * `isLiteralDestination`'s guarantee survives it. Backslash is no longer
 * escaped here because it can no longer arrive: it is not an RFC 3986 URI
 * character, so `URI_CHARS` refuses any href containing one, and the only
 * backslashes in the output are the ones this function writes.
 */
function escapeMarkdownHref(href: string): string {
  return href.replace(/[()]/g, (ch) => `\\${ch}`);
}
