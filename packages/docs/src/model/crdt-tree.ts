/**
 * The CRDT tree → `Document` read path, shared by every reader of a docs
 * Yorkie root.
 *
 * A docs document's body is a Yorkie `Tree`, so turning one back into a
 * `Document` means walking `doc > block > inline > text` (and, for tables,
 * `block > row > cell > block > …`). That walk existed only in
 * `packages/backend/src/yorkie/docs-tree.ts`, which a browser cannot import
 * — it is a NestJS module. The revision-history preview needs exactly the
 * same walk over a *parsed snapshot*, so it lives here instead, beside the
 * attribute codec (`crdt-attrs.ts`) it already depends on.
 *
 * **This module is deliberately CRDT-library-agnostic.** It reads
 * {@link DocsTreeNode}, a structural subset that both shapes of node satisfy,
 * so `@wafflebase/docs` gains no `@yorkie-js/sdk` dependency. There are two
 * such shapes, and they do not agree:
 *
 * | | live proxy (`tree.getRootTreeNode()`) | `YSON.parse` of a snapshot |
 * | --- | --- | --- |
 * | attribute key | `attributes` | `attrs` |
 * | attribute value | decoded (`center`) | JSON-encoded (`"center"`) |
 *
 * The live SDK path runs each attribute through `JSON.parse` on the way out
 * (`parseObjectValues`); `YSON.parse` assigns the raw map verbatim and its
 * `postprocessTreeNode` whitelists `{type, value, attrs, children}`. A reader
 * that ignored either difference would not throw — it would produce a
 * document whose every block fell back to `paragraph` with no style, which
 * renders as plausible-looking but silently wrong content. Snapshot callers
 * must therefore normalize first; see `normalizeYsonTreeNode` in the
 * frontend's `snapshot-adapters.ts`.
 */
import type {
  Block,
  Document,
  Inline,
  TableCell,
  TableRow,
} from './types.js';
import { parseBlockStyleAttrs, parseMarginFromEdgeAttr } from './crdt-attrs.js';

/**
 * The structural subset of a CRDT tree node this reader needs.
 *
 * Attribute values are the *decoded* strings — `center`, not `"center"`.
 */
export interface DocsTreeNode {
  type: string;
  /** Present on `text` nodes only. */
  value?: string;
  attributes?: Record<string, string>;
  children?: DocsTreeNode[];
}

function attrsOf(node: DocsTreeNode): Record<string, string> {
  return node.attributes ?? {};
}

function parseInlineStyle(
  attrs: Record<string, string> | undefined,
): Inline['style'] {
  const style: Inline['style'] = {};
  if (!attrs) return style;
  if ('bold' in attrs) style.bold = attrs.bold === 'true';
  if ('italic' in attrs) style.italic = attrs.italic === 'true';
  if ('underline' in attrs) style.underline = attrs.underline === 'true';
  if ('strikethrough' in attrs)
    style.strikethrough = attrs.strikethrough === 'true';
  if ('superscript' in attrs) style.superscript = attrs.superscript === 'true';
  if ('subscript' in attrs) style.subscript = attrs.subscript === 'true';
  if ('fontSize' in attrs) style.fontSize = Number(attrs.fontSize);
  if ('fontFamily' in attrs) style.fontFamily = attrs.fontFamily;
  if ('color' in attrs) style.color = attrs.color;
  if ('backgroundColor' in attrs) style.backgroundColor = attrs.backgroundColor;
  if ('href' in attrs) style.href = attrs.href;
  if ('pageNumber' in attrs) style.pageNumber = attrs.pageNumber === 'true';
  if ('image.src' in attrs) {
    const width = Number(attrs['image.width']);
    const height = Number(attrs['image.height']);
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      const image: NonNullable<Inline['style']['image']> = {
        src: attrs['image.src'],
        width,
        height,
      };
      if ('image.alt' in attrs) image.alt = attrs['image.alt'];
      style.image = image;
    }
  }
  return style;
}

function parseBorderStyle(
  value: string,
): TableCell['style']['borderTop'] | undefined {
  // Border attributes serialize as `width,style,color`, but a CSS color
  // like `rgb(255, 128, 0)` itself contains commas. A naive `split(',')`
  // would yield 5 parts and drop the border. Locate the first two commas
  // only and treat everything after the second comma as the color.
  const firstComma = value.indexOf(',');
  if (firstComma === -1) return undefined;
  const secondComma = value.indexOf(',', firstComma + 1);
  if (secondComma === -1) return undefined;
  return {
    width: Number(value.slice(0, firstComma)),
    style: value.slice(firstComma + 1, secondComma) as 'solid' | 'none',
    color: value.slice(secondComma + 1),
  };
}

