import { Doc } from '../model/document.js';
import type { InlineStyle, BlockStyle } from '../model/types.js';
import { MemDocStore } from '../store/memory.js';
import type { DocStore } from '../store/store.js';
import { DocCanvas } from './doc-canvas.js';
import { Cursor } from './cursor.js';
import { Selection } from './selection.js';
import { TextEditor } from './text-editor.js';
import { computeLayout, type DocumentLayout } from './layout.js';

/**
 * Public API returned by initialize().
 */
export interface EditorAPI {
  /** Force a re-render */
  render(): void;
  /** Get the underlying Doc model */
  getDoc(): Doc;
  /** Get the store */
  getStore(): DocStore;
  /** Apply inline style to current selection */
  applyStyle(style: Partial<InlineStyle>): void;
  /** Apply block style to the block containing the cursor */
  applyBlockStyle(style: Partial<BlockStyle>): void;
  /** Undo */
  undo(): void;
  /** Redo */
  redo(): void;
  /** Focus the editor */
  focus(): void;
  /** Clean up */
  dispose(): void;
}

/**
 * Initialize the document editor.
 *
 * @param container - The DOM element to mount the editor in
 * @param store - Optional DocStore (defaults to MemDocStore)
 */
export function initialize(
  container: HTMLElement,
  store?: DocStore,
): EditorAPI {
  const docStore = store ?? new MemDocStore();

  // Ensure the store has at least one block
  let storeDoc = docStore.getDocument();
  if (storeDoc.blocks.length === 0) {
    const doc = Doc.create();
    docStore.setDocument(doc.document);
    storeDoc = docStore.getDocument();
  }

  const doc = new Doc(storeDoc);

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  container.style.position = 'relative';
  container.appendChild(canvas);

  const docCanvas = new DocCanvas(canvas);
  const cursor = new Cursor(doc.document.blocks[0].id);
  const selection = new Selection();
  let layout: DocumentLayout = { blocks: [], totalHeight: 0 };

  // Compute layout helper
  const recomputeLayout = () => {
    layout = computeLayout(
      doc.document.blocks,
      docCanvas.getContext(),
      canvas.width / (window.devicePixelRatio || 1),
    );
  };

  // Render helper
  const render = () => {
    const { width, height } = container.getBoundingClientRect();
    docCanvas.resize(width, height);
    recomputeLayout();

    const cursorPixel = cursor.getPixelPosition(layout, docCanvas.getContext());
    const selectionRects = selection.getSelectionRects(
      layout,
      docCanvas.getContext(),
    );

    docCanvas.render(layout, 0, cursorPixel ?? undefined, selectionRects);
  };

  // Wire up text editor
  const undoFn = () => {
    if (docStore.canUndo()) {
      docStore.undo();
      doc.document = docStore.getDocument();
      if (doc.document.blocks.length > 0) {
        cursor.moveTo({ blockId: doc.document.blocks[0].id, offset: 0 });
      }
      render();
    }
  };
  const redoFn = () => {
    if (docStore.canRedo()) {
      docStore.redo();
      doc.document = docStore.getDocument();
      if (doc.document.blocks.length > 0) {
        cursor.moveTo({ blockId: doc.document.blocks[0].id, offset: 0 });
      }
      render();
    }
  };

  const textEditor = new TextEditor(
    container,
    doc,
    cursor,
    selection,
    () => layout,
    () => docCanvas.getContext(),
    render,
    () => docStore.snapshot(),
    undoFn,
    redoFn,
  );

  // Start cursor blink
  cursor.startBlink(render);

  // Initial render
  render();

  // Resize observer
  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(container);

  // Focus
  textEditor.focus();

  return {
    render,
    getDoc: () => doc,
    getStore: () => docStore,
    applyStyle: (style: Partial<InlineStyle>) => {
      if (selection.hasSelection() && selection.range) {
        docStore.snapshot();
        doc.applyInlineStyle(selection.range, style);
        render();
      }
    },
    applyBlockStyle: (style: Partial<BlockStyle>) => {
      docStore.snapshot();
      doc.applyBlockStyle(cursor.position.blockId, style);
      render();
    },
    undo: undoFn,
    redo: redoFn,
    focus: () => textEditor.focus(),
    dispose: () => {
      cursor.dispose();
      textEditor.dispose();
      resizeObserver.disconnect();
      canvas.remove();
    },
  };
}
