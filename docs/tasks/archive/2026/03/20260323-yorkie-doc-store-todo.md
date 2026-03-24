# YorkieDocStore + Frontend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `YorkieDocStore` using `yorkie.Tree` as the backing store, integrate it into the frontend with a new docs editor page, and handle remote changes for real-time collaboration.

**Architecture:** `YorkieDocStore` wraps a Yorkie `Document` whose root contains a `Tree` (for block/inline content) and a JSON `pageSetup` field. All `DocStore` write methods execute inside `doc.update()`, translating `Block`/`Inline` mutations into `tree.editByPath()` / `tree.styleByPath()` calls. A new React page (`DocsDetail`) provides the `DocumentProvider` and mounts the Canvas editor via `initialize(container, yorkieDocStore)`. Remote changes trigger `doc.refresh()` + re-render.

**Tech Stack:** TypeScript, Yorkie SDK (`@yorkie-js/sdk` Tree API), `@yorkie-js/react` (DocumentProvider, useDocument), Vitest

**Spec:** `docs/design/docs-collaboration.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/frontend/src/types/docs-document.ts` | Create | Yorkie document root type for docs (`YorkieDocsRoot`) |
| `packages/frontend/src/app/docs/yorkie-doc-store.ts` | Create | `YorkieDocStore` implementing `DocStore` via Yorkie Tree |
| `packages/frontend/src/app/docs/yorkie-doc-store.test.ts` | Create | Unit tests for YorkieDocStore (Yorkie SDK in-memory) |
| `packages/frontend/src/app/docs/docs-detail.tsx` | Create | React page: DocumentProvider + docs editor mount |
| `packages/frontend/src/app/docs/docs-view.tsx` | Create | React component: useDocument + Canvas editor lifecycle |
| `packages/frontend/src/App.tsx` | Modify | Add `/docs/:id` route |

---

### Task 1: Define Yorkie document root type for docs

**Files:**
- Create: `packages/frontend/src/types/docs-document.ts`

- [x] **Step 1: Create the type file**

```typescript
import type { Tree } from '@yorkie-js/sdk';

/**
 * Yorkie document root for the docs (rich-text) editor.
 *
 * - `content`: yorkie.Tree holding the block/inline structure
 * - `pageSetup`: document-level metadata (paper size, margins)
 */
export type YorkieDocsRoot = {
  content: Tree;
  pageSetup?: {
    paperSize: { name: string; width: number; height: number };
    orientation: 'portrait' | 'landscape';
    margins: { top: number; bottom: number; left: number; right: number };
  };
};
```

- [x] **Step 2: Commit**

```bash
git add packages/frontend/src/types/docs-document.ts
git commit -m "Add Yorkie document root type for docs editor

Defines YorkieDocsRoot with a Tree field for block/inline content
and a JSON pageSetup field for document-level metadata."
```

---

### Task 2: Implement YorkieDocStore

The core implementation. `YorkieDocStore` implements `DocStore` by reading from / writing to a `yorkie.Tree`. The tree structure mirrors the `Document → Block → Inline` hierarchy:

```xml
<doc>
  <block id="..." type="paragraph" alignment="left" lineHeight="1.5" ...>
    <inline bold="true" fontSize="14">Hello </inline>
    <inline italic="true">world</inline>
  </block>
</doc>
```

**Files:**
- Create: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

- [x] **Step 1: Create YorkieDocStore with constructor and tree-to-document conversion**

