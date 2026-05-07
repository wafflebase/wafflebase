import type { Document as YorkieDocument } from '@yorkie-js/sdk';
import yorkie, { type ElementNode, type TreeNode } from '@yorkie-js/sdk';
import {
  type Background,
  type ElementInit,
  type Frame,
  type Layout,
  type SlidesDocument,
  type SlidesStore,
  BUILT_IN_LAYOUTS,
  generateId,
  getLayout,
} from '@wafflebase/slides';
import type { Block, InlineStyle, BlockStyle } from '@wafflebase/docs';
import type { SlidesPresence } from '@/types/users';
import type {
  YorkieElement,
  YorkieSlide,
  YorkieSlidesRoot,
  YorkiePlaceholder,
} from '@/types/slides-document';

const { Tree } = yorkie;

const DEFAULT_BACKGROUND = { fill: '#ffffff' };

type YorkieLayout = YorkieSlidesRoot['layouts'][number];

/**
 * Plain-value deep clone via JSON. Use for snapshot values, init payloads,
 * and any other plain-JS objects. Do NOT pass a Yorkie proxy directly: its
 * `toJSON()` returns a string, which causes JSON.stringify to double-encode.
 * Use `yorkieToPlain` for Yorkie proxies instead.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Convert a Yorkie object/array proxy to a plain JS value. Yorkie proxies
 * implement `toJSON()` that returns a JSON string (not a plain object), so
 * we parse it back. Returns the input unchanged when it doesn't have the
 * Yorkie `toJSON` shape (e.g. plain primitives).
 */
function yorkieToPlain<T>(value: unknown): T {
  if (value && typeof value === 'object') {
    const maybeJson = (value as { toJSON?: () => string }).toJSON;
    if (typeof maybeJson === 'function') {
      const str = maybeJson.call(value);
      if (typeof str === 'string') {
        return JSON.parse(str) as T;
      }
    }
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Tree <-> Block[] serialization
//
// Slides v1 only stores paragraph blocks with inline text (no tables, lists,
// headings, headers/footers). Mirrors the docs serializer in shape so the
// per-attribute conventions match — strings for everything, booleans as
// "true"/"false", numbers via String()/Number().
// ---------------------------------------------------------------------------

function setIfDefined(attrs: Record<string, string>, key: string, value: unknown): void {
  if (value !== undefined) attrs[key] = String(value);
}

function serializeInlineStyle(style: InlineStyle): Record<string, string> {
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
  if (style.backgroundColor !== undefined) attrs.backgroundColor = style.backgroundColor;
  if (style.href !== undefined) attrs.href = style.href;
  return attrs;
}

function parseInlineStyle(attrs: Record<string, string> | undefined): InlineStyle {
  if (!attrs) return {};
  const style: InlineStyle = {};
  if ('bold' in attrs) style.bold = attrs.bold === 'true';
  if ('italic' in attrs) style.italic = attrs.italic === 'true';
  if ('underline' in attrs) style.underline = attrs.underline === 'true';
  if ('strikethrough' in attrs) style.strikethrough = attrs.strikethrough === 'true';
  if ('superscript' in attrs) style.superscript = attrs.superscript === 'true';
  if ('subscript' in attrs) style.subscript = attrs.subscript === 'true';
  if ('fontSize' in attrs) style.fontSize = Number(attrs.fontSize);
  if ('fontFamily' in attrs) style.fontFamily = attrs.fontFamily;
  if ('color' in attrs) style.color = attrs.color;
  if ('backgroundColor' in attrs) style.backgroundColor = attrs.backgroundColor;
  if ('href' in attrs) style.href = attrs.href;
  return style;
}

function serializeBlockStyle(style: BlockStyle | undefined): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!style) return attrs;
  if (style.alignment !== undefined) attrs.alignment = String(style.alignment);
  if (style.lineHeight !== undefined) attrs.lineHeight = String(style.lineHeight);
  if (style.marginTop !== undefined) attrs.marginTop = String(style.marginTop);
  if (style.marginBottom !== undefined) attrs.marginBottom = String(style.marginBottom);
  if (style.textIndent !== undefined) attrs.textIndent = String(style.textIndent);
  if (style.marginLeft !== undefined) attrs.marginLeft = String(style.marginLeft);
  return attrs;
}

