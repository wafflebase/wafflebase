/**
 * Yorkie Tree <-> docs `Document` serialization for the backend.
 *
 * This is a deliberate, narrowly-scoped mirror of the writer/reader logic in
 * `packages/frontend/src/app/docs/yorkie-doc-store.ts`. It exists because the
 * docs Yorkie root is a `Tree` CRDT and the editor's serializer is tied to
 * React/browser code paths we cannot import from a NestJS process.
 *
 * Limitations (Phase 3):
 *   - No undo/redo history coordination — these endpoints replace the entire
 *     content tree. Concurrent collaborators may lose live edits, which is
 *     acceptable for the CLI's import flow (`safety: destructive` upstream).
 *   - Header/footer round-trips work for plain block children but do not
 *     attempt to mirror every editor-side migration of legacy shapes.
 *   - Inline images are stored as opaque attribute strings; the writer trusts
 *     the caller-provided `Document` structure verbatim and does not reupload
 *     binary data.
 *
 * If/when this duplication becomes painful, extract a `writeDocsRoot()`
 * helper into `@wafflebase/docs` that takes a Yorkie `Tree` constructor + a
 * mutable root, and have both the frontend store and this module call it.
 */
import {
  type ElementNode,
  Tree,
  type TreeNode,
} from '@yorkie-js/sdk';
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_HEADER_MARGIN_FROM_EDGE,
  normalizeBlockStyle,
} from '@wafflebase/docs';
import type {
  DocsBlock,
  DocsBlockStyle,
  DocsDocument,
  DocsInline,
  DocsPageSetup,
  DocsTableCell,
  DocsTableRow,
} from './yorkie.types';

/**
 * The Yorkie root shape used by word-processor documents. Mirrors
 * `frontend/src/types/docs-document.ts#YorkieDocsRoot`.
 */
export interface DocsYorkieRoot extends Record<string, unknown> {
  content?: Tree;
  pageSetup?: DocsPageSetup;
}

// ---------------------------------------------------------------------------
// Attribute serializers
// ---------------------------------------------------------------------------

function setIfDefined(
  attrs: Record<string, string>,
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (value !== undefined) {
    attrs[key] = String(value);
  }
}

function serializeInlineStyle(
  style: DocsInline['style'],
): Record<string, string> {
  const attrs: Record<string, string> = {};
  setIfDefined(attrs, 'bold', style.bold);
  setIfDefined(attrs, 'italic', style.italic);
  setIfDefined(attrs, 'underline', style.underline);
  setIfDefined(attrs, 'strikethrough', style.strikethrough);
  setIfDefined(attrs, 'superscript', style.superscript);
  setIfDefined(attrs, 'subscript', style.subscript);
  setIfDefined(attrs, 'fontSize', style.fontSize);
  if (style.fontFamily !== undefined) attrs.fontFamily = style.fontFamily;
  if (style.color !== undefined) attrs.color = style.color;
  if (style.backgroundColor !== undefined)
    attrs.backgroundColor = style.backgroundColor;
  if (style.href !== undefined) attrs.href = style.href;
  setIfDefined(attrs, 'pageNumber', style.pageNumber);
  if (style.image !== undefined) {
    attrs['image.src'] = style.image.src;
    attrs['image.width'] = String(style.image.width);
    attrs['image.height'] = String(style.image.height);
    if (style.image.alt !== undefined) {
      attrs['image.alt'] = style.image.alt;
    }
  }
  return attrs;
}

