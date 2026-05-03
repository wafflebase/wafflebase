import type {
  Block,
  Document,
  HeaderFooter,
  Inline,
  TableCell,
  TableData,
} from '../model/types.js';

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

  if (style.href) {
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

function imageInline(
  image: NonNullable<Inline['style']['image']>,
  opts: MarkdownOptions,
): string {
  const alt = escapeMarkdownAlt(image.alt ?? '');
  const isDataUri = image.src.startsWith('data:');
  if (isDataUri && !opts.inlineImages) {
    return '[image]';
  }
  return `![${alt}](${escapeMarkdownHref(image.src)})`;
}

/**
 * Backslash-escape Markdown special characters in a plain-text run so
 * literal characters like `*`, `_`, `[`, `` ` `` survive the round trip.
 * Backslash itself is escaped first; otherwise the escapes inserted for
 * the other characters would themselves be unescaped on parse.
 */
function escapeMarkdownText(text: string): string {
  return text.replace(/[\\*_[\]`~<]/g, (ch) => `\\${ch}`);
}

/**
 * Escape `]` inside a link body or image alt — the only character that
 * can prematurely close the `[...]` segment.
 */
function escapeMarkdownAlt(alt: string): string {
  return alt.replace(/[\\\]]/g, (ch) => `\\${ch}`);
}

/**
 * Escape `)` and `\` inside a link/image href so a URL like
 * `https://x/(a)b` doesn't truncate the `(...)` segment.
 */
function escapeMarkdownHref(href: string): string {
  return href.replace(/[\\)]/g, (ch) => `\\${ch}`);
}