```typescript
import type { Document as YorkieDocument } from '@yorkie-js/react';
import type {
  DocStore,
  Document,
  Block,
  BlockStyle,
  InlineStyle,
  Inline,
  PageSetup,
} from '@wafflebase/document';
import {
  resolvePageSetup,
  normalizeBlockStyle,
  DEFAULT_BLOCK_STYLE,
} from '@wafflebase/document';
import type { YorkieDocsRoot } from '@/types/docs-document';

/**
 * DocStore implementation backed by Yorkie Tree CRDT.
 *
 * The Tree is the single source of truth. All write methods execute
 * inside doc.update(). Reading converts tree nodes to Document objects.
 */
export class YorkieDocStore implements DocStore {
  private doc: YorkieDocument<YorkieDocsRoot>;
  private cachedDoc: Document | null = null;
  private dirty = true;

  /** Called when remote changes arrive — wired by the editor. */
  onRemoteChange?: () => void;

  constructor(doc: YorkieDocument<YorkieDocsRoot>) {
    this.doc = doc;

    doc.subscribe((e) => {
      if (e.type === 'remote-change') {
        this.dirty = true;
        this.onRemoteChange?.();
      }
    });
  }

  // --- Reading ---

  getDocument(): Document {
    if (!this.dirty && this.cachedDoc) {
      return this.cloneDocument(this.cachedDoc);
    }

    const root = this.doc.getRoot();
    const tree = root.content;
    const treeRoot = tree.getRootTreeNode();

    const blocks: Block[] = [];
    if (treeRoot.children) {
      for (const blockNode of treeRoot.children) {
        if (blockNode.type === 'block') {
          blocks.push(this.treeNodeToBlock(blockNode));
        }
      }
    }

    const pageSetup = root.pageSetup
      ? resolvePageSetup(root.pageSetup as PageSetup)
      : undefined;

    this.cachedDoc = { blocks, pageSetup };
    this.dirty = false;
    return this.cloneDocument(this.cachedDoc);
  }

  getBlock(id: string): Block | undefined {
    const doc = this.getDocument();
    return doc.blocks.find((b) => b.id === id);
  }

  getPageSetup(): PageSetup {
    const root = this.doc.getRoot();
    return resolvePageSetup(root.pageSetup as PageSetup | undefined);
  }

  // --- Writing ---

  setDocument(doc: Document): void {
    this.doc.update((root) => {
      // Replace entire tree content
      const tree = root.content;
      const treeRoot = tree.getRootTreeNode();
      const childCount = treeRoot.children?.length ?? 0;

      // Remove all existing children
      if (childCount > 0) {
        // Path [0, 0] to [0, childCount] covers all children of <doc>
        tree.editByPath([0, 0], [0, childCount]);
      }

      // Insert new blocks
      for (let i = doc.blocks.length - 1; i >= 0; i--) {
        tree.editByPath([0, 0], [0, 0], this.blockToTreeNode(doc.blocks[i]));
      }

      // Update pageSetup
      if (doc.pageSetup) {
        root.pageSetup = JSON.parse(JSON.stringify(doc.pageSetup));
      }
    });
    this.dirty = true;
    this.cachedDoc = null;
  }

  replaceDocument(_doc: Document): void {
    // No-op: Doc writes through store directly, syncToStore is removed.
  }

  updateBlock(id: string, block: Block): void {
    const blockIndex = this.findBlockIndex(id);
    if (blockIndex === -1) throw new Error(`Block not found: ${id}`);

    this.doc.update((root) => {
      const tree = root.content;
      const treeRoot = tree.getRootTreeNode();
      const blockNode = treeRoot.children![blockIndex];
      const inlineCount = blockNode.children?.length ?? 0;

      // Update block attributes
      tree.styleByPath([0, blockIndex], this.blockStyleToAttrs(block));

      // Replace all inline children
      if (inlineCount > 0) {
        tree.editByPath(
          [0, blockIndex, 0],
          [0, blockIndex, inlineCount],
        );
      }
      for (let i = block.inlines.length - 1; i >= 0; i--) {
        tree.editByPath(
          [0, blockIndex, 0],
          [0, blockIndex, 0],
          this.inlineToTreeNode(block.inlines[i]),
        );
      }
    });
    this.dirty = true;
    this.cachedDoc = null;
  }

  insertBlock(index: number, block: Block): void {
    this.doc.update((root) => {
      const tree = root.content;
      tree.editByPath(
        [0, index],
        [0, index],
        this.blockToTreeNode(block),
      );
    });
    this.dirty = true;
    this.cachedDoc = null;
  }

  deleteBlock(id: string): void {
    const blockIndex = this.findBlockIndex(id);
    if (blockIndex === -1) throw new Error(`Block not found: ${id}`);
    this.deleteBlockByIndex(blockIndex);
  }

  deleteBlockByIndex(index: number): void {
    this.doc.update((root) => {
      const tree = root.content;
      tree.editByPath([0, index], [0, index + 1]);
    });
    this.dirty = true;
    this.cachedDoc = null;
  }

  setPageSetup(setup: PageSetup): void {
    this.doc.update((root) => {
      root.pageSetup = JSON.parse(JSON.stringify(setup));
    });
    this.dirty = true;
    this.cachedDoc = null;
  }

  // --- Undo/Redo (Phase 1: local snapshots) ---

  private undoStack: Document[] = [];
  private redoStack: Document[] = [];

  snapshot(): void {
    this.undoStack.push(this.getDocument());
    this.redoStack = [];
  }

  undo(): void {
    if (!this.canUndo()) return;
    this.redoStack.push(this.getDocument());
    const prev = this.undoStack.pop()!;
    this.setDocument(prev);
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.undoStack.push(this.getDocument());
    const next = this.redoStack.pop()!;
    this.setDocument(next);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // --- Private helpers ---

  private findBlockIndex(id: string): number {
    const root = this.doc.getRoot();
    const tree = root.content;
    const treeRoot = tree.getRootTreeNode();
    if (!treeRoot.children) return -1;
    return treeRoot.children.findIndex(
      (n) => n.type === 'block' && n.attributes?.id === id,
    );
  }

  private treeNodeToBlock(node: any): Block {
    const attrs = node.attributes ?? {};
    const style: BlockStyle = normalizeBlockStyle({
      alignment: attrs.alignment ?? 'left',
      lineHeight: attrs.lineHeight != null ? Number(attrs.lineHeight) : undefined,
      marginTop: attrs.marginTop != null ? Number(attrs.marginTop) : undefined,
      marginBottom: attrs.marginBottom != null ? Number(attrs.marginBottom) : undefined,
      textIndent: attrs.textIndent != null ? Number(attrs.textIndent) : undefined,
      marginLeft: attrs.marginLeft != null ? Number(attrs.marginLeft) : undefined,
    });

    const inlines: Inline[] = [];
    if (node.children) {
      for (const child of node.children) {
        if (child.type === 'inline') {
          const inlineAttrs = child.attributes ?? {};
          const inlineStyle: InlineStyle = {};
          if (inlineAttrs.bold === 'true') inlineStyle.bold = true;
          if (inlineAttrs.italic === 'true') inlineStyle.italic = true;
          if (inlineAttrs.underline === 'true') inlineStyle.underline = true;
          if (inlineAttrs.strikethrough === 'true') inlineStyle.strikethrough = true;
          if (inlineAttrs.fontSize != null) inlineStyle.fontSize = Number(inlineAttrs.fontSize);
          if (inlineAttrs.fontFamily != null) inlineStyle.fontFamily = inlineAttrs.fontFamily;
          if (inlineAttrs.color != null) inlineStyle.color = inlineAttrs.color;

          // Collect text from text node children
          let text = '';
          if (child.children) {
            for (const textNode of child.children) {
              if (textNode.type === 'text') {
                text += textNode.value ?? '';
              }
            }
          }
          inlines.push({ text, style: inlineStyle });
        }
      }
    }

    if (inlines.length === 0) {
      inlines.push({ text: '', style: {} });
    }

    return { id: attrs.id ?? '', type: 'paragraph', inlines, style };
  }

  private blockToTreeNode(block: Block): any {
    const children = block.inlines.map((inline) => this.inlineToTreeNode(inline));
    return {
      type: 'block',
      attributes: this.blockStyleToAttrs(block),
      children,
    };
  }

  private blockStyleToAttrs(block: Block): Record<string, string> {
    const s = block.style ?? DEFAULT_BLOCK_STYLE;
    return {
      id: block.id,
      type: block.type,
      alignment: s.alignment ?? 'left',
      lineHeight: String(s.lineHeight ?? 1.5),
      marginTop: String(s.marginTop ?? 0),
      marginBottom: String(s.marginBottom ?? 8),
      textIndent: String(s.textIndent ?? 0),
      marginLeft: String(s.marginLeft ?? 0),
    };
  }

  private inlineToTreeNode(inline: Inline): any {
    const attrs: Record<string, string> = {};
    const s = inline.style;
    if (s.bold) attrs.bold = 'true';
    if (s.italic) attrs.italic = 'true';
    if (s.underline) attrs.underline = 'true';
    if (s.strikethrough) attrs.strikethrough = 'true';
    if (s.fontSize != null) attrs.fontSize = String(s.fontSize);
    if (s.fontFamily != null) attrs.fontFamily = s.fontFamily;
    if (s.color != null) attrs.color = s.color;

    return {
      type: 'inline',
      attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
      children: [{ type: 'text', value: inline.text }],
    };
  }

  private cloneDocument(doc: Document): Document {
    return JSON.parse(JSON.stringify(doc));
  }
}
```