function parseInlineStyle(
  attrs: Record<string, string> | undefined,
): DocsInline['style'] {
  const style: DocsInline['style'] = {};
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
      const image: NonNullable<DocsInline['style']['image']> = {
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

function serializeBlockStyle(
  style: DocsBlock['style'],
): Record<string, string> {
  return {
    alignment: style.alignment,
    lineHeight: String(style.lineHeight),
    marginTop: String(style.marginTop),
    marginBottom: String(style.marginBottom),
    textIndent: String(style.textIndent),
    marginLeft: String(style.marginLeft),
  };
}

function parseBlockStyle(
  attrs: Record<string, string> | undefined,
): DocsBlockStyle {
  if (!attrs) return { ...DEFAULT_BLOCK_STYLE };
  const partial: Partial<DocsBlockStyle> = {};
  if ('alignment' in attrs)
    partial.alignment = attrs.alignment as DocsBlockStyle['alignment'];
  if ('lineHeight' in attrs) partial.lineHeight = Number(attrs.lineHeight);
  if ('marginTop' in attrs) partial.marginTop = Number(attrs.marginTop);
  if ('marginBottom' in attrs) partial.marginBottom = Number(attrs.marginBottom);
  if ('textIndent' in attrs) partial.textIndent = Number(attrs.textIndent);
  if ('marginLeft' in attrs) partial.marginLeft = Number(attrs.marginLeft);
  return normalizeBlockStyle(partial);
}

function serializeCellStyle(cell: DocsTableCell): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (cell.colSpan !== undefined && cell.colSpan !== 1)
    attrs.colSpan = String(cell.colSpan);
  if (cell.rowSpan !== undefined && cell.rowSpan !== 1)
    attrs.rowSpan = String(cell.rowSpan);
  const s = cell.style;
  if (s.backgroundColor) attrs.backgroundColor = s.backgroundColor;
  if (s.verticalAlign) attrs.verticalAlign = s.verticalAlign;
  if (s.padding !== undefined) attrs.padding = String(s.padding);
  if (s.borderTop)
    attrs.borderTop = `${s.borderTop.width},${s.borderTop.style},${s.borderTop.color}`;
  if (s.borderBottom)
    attrs.borderBottom = `${s.borderBottom.width},${s.borderBottom.style},${s.borderBottom.color}`;
  if (s.borderLeft)
    attrs.borderLeft = `${s.borderLeft.width},${s.borderLeft.style},${s.borderLeft.color}`;
  if (s.borderRight)
    attrs.borderRight = `${s.borderRight.width},${s.borderRight.style},${s.borderRight.color}`;
  return attrs;
}

function parseBorderStyle(
  value: string,
): DocsTableCell['style']['borderTop'] | undefined {
  const parts = value.split(',');
  if (parts.length !== 3) return undefined;
  return {
    width: Number(parts[0]),
    style: parts[1] as 'solid' | 'none',
    color: parts[2],
  };
}

function parseCellStyle(attrs: Record<string, string>): DocsTableCell['style'] {
  const style: DocsTableCell['style'] = {};
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

// ---------------------------------------------------------------------------
// Document → ElementNode
// ---------------------------------------------------------------------------

function buildInlineNode(inline: DocsInline): ElementNode {
  const children: TreeNode[] =
    inline.text.length > 0 ? [{ type: 'text', value: inline.text }] : [];
  return {
    type: 'inline',
    attributes: serializeInlineStyle(inline.style),
    children,
  };
}

function buildBlockNode(block: DocsBlock): ElementNode {
  if (block.type === 'table' && block.tableData) {
    const tableAttrs: Record<string, string> = {
      id: block.id,
      type: 'table',
      cols: block.tableData.columnWidths.join(','),
      ...serializeBlockStyle(block.style),
    };
    if (block.tableData.rowHeights && block.tableData.rowHeights.length > 0) {
      tableAttrs.rowHeights = block.tableData.rowHeights
        .map((h) => h ?? '')
        .join(',');
    }
    return {
      type: 'block',
      attributes: tableAttrs,
      children: block.tableData.rows.map(buildRowNode),
    };
  }

  const attrs: Record<string, string> = {
    id: block.id,
    type: block.type,
    ...serializeBlockStyle(block.style),
  };
  if (block.headingLevel !== undefined)
    attrs.headingLevel = String(block.headingLevel);
  if (block.listKind !== undefined) attrs.listKind = block.listKind;
  if (block.listLevel !== undefined) attrs.listLevel = String(block.listLevel);
  return {
    type: 'block',
    attributes: attrs,
    children: block.inlines.map(buildInlineNode),
  };
}

function buildCellNode(cell: DocsTableCell): ElementNode {
  return {
    type: 'cell',
    attributes: serializeCellStyle(cell),
    children: cell.blocks.map(buildBlockNode),
  };
}

function buildRowNode(row: DocsTableRow): ElementNode {
  return {
    type: 'row',
    attributes: {},
    children: row.cells.map(buildCellNode),
  };
}

function buildTreeChildren(document: DocsDocument): ElementNode[] {
  const children: ElementNode[] = [];
  if (document.header) {
    children.push({
      type: 'header',
      attributes: { marginFromEdge: String(document.header.marginFromEdge) },
      children: document.header.blocks.map(buildBlockNode),
    });
  }
  for (const block of document.blocks) {
    children.push(buildBlockNode(block));
  }
  if (document.footer) {
    children.push({
      type: 'footer',
      attributes: { marginFromEdge: String(document.footer.marginFromEdge) },
      children: document.footer.blocks.map(buildBlockNode),
    });
  }
  return children;
}

// ---------------------------------------------------------------------------
// ElementNode → Document
// ---------------------------------------------------------------------------

function treeNodeToInline(node: TreeNode): DocsInline {
  if (node.type === 'text') {
    return { text: (node as { value: string }).value, style: {} };
  }
  const el = node as ElementNode;
  const text = (el.children ?? [])
    .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
    .map((c) => c.value)
    .join('');
  return {
    text,
    style: parseInlineStyle(
      el.attributes as Record<string, string> | undefined,
    ),
  };
}

function treeNodeToCell(node: TreeNode): DocsTableCell {
  const el = node as ElementNode;
  const attrs = (el.attributes ?? {}) as Record<string, string>;
  const blocks = (el.children ?? [])
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
              style: parseBlockStyle(undefined),
            },
          ],
    style: parseCellStyle(attrs),
    colSpan: attrs.colSpan ? Number(attrs.colSpan) : undefined,
    rowSpan: attrs.rowSpan ? Number(attrs.rowSpan) : undefined,
  };
}