function parseBlockStyle(attrs: Record<string, string> | undefined): BlockStyle {
  const style: BlockStyle = {} as BlockStyle;
  if (!attrs) return style;
  if ('alignment' in attrs) (style as Record<string, unknown>).alignment = attrs.alignment;
  if ('lineHeight' in attrs) (style as Record<string, unknown>).lineHeight = Number(attrs.lineHeight);
  if ('marginTop' in attrs) (style as Record<string, unknown>).marginTop = Number(attrs.marginTop);
  if ('marginBottom' in attrs) (style as Record<string, unknown>).marginBottom = Number(attrs.marginBottom);
  if ('textIndent' in attrs) (style as Record<string, unknown>).textIndent = Number(attrs.textIndent);
  if ('marginLeft' in attrs) (style as Record<string, unknown>).marginLeft = Number(attrs.marginLeft);
  return style;
}

function buildInlineNode(inline: { text: string; style: InlineStyle }): ElementNode {
  const children: TreeNode[] =
    inline.text.length > 0
      ? [{ type: 'text' as const, value: inline.text }]
      : [];
  return {
    type: 'inline',
    attributes: serializeInlineStyle(inline.style),
    children,
  };
}

function buildBlockNode(block: Block): ElementNode {
  const attrs: Record<string, string> = {
    id: block.id,
    type: block.type,
    ...serializeBlockStyle(block.style),
  };
  return {
    type: 'block',
    attributes: attrs,
    children: (block.inlines ?? []).map(buildInlineNode),
  };
}

function emptyParagraphNode(): ElementNode {
  return {
    type: 'block',
    attributes: { id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type: 'paragraph' },
    children: [{ type: 'inline', attributes: {}, children: [] }],
  };
}

/**
 * Build the root Tree node for a fresh text body / notes Tree. Yorkie.Tree
 * needs at least one block child, otherwise the editor sees an empty layout
 * with no anchor for the cursor. The single empty paragraph mirrors the docs
 * `ensureTree` initial shape.
 */
function emptyTreeRootNode(): ElementNode {
  return { type: 'doc', children: [emptyParagraphNode()] };
}

function blocksToTreeRootNode(blocks: Block[]): ElementNode {
  const children = blocks.length > 0
    ? blocks.map(buildBlockNode)
    : [emptyParagraphNode()];
  return { type: 'doc', children };
}

function treeNodeToBlock(node: TreeNode): Block {
  const el = node as ElementNode;
  const attrs = (el.attributes ?? {}) as Record<string, string>;
  const inlines = (el.children ?? [])
    .filter((c) => c.type === 'inline')
    .map((c) => {
      const inEl = c as ElementNode;
      const text = (inEl.children ?? [])
        .filter((cc): cc is { type: 'text'; value: string } => cc.type === 'text')
        .map((cc) => cc.value)
        .join('');
      return {
        text,
        style: parseInlineStyle(inEl.attributes as Record<string, string> | undefined),
      };
    });
  return {
    id: attrs.id ?? '',
    type: (attrs.type as Block['type']) ?? 'paragraph',
    inlines: inlines.length > 0 ? inlines : [{ text: '', style: {} }],
    style: parseBlockStyle(attrs),
  };
}

/**
 * True iff `blocks` is a "trivially empty" body: exactly one paragraph with
 * no text content. The empty Tree initial shape (a single empty paragraph)
 * round-trips through `treeNodeToBlock` to this form. We collapse it back
 * to `[]` in `treeToBlocks` so the snapshot returned by `read()` matches the
 * MemSlidesStore baseline (which also represents an empty body as `[]`).
 *
 * `withTextElement` / `withNotes` consumers handle empty input by re-seeding
 * a fresh paragraph (`initializeTextBox` does this already), so this collapse
 * is safe.
 */
function isTriviallyEmpty(blocks: Block[]): boolean {
  if (blocks.length !== 1) return false;
  const b = blocks[0];
  if (b.type !== 'paragraph') return false;
  if (b.inlines.length === 0) return true;
  if (b.inlines.length === 1 && b.inlines[0].text === '') return true;
  return false;
}

