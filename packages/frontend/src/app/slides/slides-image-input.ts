import type { SlidesEditor, SlidesStore } from '@wafflebase/slides';
import { toast } from 'sonner';
import { insertImageOnSlide } from './insert-image';

/** Subset of `DataTransfer` we read — lets tests pass plain objects. */
interface TransferLike {
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }>;
  files?: ArrayLike<File>;
}

/**
 * True when the transfer looks like it carries an image file. Checks
 * only `item.kind` / `item.type` (and `files` types) — deliberately NOT
 * `getAsFile()`, which returns null during `dragover` (the browser
 * withholds file contents until `drop`). This is the `dragover` gate;
 * if it called `getAsFile()` it would always be false mid-drag, the
 * handler would never `preventDefault()`, and `drop` would never fire.
 */
export function hasImageFile(dt: TransferLike | null): boolean {
  if (!dt) return false;
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) return true;
    }
  }
  if (dt.files) {
    for (const file of Array.from(dt.files)) {
      if (file.type.startsWith('image/')) return true;
    }
  }
  return false;
}

/**
 * First image file in a drag or clipboard transfer, or null. Reads
 * `item.getAsFile()` / `files`, which are only populated at `drop` /
 * `paste` time — call this from the drop / paste handler, not from
 * `dragover` (use `hasImageFile` there).
 */
export function pickImageFile(dt: TransferLike | null): File | null {
  if (!dt) return null;
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  if (dt.files) {
    for (const file of Array.from(dt.files)) {
      if (file.type.startsWith('image/')) return file;
    }
  }
  return null;
}

export interface SlidesImagePathDeps {
  /** Canvas wrapper — host for drag-and-drop (drop fires on the element under the cursor). */
  canvasWrap: HTMLElement;
  editor: Pick<SlidesEditor, 'getEditingElementId' | 'getCurrentSlideId'>;
  store: SlidesStore;
  upload: (file: File) => Promise<{ url: string; w: number; h: number }>;
}

/**
 * Install drag-and-drop + clipboard-paste image input on the slides
 * canvas. Returns a cleanup function that removes every listener.
 *
 * Two hosts, deliberately:
 *   - `drop` / `dragover` on `canvasWrap` — drop events dispatch to the
 *     element under the cursor, so scoping them to the canvas is both
 *     correct and avoids hijacking drops elsewhere on the page.
 *   - `paste` on `document` — mirrors the editor's keyboard model
 *     (`document`-level keydown). When no text box is focused the paste
 *     target is `document.body`, which a canvas-scoped listener would
 *     never see, so the listener must live on the document.
 *
 * Both paths are gated on the editor NOT being in text-edit mode — when
 * the user is typing inside a text box the docs editor's own listeners
 * own paste / drop. The paste path additionally bails when focus sits in
 * an unrelated editable (e.g. the document-title field) so it never
 * steals a paste meant for that input.
 */
export function setupSlidesImagePaths(deps: SlidesImagePathDeps): () => void {
  const { canvasWrap, editor, store, upload } = deps;

  const insert = (slideId: string, file: File) => {
    void insertImageOnSlide({ store, slideId, file, upload }).catch((err) => {
      console.error('Failed to insert image', err);
      toast.error('Failed to insert image');
    });
  };

  // NOTE: drag-drop is deliberately NOT gated on text-edit mode. The
  // slides text box installs no drop handler, so bailing while editing
  // would leave a bare-canvas drop to the browser default — which
  // navigates the tab to the file:// URL and unmounts the editor (data
  // loss). Dropping an image always inserts a new element on the slide,
  // matching Google Slides. We still `preventDefault` for any image drag
  // so the browser never takes over.
  const onDragOver = (e: DragEvent) => {
    if (!hasImageFile(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (e: DragEvent) => {
    const file = pickImageFile(e.dataTransfer);
    if (!file) return;
    // Consume the drop regardless so the browser never navigates to the
    // file, even if there's transiently no slide to insert into.
    e.preventDefault();
    const slideId = editor.getCurrentSlideId();
    if (!slideId) return;
    insert(slideId, file);
  };

  const onPaste = (e: ClipboardEvent) => {
    // A focused text box / dialog / unrelated input owns the paste.
    if (editor.getEditingElementId() !== null) return;
    if (isPasteOwnedElsewhere()) return;
    const file = pickImageFile(e.clipboardData);
    if (!file) return;
    const slideId = editor.getCurrentSlideId();
    if (!slideId) return;
    e.preventDefault();
    insert(slideId, file);
  };

  const docHost = canvasWrap.ownerDocument ?? document;
  // dragenter + dragover both preventDefault so the browser accepts the
  // drop (without it the drop never fires and the file opens in the tab).
  canvasWrap.addEventListener('dragenter', onDragOver);
  canvasWrap.addEventListener('dragover', onDragOver);
  canvasWrap.addEventListener('drop', onDrop);
  docHost.addEventListener('paste', onPaste);

  return () => {
    canvasWrap.removeEventListener('dragenter', onDragOver);
    canvasWrap.removeEventListener('dragover', onDragOver);
    canvasWrap.removeEventListener('drop', onDrop);
    docHost.removeEventListener('paste', onPaste);
  };
}

/**
 * True when something other than the bare slides canvas owns the paste:
 * a focused editable (input / textarea / contenteditable — e.g. the
 * document-title field or speaker-notes), OR an open modal dialog
 * (shortcuts help, share, comments). In those cases the document-level
 * listener must not steal the paste and drop a stray image onto the
 * slide hidden behind the dialog. The slides text box itself runs
 * through the editor's `getEditingElementId` gate, not this check.
 */
function isPasteOwnedElsewhere(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return true;
  return el.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')
    !== null;
}