- [x] **Step 2: Run lint check**

Run: `pnpm frontend lint`
Expected: No errors.

- [x] **Step 3: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Implement YorkieDocStore backed by Yorkie Tree CRDT

Translates DocStore interface methods into yorkie.Tree operations.
Tree structure: <doc> → <block> → <inline> → text nodes.
Includes dirty-flag caching, local snapshot undo/redo (Phase 1),
and remote change callback for editor re-render."
```

---

### Task 3: Add unit tests for YorkieDocStore

Test the store against a real Yorkie document in-memory (no server needed). Yorkie SDK supports creating documents locally.

**Files:**
- Create: `packages/frontend/src/app/docs/yorkie-doc-store.test.ts`

- [x] **Step 1: Write tests**

The tests use `yorkie.Document` in-memory without connecting to a server. Create the document, set up the initial tree, then exercise `YorkieDocStore` methods.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import { YorkieDocStore } from './yorkie-doc-store';
import type { Block } from '@wafflebase/document';
import { generateBlockId, DEFAULT_BLOCK_STYLE } from '@wafflebase/document';

function makeBlock(text: string, style?: Partial<Block['style']>): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE, ...style },
  };
}

describe('YorkieDocStore', () => {
  let doc: any;
  let store: YorkieDocStore;

  beforeEach(async () => {
    doc = new yorkie.Document<any>(`test-${Date.now()}`);
    doc.update((root: any) => {
      root.content = new yorkie.Tree({
        type: 'doc',
        children: [],
      });
    });
    store = new YorkieDocStore(doc);
  });

  describe('setDocument and getDocument', () => {
    it('should set and retrieve a document', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      const result = store.getDocument();
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].inlines[0].text).toBe('Hello');
      expect(result.blocks[0].id).toBe(block.id);
    });

    it('should handle empty document', () => {
      store.setDocument({ blocks: [] });
      expect(store.getDocument().blocks).toHaveLength(0);
    });

    it('should preserve block styles', () => {
      const block = makeBlock('Centered', { alignment: 'center', lineHeight: 2.0 });
      store.setDocument({ blocks: [block] });
      const result = store.getDocument();
      expect(result.blocks[0].style.alignment).toBe('center');
      expect(result.blocks[0].style.lineHeight).toBe(2.0);
    });

    it('should preserve inline styles', () => {
      const block: Block = {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: 'Bold', style: { bold: true, fontSize: 14 } },
          { text: ' Normal', style: {} },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      store.setDocument({ blocks: [block] });
      const result = store.getDocument();
      expect(result.blocks[0].inlines).toHaveLength(2);
      expect(result.blocks[0].inlines[0].style.bold).toBe(true);
      expect(result.blocks[0].inlines[0].style.fontSize).toBe(14);
    });
  });

  describe('getBlock', () => {
    it('should find block by ID', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello');
    });

    it('should return undefined for missing block', () => {
      expect(store.getBlock('nonexistent')).toBeUndefined();
    });
  });

  describe('updateBlock', () => {
    it('should update block content', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('World');
    });

    it('should throw for missing block', () => {
      expect(() => store.updateBlock('missing', makeBlock('x'))).toThrow();
    });
  });

  describe('insertBlock', () => {
    it('should insert at the given index', () => {
      const b1 = makeBlock('First');
      store.setDocument({ blocks: [b1] });
      const b2 = makeBlock('Second');
      store.insertBlock(0, b2);
      const doc = store.getDocument();
      expect(doc.blocks).toHaveLength(2);
      expect(doc.blocks[0].inlines[0].text).toBe('Second');
      expect(doc.blocks[1].inlines[0].text).toBe('First');
    });
  });

  describe('deleteBlock', () => {
    it('should delete by ID', () => {
      const b1 = makeBlock('First');
      const b2 = makeBlock('Second');
      store.setDocument({ blocks: [b1, b2] });
      store.deleteBlock(b1.id);
      const doc = store.getDocument();
      expect(doc.blocks).toHaveLength(1);
      expect(doc.blocks[0].id).toBe(b2.id);
    });
  });

  describe('deleteBlockByIndex', () => {
    it('should delete by index', () => {
      const b1 = makeBlock('First');
      const b2 = makeBlock('Second');
      store.setDocument({ blocks: [b1, b2] });
      store.deleteBlockByIndex(0);
      const doc = store.getDocument();
      expect(doc.blocks).toHaveLength(1);
      expect(doc.blocks[0].id).toBe(b2.id);
    });
  });

  describe('pageSetup', () => {
    it('should set and get pageSetup', () => {
      store.setPageSetup({
        paperSize: { name: 'A4', width: 794, height: 1123 },
        orientation: 'portrait',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
      });
      const setup = store.getPageSetup();
      expect(setup.paperSize.name).toBe('A4');
      expect(setup.margins.top).toBe(72);
    });
  });

  describe('undo/redo', () => {
    it('should undo after snapshot', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.snapshot();
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('World');
      store.undo();
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello');
    });

    it('should redo after undo', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.snapshot();
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      store.undo();
      store.redo();
      expect(store.getBlock(block.id)?.inlines[0].text).toBe('World');
    });

    it('mutation without snapshot is not undoable', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
      expect(store.canUndo()).toBe(false);
    });
  });
});
```

