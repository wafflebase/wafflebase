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
 * Does this reference begin with a scheme? Mirrors RFC 3986's `scheme` rule,
 * which is also what a URL parser uses to decide whether a reference is
 * absolute. Anything matching must clear `isSafeUrl`'s allowlist; anything
 * not matching carries no scheme at all and so cannot name a protocol.
 */
const HAS_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * A relative reference that is really an *origin* change. `//host/x` keeps
 * the reader's scheme but swaps the authority, so it reaches an attacker's
 * server exactly as an absolute link would — and the WHATWG parser folds `\`
 * into `/` for special schemes, so `\\host/x` and `/\host/x` resolve the same
 * way. None of these is relative to the exported document.
 */
const SCHEME_RELATIVE = /^[/\\]{2}/;

/**
 * Is `url` both safe to link to *and* safe to write verbatim into a link
 * destination? Every emitted `href`/`src` goes through here.
 *
 * A protocol allowlist can only judge a reference that *has* a protocol.
 * Relative references — `/uploads/x.png` from the app's own upload path,
 * `./a.png` and `#anchor` from HTML paste — name no protocol, so gating on
 * `isSafeUrl` alone rejects every one of them and silently strips legitimate
 * content from the export (an href degrades to bare text, an image to
 * `[image]`). They are accepted here on the strength of what they cannot be:
 * with no scheme they cannot select a dangerous one, and with no authority
 * they cannot leave the document's own origin.
 */
function isEmittableUrl(url: string): boolean {
  if (url.length === 0) return false;
  if (UNEMITTABLE_URL_CHARS.test(url)) return false;
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
  // The character gate first, so it also covers the `data:image` branch —
  // which bypasses `isEmittableUrl` entirely and is therefore the one path
  // where no parser would ever look at the string.
  if (UNEMITTABLE_URL_CHARS.test(src)) return false;
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
 * A run's `text` is inline content — the model puts a paragraph break in a
 * new block, never inside a run — so a line break in one is either import
 * noise or an injection. Emitted verbatim it ends whatever construct
 * encloses it: a blank line closes the paragraph and everything after it is
 * re-parsed as document structure, a single newline truncates a GFM table
 * row, and inside `![...]` it closes the image. Folding them to a space is
 * the only repair that leaves the text in the block it belongs to.
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
 * Escape `)` and `\` inside a link/image href so a URL like
 * `https://x/(a)b` doesn't truncate the `(...)` segment.
 */
function escapeMarkdownHref(href: string): string {
  return href.replace(/[\\)]/g, (ch) => `\\${ch}`);
}