function treeNodeToRow(node: TreeNode): DocsTableRow {
  const el = node as ElementNode;
  return {
    cells: (el.children ?? [])
      .filter((c) => c.type === 'cell')
      .map(treeNodeToCell),
  };
}

function treeNodeToBlock(node: TreeNode): DocsBlock {
  const el = node as ElementNode;
  const attrs = (el.attributes ?? {}) as Record<string, string>;
  const blockType = (attrs.type as DocsBlock['type']) ?? 'paragraph';

  if (blockType === 'table') {
    const rows = (el.children ?? [])
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
      style: parseBlockStyle(attrs),
      tableData: {
        rows,
        columnWidths: cols,
        ...(rowHeights ? { rowHeights } : {}),
      },
    };
  }

  const inlines = (el.children ?? [])
    .filter((c) => c.type === 'inline')
    .map(treeNodeToInline);
  const block: DocsBlock = {
    id: attrs.id ?? '',
    type: blockType,
    inlines:
      inlines.length > 0
        ? inlines
        : blockType === 'horizontal-rule' || blockType === 'page-break'
          ? []
          : [{ text: '', style: {} }],
    style: parseBlockStyle(attrs),
  };
  if ('headingLevel' in attrs)
    block.headingLevel = Number(
      attrs.headingLevel,
    ) as DocsBlock['headingLevel'];
  if ('listKind' in attrs)
    block.listKind = attrs.listKind as DocsBlock['listKind'];
  if ('listLevel' in attrs) block.listLevel = Number(attrs.listLevel);
  return block;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the Yorkie root for a docs document and return the canonical
 * `Document` JSON shape. Returns `{ blocks: [] }` if `content` is missing
 * (an as-yet-unwritten document).
 */