- [x] **Step 2: Run tests**

Run: `pnpm frontend test`
Expected: All tests pass. If the Yorkie SDK in-memory document doesn't work in the Node test runner, adjust the test setup (the tests don't need a server — `yorkie.Document` works locally).

- [x] **Step 3: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.test.ts
git commit -m "Add unit tests for YorkieDocStore

Tests cover set/get document, block CRUD, inline style
preservation, pageSetup, and snapshot-based undo/redo.
Uses Yorkie Document in-memory (no server needed)."
```

---

### Task 4: Create DocsDetail page and DocsView component

Follow the same pattern as the spreadsheet's `DocumentDetail` + `SheetView`:
- `DocsDetail` wraps with `DocumentProvider` (Yorkie connection)
- `DocsView` uses `useDocument`, creates `YorkieDocStore`, mounts the Canvas editor

**Files:**
- Create: `packages/frontend/src/app/docs/docs-view.tsx`
- Create: `packages/frontend/src/app/docs/docs-detail.tsx`

- [x] **Step 1: Create DocsView component**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useDocument } from '@yorkie-js/react';
import { initialize, type EditorAPI } from '@wafflebase/document';
import { YorkieDocStore } from './yorkie-doc-store';
import type { YorkieDocsRoot } from '@/types/docs-document';

export function DocsView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [didMount, setDidMount] = useState(false);
  const { doc, loading, error } = useDocument<YorkieDocsRoot>();

  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container || !doc) return;

    const store = new YorkieDocStore(doc);
    let editor: EditorAPI | undefined;
    let cancelled = false;

    // Initialize the docs editor
    editor = initialize(container, store);

    if (cancelled) {
      editor.dispose();
      return;
    }

    // Wire remote changes to re-render
    store.onRemoteChange = () => {
      editor?.getDoc().refresh();
      editor?.render();
    };

    return () => {
      cancelled = true;
      editor?.dispose();
    };
  }, [didMount, doc]);

  if (loading) {
    return <div className="flex h-full items-center justify-center">Loading...</div>;
  }

  if (error) {
    return <div className="flex h-full items-center justify-center text-red-500">Error: {error.message}</div>;
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div
        ref={containerRef}
        className="flex-1 w-full"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
```

