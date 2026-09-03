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
 * The **read** half is no longer duplicated: `readDocsRoot` delegates the
 * tree walk to `docsTreeToDocument` in `@wafflebase/docs`
 * (`model/crdt-tree.ts`), which the revision-history preview also calls with
 * a parsed snapshot. What remains here is the writer plus `readPageSetup`,
 * which has to walk a Yorkie proxy property by property.
 *
 * If/when the writer's duplication becomes painful too, extract a
 * `writeDocsRoot()` helper into `@wafflebase/docs` that takes a Yorkie `Tree`
 * constructor + a mutable root, and have both the frontend store and this
 * module call it.
 */
import {
  type ElementNode,
  Tree,
  type TreeNode,
} from '@yorkie-js/sdk';
import {
  docsTreeToDocument,
  type DocsTreeNode,
  serializeBlockStyleAttrs,
  serializeMarginFromEdgeAttrs,
} from '@wafflebase/docs';
import type {
  DocsBlock,
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
  /** Named-style overrides registry serialized as JSON (see frontend root). */
  stylesJson?: string;
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
  // Backend persists docs colors as raw hex strings. Theme-bound
  // StoredColor objects (slides) live on the slide-element layer and
  // never reach here; ignore the object form so the Yorkie attribute
  // payload stays a flat Record<string,string>.
  if (typeof style.color === 'string') attrs.color = style.color;
  if (typeof style.backgroundColor === 'string')
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

// Block-level style is encoded by the shared codec in `@wafflebase/docs`
// (`model/crdt-attrs.ts`) rather than a copy here: the editor's
// `YorkieDocStore` writes the same Tree attributes, and a divergence between
// the two encodings would make one writer's output unreadable by the other's
// reader. See that module for the partial-on-the-wire contract (absent fields
// are omitted, non-finite numbers and unknown alignments are dropped).
const serializeBlockStyle = serializeBlockStyleAttrs;

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

// `marginFromEdge` follows the same partial-on-the-wire contract as block
// style, and is encoded by the same shared codec for the same reason.
const serializeMarginFromEdge = serializeMarginFromEdgeAttrs;

function buildTreeChildren(document: DocsDocument): ElementNode[] {
  const children: ElementNode[] = [];
  if (document.header) {
    children.push({
      type: 'header',
      attributes: serializeMarginFromEdge(document.header.marginFromEdge),
      children: document.header.blocks.map(buildBlockNode),
    });
  }
  for (const block of document.blocks) {
    children.push(buildBlockNode(block));
  }
  if (document.footer) {
    children.push({
      type: 'footer',
      attributes: serializeMarginFromEdge(document.footer.marginFromEdge),
      children: document.footer.blocks.map(buildBlockNode),
    });
  }
  return children;
}

// ---------------------------------------------------------------------------

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
  // The walk itself lives in `@wafflebase/docs` (`model/crdt-tree.ts`), so
  // that the revision-history preview — which runs the same walk over a
  // parsed snapshot in the browser — cannot drift from this reader. A live
  // proxy node already matches `DocsTreeNode`: the SDK hands back
  // `attributes` with its values JSON-decoded. A *snapshot* node does not;
  // see that module's header.
  const doc = docsTreeToDocument(tree.getRootTreeNode() as DocsTreeNode, {
    stylesJson: root.stylesJson,
  });
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
export function readPageSetup(proxy: any): DocsPageSetup {
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
 * **Destructive contract:** this is a wipe-and-rewrite, not a merge. All
 * existing tree children are removed before the new content is inserted.
 * Concurrent collaborator edits made between the read and the write may be
 * lost — there is no OT/CRDT-aware diffing here, only a structural replace.
 * The CLI import flow opts into this explicitly via `safety: destructive`;
 * other callers should treat this as a last-write-wins primitive.
 *
 * If `content` is missing it is created via `new Tree(...)`. Otherwise all
 * existing children are removed via `editByPath` and replaced via
 * `editBulkByPath`. Mirrors `writeFullDocument` in
 * `packages/frontend/src/app/docs/yorkie-doc-store.ts` — see file header for
 * additional limitations.
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
  } else if (root.pageSetup !== undefined) {
    // Destructive replace contract: an incoming Document that omits
    // pageSetup must clear any stale value on the root, otherwise the
    // CLI's `--replace` flow leaks page setup from a prior write.
    // The Yorkie root proxy does not implement the `in` operator the way
    // a plain object does (`'pageSetup' in root` returns false even when
    // the key is set), so we check the value directly. header/footer
    // live as Tree children and are already wiped by the
    // editByPath/editBulkByPath replacement above, so they don't need an
    // explicit clear here.
    delete root.pageSetup;
  }

  // Named-style registry — same destructive-replace contract as pageSetup.
  if (document.styles && Object.keys(document.styles).length > 0) {
    root.stylesJson = JSON.stringify(document.styles);
  } else if (root.stylesJson !== undefined) {
    delete root.stylesJson;
  }
}