/**
 * Read a Yorkie.Tree (or Tree-like proxy) and return its blocks as plain
 * Block[]. Tolerant of (a) a Tree CRDT with `getRootTreeNode`, (b) a stale
 * value that's still plain `{ blocks: Block[] }` JSON (used as a transitional
 * read fallback), (c) `undefined` (return `[]`).
 */
function treeToBlocks(treeOrLegacy: unknown): Block[] {
  if (treeOrLegacy == null) return [];
  // Tree CRDT: walk via getRootTreeNode().
  const tree = treeOrLegacy as { getRootTreeNode?: () => TreeNode };
  if (typeof tree.getRootTreeNode === 'function') {
    const root = tree.getRootTreeNode() as ElementNode;
    const blocks = (root.children ?? [])
      .filter((c) => c.type === 'block')
      .map(treeNodeToBlock);
    return isTriviallyEmpty(blocks) ? [] : blocks;
  }
  // Legacy plain { blocks: [...] } shape — defensive read for stale docs.
  const legacy = yorkieToPlain<{ blocks?: Block[] }>(treeOrLegacy);
  if (legacy && Array.isArray(legacy.blocks)) {
    return isTriviallyEmpty(legacy.blocks) ? [] : legacy.blocks;
  }
  return [];
}

/**
 * Replace the contents of a Tree with the given Block[]. Used to "commit"
 * a Block[] snapshot from the in-memory text editor back to the CRDT.
 *
 * Phase 5a-1 trade-off: we delete + re-insert all blocks instead of computing
 * a structural diff. This means concurrent edits will resolve as last-write-
 * wins on the WHOLE BODY when two peers commit at roughly the same time. A
 * follow-up (Phase 5a-2) can replace this with per-keystroke Tree mutations
 * for true character-level convergence.
 */
function replaceTreeContents(tree: { getRootTreeNode: () => TreeNode; editByPath: (s: number[], e: number[], ...n: ElementNode[]) => void }, blocks: Block[]): void {
  const root = tree.getRootTreeNode() as ElementNode;
  const childCount = (root.children ?? []).length;
  if (childCount > 0) {
    tree.editByPath([0], [childCount]);
  }
  const newChildren = blocks.length > 0
    ? blocks.map(buildBlockNode)
    : [emptyParagraphNode()];
  // Insert one block at a time. editByPath is a varargs API; the Yorkie
  // SDK has editBulkByPath but its spread semantics are inconsistent
  // with how `Tree.edit(...)` is called elsewhere in this codebase, so
  // sticking to the proven per-block insert path matches what
  // YorkieDocStore in the docs package does for the same shape change.
  for (let i = 0; i < newChildren.length; i++) {
    tree.editByPath([i], [i], newChildren[i]);
  }
}

// ---------------------------------------------------------------------------
// ensureSlidesRoot — initialise the Yorkie root with the slides shape and
// materialise Trees for every slide's notes + every text element body. Safe
// to call on every mount.
// ---------------------------------------------------------------------------

/**
 * Idempotently initialise the Yorkie root with the slides shape.
 * Safe to call on every mount; existing slides/layouts are preserved.
 *
 * Walks any pre-existing slides and ensures their `notes` field is a
 * Yorkie.Tree (and likewise each text element's `data.tree`). Documents
 * that landed before Phase 5a stored these fields as plain `Block[]` JSON;
 * those legacy fields are dropped — text content cannot survive the wire
 * format break and the user is expected to recreate the document.
 */