function parseCellStyle(attrs: Record<string, string>): TableCell['style'] {
  const style: TableCell['style'] = {};
  if (attrs.backgroundColor) style.backgroundColor = attrs.backgroundColor;
  if (attrs.verticalAlign)
    style.verticalAlign = attrs.verticalAlign as 'top' | 'middle' | 'bottom';
  if (attrs.padding) style.padding = Number(attrs.padding);
  if (attrs.borderTop) style.borderTop = parseBorderStyle(attrs.borderTop);
  if (attrs.borderBottom)
    style.borderBottom = parseBorderStyle(attrs.borderBottom);
  if (attrs.borderLeft) style.borderLeft = parseBorderStyle(attrs.borderLeft);
  if (attrs.borderRight)
    style.borderRight = parseBorderStyle(attrs.borderRight);
  return style;
}

function treeNodeToInline(node: DocsTreeNode): Inline {
  if (node.type === 'text') {
    return { text: node.value ?? '', style: {} };
  }
  const text = (node.children ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.value ?? '')
    .join('');
  return { text, style: parseInlineStyle(node.attributes) };
}

function treeNodeToCell(node: DocsTreeNode): TableCell {
  const attrs = attrsOf(node);
  const blocks = (node.children ?? [])
    .filter((c) => c.type === 'block')
    .map(treeNodeToBlock);
  return {
    blocks:
      blocks.length > 0
        ? blocks
        : [
            {
              id: '',
              type: 'paragraph',
              inlines: [{ text: '', style: {} }],
              style: parseBlockStyleAttrs(undefined),
            },
          ],
    style: parseCellStyle(attrs),
    colSpan: attrs.colSpan ? Number(attrs.colSpan) : undefined,
    rowSpan: attrs.rowSpan ? Number(attrs.rowSpan) : undefined,
  };
}

function treeNodeToRow(node: DocsTreeNode): TableRow {
  return {
    cells: (node.children ?? [])
      .filter((c) => c.type === 'cell')
      .map(treeNodeToCell),
  };
}

/** One `block` tree node as a `Block` (tables included, recursively). */
export function treeNodeToBlock(node: DocsTreeNode): Block {
  const attrs = attrsOf(node);
  const blockType = (attrs.type as Block['type']) ?? 'paragraph';

  if (blockType === 'table') {
    const rows = (node.children ?? [])
      .filter((c) => c.type === 'row')
      .map(treeNodeToRow);
    const cols = (attrs.cols ?? '')
      .split(',')
      .map(Number)
      .filter((n) => !isNaN(n));
    const rowHeights = attrs.rowHeights
      ? attrs.rowHeights
          .split(',')
          .map((v) => (v === '' ? undefined : Number(v)))
      : undefined;
    return {
      id: attrs.id ?? '',
      type: 'table',
      inlines: [],
      style: parseBlockStyleAttrs(attrs),
      tableData: {
        rows,
        columnWidths: cols,
        ...(rowHeights ? { rowHeights } : {}),
      },
    };
  }

  const inlines = (node.children ?? [])
    .filter((c) => c.type === 'inline')
    .map(treeNodeToInline);
  const block: Block = {
    id: attrs.id ?? '',
    type: blockType,
    inlines:
      inlines.length > 0
        ? inlines
        : blockType === 'horizontal-rule' || blockType === 'page-break'
          ? []
          : [{ text: '', style: {} }],
    style: parseBlockStyleAttrs(attrs),
  };
  if ('headingLevel' in attrs)
    block.headingLevel = Number(attrs.headingLevel) as Block['headingLevel'];
  if ('listKind' in attrs) block.listKind = attrs.listKind as Block['listKind'];
  if ('listLevel' in attrs) block.listLevel = Number(attrs.listLevel);
  return block;
}

/**
 * The `doc` root node as a `Document` — body blocks plus the optional header
 * and footer regions.
 *
 * `pageSetup` is not read here: it is a plain object on the Yorkie root
 * rather than a tree node, and the live reader has to walk it property by
 * property to avoid the proxy's double-encoding. Callers attach it.
 * `stylesJson` *is* accepted, because both callers decode it identically and
 * a divergence there would silently drop every named-style override.
 */
export function docsTreeToDocument(
  root: DocsTreeNode,
  opts?: { stylesJson?: string },
): Document {
  const doc: Document = { blocks: [] };
  for (const child of root.children ?? []) {
    if (child.type === 'header') {
      doc.header = {
        blocks: (child.children ?? []).map(treeNodeToBlock),
        marginFromEdge: parseMarginFromEdgeAttr(attrsOf(child).marginFromEdge),
      };
    } else if (child.type === 'footer') {
      doc.footer = {
        blocks: (child.children ?? []).map(treeNodeToBlock),
        marginFromEdge: parseMarginFromEdgeAttr(attrsOf(child).marginFromEdge),
      };
    } else if (child.type === 'block') {
      doc.blocks.push(treeNodeToBlock(child));
    }
  }
  if (opts?.stylesJson) {
    try {
      doc.styles = JSON.parse(opts.stylesJson);
    } catch {
      // Malformed registry → fall back to built-in styles.
    }
  }
  return doc;
}