- [x] **Step 2: Create DocsDetail page**

```tsx
import { useParams } from 'react-router-dom';
import { DocumentProvider } from '@yorkie-js/react';
import { DocsView } from './docs-view';
import type { YorkieDocsRoot } from '@/types/docs-document';

/**
 * Initial Yorkie document root for a new docs document.
 * The Tree is initialized with a single empty block.
 */
function initialDocsRoot(): YorkieDocsRoot {
  return {
    content: {
      type: 'doc',
      children: [
        {
          type: 'block',
          attributes: {
            id: `block-${Date.now()}-0`,
            type: 'paragraph',
            alignment: 'left',
            lineHeight: '1.5',
            marginTop: '0',
            marginBottom: '8',
            textIndent: '0',
            marginLeft: '0',
          },
          children: [
            {
              type: 'inline',
              children: [{ type: 'text', value: '' }],
            },
          ],
        },
      ],
    } as any,
  };
}

export default function DocsDetail() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return <div>Document ID required</div>;
  }

  return (
    <DocumentProvider<YorkieDocsRoot>
      docKey={`docs-${id}`}
      initialRoot={initialDocsRoot()}
    >
      <DocsView />
    </DocumentProvider>
  );
}
```

- [x] **Step 3: Run lint**

Run: `pnpm frontend lint`
Expected: No errors.

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/docs-view.tsx packages/frontend/src/app/docs/docs-detail.tsx
git commit -m "Add DocsDetail page and DocsView component