export function ensureSlidesRoot(
  doc: YorkieDocument<YorkieSlidesRoot>,
): void {
  const root = doc.getRoot();
  const needsRoot = root.meta == null || root.slides == null || root.layouts == null;
  if (needsRoot) {
    doc.update((r) => {
      if (r.meta == null) r.meta = { title: 'Untitled presentation' };
      if (r.slides == null) r.slides = [];
      if (r.layouts == null) {
        r.layouts = clone(BUILT_IN_LAYOUTS) as YorkieLayout[];
      }
    });
  }
  // Materialise Trees for every existing slide. Trees MUST be created via
  // `new Tree(...)` inside `doc.update` — they cannot be passed as JSON.
  doc.update((r) => {
    for (const slide of r.slides) {
      // Notes: ensure Tree.
      const notes = slide.notes as unknown;
      if (!notes || typeof (notes as { getRootTreeNode?: () => unknown }).getRootTreeNode !== 'function') {
        slide.notes = new Tree(emptyTreeRootNode()) as unknown as YorkieSlide['notes'];
      }
      // Each text element: ensure data.tree.
      for (const el of slide.elements) {
        if (el.type === 'text') {
          const data = el.data as { tree?: unknown; blocks?: Block[] };
          if (!data.tree || typeof (data.tree as { getRootTreeNode?: () => unknown }).getRootTreeNode !== 'function') {
            // Drop any legacy `blocks` field by reassigning a fresh data
            // object containing only `tree`. Yorkie objects accept the
            // assignment as a replacement of the proxy's contents.
            el.data = { tree: new Tree(emptyTreeRootNode()) } as unknown as typeof el.data;
          }
        }
      }
    }
  });
}

/**
 * Yorkie-backed `SlidesStore`. Wraps every mutation in `doc.update`
 * and snapshots the root before each top-level batch for local undo.
 *
 * Multi-user undo subtleties — where a remote change between batch
 * and undo would have the undo overwrite that remote change — are
 * deliberately ignored in Phase 4a; the behaviour matches MemSlidesStore.
 */
export class YorkieSlidesStore implements SlidesStore {
  /**
   * @deprecated Use `onChange` instead. Kept for one release for any
   * older callers; will be removed once Phase 5 lands.
   */
  onRemoteChange?: () => void;

  private doc: YorkieDocument<YorkieSlidesRoot>;
  private undoStack: SlidesDocument[] = [];
  private redoStack: SlidesDocument[] = [];
  private batchDepth = 0;
  private changeListeners = new Set<() => void>();

  constructor(doc: YorkieDocument<YorkieSlidesRoot>) {
    this.doc = doc;
    doc.subscribe((e) => {
      if (e.type === 'remote-change') {
        this.onRemoteChange?.();
        this.notifyChange();
      }
    });
  }