export function readDocsRoot(root: DocsYorkieRoot): DocsDocument {
  const tree = root.content;
  if (!tree || typeof tree.getRootTreeNode !== 'function') {
    return { blocks: [] };
  }
  const treeRoot = tree.getRootTreeNode() as ElementNode;
  const doc: DocsDocument = { blocks: [] };
  for (const child of treeRoot.children ?? []) {
    if (child.type === 'header') {
      const header = child as ElementNode;
      const attrs = (header.attributes ?? {}) as Record<string, string>;
      doc.header = {
        blocks: (header.children ?? []).map(treeNodeToBlock),
        marginFromEdge: attrs.marginFromEdge
          ? Number(attrs.marginFromEdge)
          : DEFAULT_HEADER_MARGIN_FROM_EDGE,
      };
    } else if (child.type === 'footer') {
      const footer = child as ElementNode;
      const attrs = (footer.attributes ?? {}) as Record<string, string>;
      doc.footer = {
        blocks: (footer.children ?? []).map(treeNodeToBlock),
        marginFromEdge: attrs.marginFromEdge
          ? Number(attrs.marginFromEdge)
          : DEFAULT_HEADER_MARGIN_FROM_EDGE,
      };
    } else if (child.type === 'block') {
      doc.blocks.push(treeNodeToBlock(child));
    }
  }
  if (root.pageSetup) {
    doc.pageSetup = readPageSetup(root.pageSetup);
  }
  return doc;
}

/**
 * Read `PageSetup` from a Yorkie root proxy by accessing properties directly.
 *
 * Yorkie object proxies double-encode when serialized via JSON.stringify or
 * spread (`{...proxy}`), so we cannot use `{ ...root.pageSetup.paperSize }` —
 * the resulting object retains proxy wrappers and round-trips back as
 * malformed data when written to a live (attached) document. Mirrors the
 * frontend's `readPageSetup` helper in
 * `packages/frontend/src/app/docs/yorkie-doc-store.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Yorkie proxy is untyped
function readPageSetup(proxy: any): DocsPageSetup {
  const ps = proxy.paperSize;
  const m = proxy.margins;
  return {
    paperSize: {
      name: ps?.name,
      width: Number(ps?.width),
      height: Number(ps?.height),
    },
    orientation: proxy.orientation ?? 'portrait',
    margins: {
      top: Number(m?.top),
      bottom: Number(m?.bottom),
      left: Number(m?.left),
      right: Number(m?.right),
    },
  };
}

/**
 * Replace the entire `content` Tree on the Yorkie root with the given
 * `Document`. Caller must invoke this inside a `doc.update(root => …)` block.
 *
 * If `content` is missing it is created via `new Tree(...)`. Otherwise all
 * existing children are removed via `editByPath` and replaced via
 * `editBulkByPath`. Mirrors `writeFullDocument` in
 * `packages/frontend/src/app/docs/yorkie-doc-store.ts` — see file header for
 * limitations.
 */
export function writeDocsRoot(
  root: DocsYorkieRoot,
  document: DocsDocument,
): void {
  const tree = root.content;
  const children = buildTreeChildren(document);

  if (!tree || typeof tree.getRootTreeNode !== 'function') {
    root.content = new Tree({
      type: 'doc',
      children,
    });
  } else {
    const treeRoot = tree.getRootTreeNode() as ElementNode;
    const childCount = (treeRoot.children ?? []).length;
    if (childCount > 0) {
      tree.editByPath([0], [childCount]);
    }
    if (children.length > 0) {
      tree.editBulkByPath([0], [0], children);
    }
  }

  if (document.pageSetup) {
    root.pageSetup = {
      paperSize: { ...document.pageSetup.paperSize },
      orientation: document.pageSetup.orientation,
      margins: { ...document.pageSetup.margins },
    };
  }
}