DocsDetail wraps with DocumentProvider for Yorkie connection.
DocsView creates YorkieDocStore, mounts Canvas editor via
initialize(), and wires remote changes for re-render."
```

---

### Task 5: Add /docs/:id route to App.tsx

**Files:**
- Modify: `packages/frontend/src/App.tsx`

- [x] **Step 1: Add lazy import and route**

Add the lazy import near the existing ones:

```typescript
const DocsDetail = lazy(() => import("@/app/docs/docs-detail"));
```

Add the route inside the `<PrivateRoute>` section, before `/:id`:

```tsx
<Route path="/docs/:id" element={<DocsDetail />} />
```

- [x] **Step 2: Run lint**

Run: `pnpm frontend lint`
Expected: No errors.

- [x] **Step 3: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "Add /docs/:id route for docs editor

Lazy-loads DocsDetail page for collaborative document editing."
```

---

### Task 6: Verify full integration

- [x] **Step 1: Run verify:fast**

Run: `pnpm verify:fast`
Expected: All tests pass, no lint errors.

- [x] **Step 2: Manual smoke test**

With `docker compose up -d` and `pnpm dev` running:
1. Open `http://localhost:5173/docs/test-doc-1` in two browser tabs
2. Verify the editor loads with an empty paragraph
3. Type text in one tab — it should appear in the other tab
4. Test Enter (split block), Backspace (merge), bold/italic styling
5. Test undo/redo

- [x] **Step 3: Commit any fixes**

If any adjustments are needed after manual testing, commit them.

---

## Design Notes

- **Tree path addressing**: `[0, blockIndex]` addresses the blockIndex-th child of the `<doc>` root. `[0, blockIndex, inlineIndex]` addresses an inline within a block. This matches Yorkie's path-based editing API.
- **Attribute serialization**: All Tree node attributes are strings. Numeric values (lineHeight, fontSize) are serialized with `String()` and parsed back with `Number()`.
- **replaceDocument() is a no-op**: Since Doc writes through the store directly, the old `syncToStore()` pattern is unnecessary.
- **Phase 1 undo limitation**: Local snapshot undo can overwrite concurrent changes. This is a known limitation per the design doc, acceptable until Phase 2 migrates to Yorkie operation-level undo.
- **No presence yet**: Cursor/selection sharing is deferred to follow-up work.