  /**
   * Subscribe to ANY change to the document — local batch commits OR
   * remote changes pushed in by another peer. Unlike `onRemoteChange`,
   * fires for local mutations too, so consumers like the React wrapper
   * can refresh thumbnails after a drag/resize/rotate commit without
   * polling.
   */
  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => { this.changeListeners.delete(cb); };
  }

  private notifyChange(): void {
    for (const cb of this.changeListeners) {
      try { cb(); } catch { /* swallow listener errors */ }
    }
  }

  // --- read ---

  read(): SlidesDocument {
    const root = this.doc.getRoot();
    const meta = yorkieToPlain<{ title: string }>(root.meta) ?? {
      title: 'Untitled presentation',
    };
    const slides = (root.slides ?? []).map((s) => {
      // Read non-text fields via plain JSON conversion. Notes and text
      // element bodies must be flattened from their Tree CRDTs.
      const id = (s as { id: string }).id;
      const layoutId = (s as { layoutId: string }).layoutId;
      const background = yorkieToPlain<SlidesDocument['slides'][number]['background']>((s as { background: unknown }).background);
      const elements = ((s as { elements: unknown[] }).elements ?? []).map((e) => {
        const el = e as { id: string; type: string; frame: unknown; data: unknown };
        if (el.type === 'text') {
          const blocks = treeToBlocks((el.data as { tree?: unknown }).tree);
          return {
            id: el.id,
            type: 'text',
            frame: yorkieToPlain<Frame>(el.frame),
            data: { blocks },
          };
        }
        return {
          id: el.id,
          type: el.type,
          frame: yorkieToPlain<Frame>(el.frame),
          data: yorkieToPlain<object>(el.data),
        };
      }) as SlidesDocument['slides'][number]['elements'];
      const notes = treeToBlocks((s as { notes: unknown }).notes);
      return {
        id,
        layoutId,
        background,
        elements,
        notes,
      } as SlidesDocument['slides'][number];
    });
    const layouts = (root.layouts ?? []).map((l) =>
      yorkieToPlain<Layout>(l),
    );
    return {
      meta: { title: meta.title ?? 'Untitled presentation' },
      slides,
      layouts,
    };
  }

  // --- batch + undo ---

  batch(fn: () => void): void {
    if (this.batchDepth === 0) {
      this.undoStack.push(this.read());
      this.redoStack = [];
    }
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) {
        this.notifyChange();
      }
    }
  }

  undo(): void {
    if (!this.canUndo()) return;
    const snapshot = this.undoStack.pop()!;
    this.redoStack.push(this.read());
    this.replaceRoot(snapshot);
    this.notifyChange();
  }

  redo(): void {
    if (!this.canRedo()) return;
    const snapshot = this.redoStack.pop()!;
    this.undoStack.push(this.read());
    this.replaceRoot(snapshot);
    this.notifyChange();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private replaceRoot(snapshot: SlidesDocument): void {
    this.doc.update((r) => {
      r.meta = clone(snapshot.meta);
      // Build new YorkieSlide objects with fresh Trees for notes + text
      // bodies. A Tree CRDT is a singleton — re-using one across slides
      // is unsafe — so each restored slide gets its own.
      const nextSlides: YorkieSlide[] = snapshot.slides.map((s) => ({
        id: s.id,
        layoutId: s.layoutId,
        background: clone(s.background),
        elements: s.elements.map((e) => {
          if (e.type === 'text') {
            return {
              id: e.id,
              type: 'text',
              frame: { ...e.frame },
              data: { tree: new Tree(blocksToTreeRootNode(e.data.blocks)) },
            } as unknown as YorkieElement;
          }
          return clone(e) as YorkieElement;
        }),
        notes: new Tree(blocksToTreeRootNode(s.notes)) as unknown as YorkieSlide['notes'],
      }));
      r.slides.splice(0, r.slides.length, ...(nextSlides as never[]));
      const nextLayouts = clone(snapshot.layouts) as YorkieLayout[];
      r.layouts.splice(0, r.layouts.length, ...(nextLayouts as never[]));
    });
  }

  // --- slide ops ---

  addSlide(layoutId: string, atIndex?: number): string {
    this.requireBatch();
    const layout = getLayout(layoutId);
    const id = generateId();
    this.doc.update((r) => {
      // Build the slide INSIDE doc.update so `new Tree(...)` is legal.
      // Layout placeholders carry plain `Block[]` shapes; we materialise
      // each text placeholder's Tree at slide-creation time.
      const elements: YorkieElement[] = layout.placeholders.map((p) => {
        const placeholder = clone(p) as YorkiePlaceholder;
        const elementId = generateId();
        if (placeholder.type === 'text') {
          const blocks = (placeholder.data as { blocks?: Block[] }).blocks ?? [];
          return {
            id: elementId,
            type: 'text',
            frame: placeholder.frame,
            data: { tree: new Tree(blocksToTreeRootNode(blocks)) },
          } as unknown as YorkieElement;
        }
        return {
          id: elementId,
          type: placeholder.type,
          frame: placeholder.frame,
          data: placeholder.data,
        } as YorkieElement;
      });
      const slide: YorkieSlide = {
        id,
        layoutId: layout.id,
        background: { ...DEFAULT_BACKGROUND },
        elements,
        notes: new Tree(emptyTreeRootNode()) as unknown as YorkieSlide['notes'],
      };
      const insertAt =
        atIndex == null
          ? r.slides.length
          : Math.max(0, Math.min(atIndex, r.slides.length));
      r.slides.splice(insertAt, 0, slide);
    });
    return id;
  }

  duplicateSlide(slideId: string): string {
    this.requireBatch();
    const newId = generateId();
    this.doc.update((r) => {
      const idx = r.slides.findIndex((s) => s.id === slideId);
      if (idx === -1) throw new Error(`Slide not found: ${slideId}`);
      // Snapshot the source via flatten — Tree refs can't be re-used.
      const src = r.slides[idx];
      const sourceBackground = yorkieToPlain<YorkieSlide['background']>((src as { background: unknown }).background);
      const sourceLayoutId = (src as { layoutId: string }).layoutId;
      const sourceElements = ((src as { elements: unknown[] }).elements ?? []).map((e) => {
        const el = e as { type: string; frame: unknown; data: unknown };
        if (el.type === 'text') {
          const blocks = treeToBlocks((el.data as { tree?: unknown }).tree);
          return {
            id: generateId(),
            type: 'text',
            frame: yorkieToPlain<Frame>(el.frame),
            data: { tree: new Tree(blocksToTreeRootNode(blocks)) },
          } as unknown as YorkieElement;
        }
        return {
          id: generateId(),
          type: el.type as 'image' | 'shape',
          frame: yorkieToPlain<Frame>(el.frame),
          data: yorkieToPlain<object>(el.data),
        } as YorkieElement;
      });
      const sourceNotesBlocks = treeToBlocks((src as { notes: unknown }).notes);
      const newSlide: YorkieSlide = {
        id: newId,
        layoutId: sourceLayoutId,
        background: sourceBackground,
        elements: sourceElements,
        notes: new Tree(blocksToTreeRootNode(sourceNotesBlocks)) as unknown as YorkieSlide['notes'],
      };
      r.slides.splice(idx + 1, 0, newSlide);
    });
    return newId;
  }

  removeSlide(slideId: string): void {
    this.requireBatch();
    this.doc.update((r) => {
      const i = r.slides.findIndex((s) => s.id === slideId);
      if (i === -1) throw new Error(`Slide not found: ${slideId}`);
      r.slides.splice(i, 1);
    });
  }

  removeSlides(slideIds: string[]): void {
    this.requireBatch();
    const set = new Set(slideIds);
    this.doc.update((r) => {
      // Splice from the end so indices stay valid as we go.
      for (let i = r.slides.length - 1; i >= 0; i--) {
        if (set.has(r.slides[i].id)) r.slides.splice(i, 1);
      }
    });
  }

  moveSlide(slideId: string, toIndex: number): void {
    this.requireBatch();
    this.doc.update((r) => {
      const from = r.slides.findIndex((s) => s.id === slideId);
      if (from === -1) throw new Error(`Slide not found: ${slideId}`);
      // Move requires reconstructing the slide because the proxy returned
      // by splice can't be re-inserted (and Tree refs can't be re-used).
      const moved = this.rebuildSlide(r.slides[from]);
      r.slides.splice(from, 1);
      const clamped = Math.max(0, Math.min(toIndex, r.slides.length));
      r.slides.splice(clamped, 0, moved);
    });
  }

  moveSlides(slideIds: string[], toIndex: number): void {
    this.requireBatch();
    const set = new Set(slideIds);
    this.doc.update((r) => {
      const moving: YorkieSlide[] = [];
      const remaining: YorkieSlide[] = [];
      for (const s of r.slides) {
        const rebuilt = this.rebuildSlide(s);
        if (set.has(s.id)) moving.push(rebuilt);
        else remaining.push(rebuilt);
      }
      const clamped = Math.max(0, Math.min(toIndex, remaining.length));
      const next = [
        ...remaining.slice(0, clamped),
        ...moving,
        ...remaining.slice(clamped),
      ];
      r.slides.splice(0, r.slides.length, ...(next as never[]));
    });
  }

  /**
   * Read a YorkieSlide proxy and return a fully-detached copy with
   * fresh Trees for notes + text bodies. Used by reorder / move paths
   * where we must remove and re-insert a slide; Yorkie array splices
   * can't safely shuffle proxies, and Tree refs are singletons.
   */
  private rebuildSlide(src: YorkieSlide): YorkieSlide {
    const background = yorkieToPlain<YorkieSlide['background']>((src as { background: unknown }).background);
    const layoutId = (src as { layoutId: string }).layoutId;
    const id = (src as { id: string }).id;
    const elements = ((src as { elements: unknown[] }).elements ?? []).map((e) => {
      const el = e as { id: string; type: string; frame: unknown; data: unknown };
      if (el.type === 'text') {
        const blocks = treeToBlocks((el.data as { tree?: unknown }).tree);
        return {
          id: el.id,
          type: 'text',
          frame: yorkieToPlain<Frame>(el.frame),
          data: { tree: new Tree(blocksToTreeRootNode(blocks)) },
        } as unknown as YorkieElement;
      }
      return {
        id: el.id,
        type: el.type as 'image' | 'shape',
        frame: yorkieToPlain<Frame>(el.frame),
        data: yorkieToPlain<object>(el.data),
      } as YorkieElement;
    });
    const notesBlocks = treeToBlocks((src as { notes: unknown }).notes);
    return {
      id,
      layoutId,
      background,
      elements,
      notes: new Tree(blocksToTreeRootNode(notesBlocks)) as unknown as YorkieSlide['notes'],
    };
  }

  updateSlideBackground(slideId: string, bg: Background): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      s.background = clone(bg);
    });
  }

  applyLayout(slideId: string, layoutId: string): void {
    this.requireBatch();
    const layout = getLayout(layoutId);
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      s.layoutId = layout.id;
      for (const placeholder of layout.placeholders) {
        const matches = s.elements.some(
          (e) =>
            e.type === placeholder.type &&
            e.frame.x === placeholder.frame.x &&
            e.frame.y === placeholder.frame.y,
        );
        if (!matches) {
          const cloned = clone(placeholder) as YorkiePlaceholder;
          if (cloned.type === 'text') {
            const blocks = (cloned.data as { blocks?: Block[] }).blocks ?? [];
            s.elements.push({
              id: generateId(),
              type: 'text',
              frame: cloned.frame,
              data: { tree: new Tree(blocksToTreeRootNode(blocks)) },
            } as unknown as YorkieElement);
          } else {
            s.elements.push({
              id: generateId(),
              type: cloned.type,
              frame: cloned.frame,
              data: cloned.data,
            } as YorkieElement);
          }
        }
      }
    });
  }

  // --- element ops ---

  addElement(slideId: string, init: ElementInit): string {
    this.requireBatch();
    const id = generateId();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      if (init.type === 'text') {
        const blocks = (init.data as { blocks?: Block[] }).blocks ?? [];
        s.elements.push({
          id,
          type: 'text',
          frame: { ...init.frame },
          data: { tree: new Tree(blocksToTreeRootNode(blocks)) },
        } as unknown as YorkieElement);
      } else {
        s.elements.push({ ...clone(init), id } as YorkieElement);
      }
    });
    return id;
  }

  removeElement(slideId: string, elementId: string): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const i = s.elements.findIndex((e) => e.id === elementId);
      if (i === -1) throw new Error(`Element not found: ${elementId}`);
      s.elements.splice(i, 1);
    });
  }

  removeElements(slideId: string, elementIds: string[]): void {
    this.requireBatch();
    const set = new Set(elementIds);
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      for (let i = s.elements.length - 1; i >= 0; i--) {
        if (set.has(s.elements[i].id)) s.elements.splice(i, 1);
      }
    });
  }

  updateElementFrame(
    slideId: string,
    elementId: string,
    frame: Partial<Frame>,
  ): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const e = s.elements.find((e) => e.id === elementId);
      if (!e) throw new Error(`Element not found: ${elementId}`);
      e.frame = { ...e.frame, ...frame };
    });
  }

  updateElementData(slideId: string, elementId: string, patch: object): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const e = s.elements.find((e) => e.id === elementId);
      if (!e) throw new Error(`Element not found: ${elementId}`);
      // Text elements own a Tree-backed body — patches that try to spread
      // a plain `blocks` field would clobber it. Image / shape elements
      // are still plain JSON; a shallow merge is fine.
      if (e.type === 'text') {
        // Patch is allowed to update non-tree fields (currently none); ignore
        // any `blocks` field — text content goes through `withTextElement`.
        const safe = { ...(patch as object) } as Record<string, unknown>;
        delete safe.blocks;
        delete safe.tree;
        if (Object.keys(safe).length === 0) return;
        e.data = { ...(e.data as object), ...clone(safe) } as typeof e.data;
        return;
      }
      e.data = { ...(e.data as object), ...clone(patch) } as typeof e.data;
    });
  }

  reorderElement(slideId: string, elementId: string, toIndex: number): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const from = s.elements.findIndex((e) => e.id === elementId);
      if (from === -1) throw new Error(`Element not found: ${elementId}`);
      // Rebuild the element so its Tree (if any) is fresh — Tree refs
      // can't be re-inserted into a Yorkie array after splice.
      const src = s.elements[from];
      let rebuilt: YorkieElement;
      if (src.type === 'text') {
        const blocks = treeToBlocks((src.data as { tree?: unknown }).tree);
        rebuilt = {
          id: src.id,
          type: 'text',
          frame: yorkieToPlain<Frame>((src as { frame: unknown }).frame),
          data: { tree: new Tree(blocksToTreeRootNode(blocks)) },
        } as unknown as YorkieElement;
      } else {
        rebuilt = {
          id: src.id,
          type: src.type,
          frame: yorkieToPlain<Frame>((src as { frame: unknown }).frame),
          data: yorkieToPlain<object>((src as { data: unknown }).data),
        } as YorkieElement;
      }
      s.elements.splice(from, 1);
      const clamped = Math.max(0, Math.min(toIndex, s.elements.length));
      s.elements.splice(clamped, 0, rebuilt);
    });
  }

  // --- text bridges (Phase 5a-1: Tree storage; commit-time serialise) ---
  //
  // The trees live in the Yorkie root, but the Block[]-callback API is
  // preserved so the existing T4 wiring (text-box-editor → onCommit(blocks))
  // doesn't need to change. On commit the new Block[] is written by
  // replacing the tree's contents — multi-user concurrent edits inside
  // the same body resolve as last-write-wins on commit. Phase 5a-2 can
  // replace this with per-keystroke Tree mutations for true convergence.

  withTextElement(
    slideId: string,
    elementId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const e = s.elements.find((e) => e.id === elementId);
      if (!e) throw new Error(`Element not found: ${elementId}`);
      if (e.type !== 'text') {
        throw new Error(`Element ${elementId} is not a text element`);
      }
      const treeProxy = (e.data as { tree?: unknown }).tree;
      const blocks = treeToBlocks(treeProxy);
      const next = fn(blocks);
      console.info('[slides] withTextElement commit', {
        elementId,
        blocksBefore: blocks.length,
        blocksAfter: next === undefined ? 'no-change' : next.length,
        sample: next === undefined ? null : (next[0]?.inlines?.[0] as { text?: string } | undefined)?.text,
      });
      if (next !== undefined) {
        if (treeProxy && typeof (treeProxy as { getRootTreeNode?: () => unknown }).getRootTreeNode === 'function') {
          replaceTreeContents(treeProxy as Parameters<typeof replaceTreeContents>[0], next);
          // Verify post-write.
          const after = treeToBlocks(treeProxy);
          console.info('[slides] withTextElement post-write blocks=', after.length, 'text=', (after[0]?.inlines?.[0] as { text?: string } | undefined)?.text);
        } else {
          // Tree was missing (legacy doc with the old `blocks` shape) —
          // create a new Tree carrying the committed blocks.
          e.data = { tree: new Tree(blocksToTreeRootNode(next)) } as unknown as typeof e.data;
        }
      }
    });
  }

  withNotes(slideId: string, fn: (blocks: Block[]) => Block[] | void): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const treeProxy = (s as { notes: unknown }).notes;
      const blocks = treeToBlocks(treeProxy);
      const next = fn(blocks);
      if (next !== undefined) {
        if (treeProxy && typeof (treeProxy as { getRootTreeNode?: () => unknown }).getRootTreeNode === 'function') {
          replaceTreeContents(treeProxy as Parameters<typeof replaceTreeContents>[0], next);
        } else {
          s.notes = new Tree(blocksToTreeRootNode(next)) as unknown as YorkieSlide['notes'];
        }
      }
    });
  }

  // --- presence ---

  updatePresence(presence: SlidesPresence): void {
    this.doc.update((_, p) => p.set(presence));
  }

  getPeers(): Array<{ clientID: string; presence: SlidesPresence }> {
    return this.doc.getOthersPresences().map((p) => ({
      clientID: String(p.clientID),
      presence: p.presence as SlidesPresence,
    }));
  }

  // --- internal ---

  private requireBatch(): void {
    if (this.batchDepth === 0) {
      throw new Error('Mutations must be wrapped in batch()');
    }
  }
}
