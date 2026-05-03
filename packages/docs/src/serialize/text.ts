import type {
  Block,
  Document,
  HeaderFooter,
  Inline,
  TableCell,
} from '../model/types.js';

/**
 * Options for the plaintext serializer.
 *
 * - `includeHeaderFooter` — emit the document header before, and footer
 *   after, the body. Defaults to `false` because headers/footers are a
 *   page-level decoration that doesn't survive a single linear stream.
 */
export interface TextOptions {
  includeHeaderFooter?: boolean;
}

/**
 * Serialize a `Document` to a plaintext stream.
 *
 * Rules:
 * - One block per line; blocks are joined with `\n`.
 * - All inline formatting is dropped.
 * - List items emit just their text (no `-` / `1.` markers — the caller
 *   gets a flat sequence and can renumber if it cares).
 * - Tables become tab-separated rows with `\n` between rows. Merges and
 *   nested tables are flattened (cell text only).
 * - `horizontal-rule` becomes a literal `----` line.
 * - `page-break` becomes a form-feed character on its own line; some
 *   downstream tools (`less`, paginators) treat it specially.
 * - Image inlines render as `[image]`; page-number markers become `#`.
 */
export function serializeText(doc: Document, opts: TextOptions = {}): string {
  const includeHF = opts.includeHeaderFooter === true;
  const segments: string[] = [];

  if (includeHF && doc.header) {
    segments.push(serializeHeaderFooter(doc.header));
  }

  segments.push(serializeBlocks(doc.blocks));

  if (includeHF && doc.footer) {
    segments.push(serializeHeaderFooter(doc.footer));
  }

  return segments.filter((s) => s.length > 0).join('\n');
}

function serializeHeaderFooter(region: HeaderFooter): string {
  return serializeBlocks(region.blocks);
}

function serializeBlocks(blocks: Block[]): string {
  return blocks.map(blockToText).join('\n');
}

function blockToText(block: Block): string {
  switch (block.type) {
    case 'horizontal-rule':
      return '----';
    case 'page-break':
      return '\f';
    case 'table':
      return tableToText(block);
    default:
      return inlinesToText(block.inlines);
  }
}

function tableToText(block: Block): string {
  if (!block.tableData) return '';
  return block.tableData.rows
    .map((row) => row.cells.map(cellToText).join('\t'))
    .join('\n');
}

function cellToText(cell: TableCell): string {
  // Cell content can itself contain multiple blocks (incl. nested
  // tables). Flatten them with a single space — newlines inside a cell
  // would shred the row's tab alignment.
  return cell.blocks.map(blockToText).join(' ');
}

function inlinesToText(inlines: Inline[]): string {
  let out = '';
  for (const inline of inlines) {
    if (inline.style.image) {
      out += '[image]';
      continue;
    }
    if (inline.style.pageNumber) {
      out += '#';
      continue;
    }
    // Strip stray ORC (U+FFFC) characters that aren't carrying
    // image/pageNumber styling — keeping them in plaintext just
    // produces tofu in terminals.
    out += inline.text.replace(/\uFFFC/g, '');
  }
  return out;
}
