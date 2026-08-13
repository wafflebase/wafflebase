import {
  StateEffect,
  StateField,
  type EditorState,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { insertImage } from './commands.js';

/**
 * Upload one image file and resolve with the URL to reference it by.
 *
 * Resolving with `null` means "cancelled" — the host handled the failure
 * itself (validation, network, a rejected file type) and reported it to the
 * user. The engine then drops the placeholder silently rather than reporting
 * the same failure twice. A rejected promise is treated the same way, with a
 * console entry, so a host that forgets to catch still cannot leave a
 * placeholder stuck on screen forever.
 */
export type UploadImage = (file: File) => Promise<string | null>;

/**
 * A placeholder shown at the insertion point while an upload is in flight.
 *
 * This is deliberately NOT text in the document. A note's body is one Yorkie
 * `Text` CRDT, so placeholder text would replicate to every peer, land in the
 * undo history, and survive as garbage if the upload fails or the tab closes
 * mid-flight. A widget decoration is view-local: peers never see it, and it
 * cannot outlive the editor.
 */
class UploadingWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly label: string,
  ) {
    super();
  }

  // Identity is the upload, not the label — two concurrent uploads of
  // identically-named files must stay distinct.
  eq(other: UploadingWidget): boolean {
    return other.id === this.id;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-note-upload-ghost';
    el.setAttribute('aria-live', 'polite');
    el.textContent = `Uploading ${this.label}…`;
    return el;
  }
}

const addGhost = StateEffect.define<{ id: number; pos: number; label: string }>();
const removeGhost = StateEffect.define<number>();

/**
 * Whether this transaction throws the whole document away — which is how
 * `noteSync` applies a `replace` remote change (a Yorkie snapshot resync), as
 * one change spanning the entire old document.
 */
function replacesWholeDoc(tr: Transaction): boolean {
  const oldLength = tr.startState.doc.length;
  if (oldLength === 0) return false;
  let whole = false;
  tr.changes.iterChanges((fromA, toA) => {
    if (fromA === 0 && toA === oldLength) whole = true;
  });
  return whole;
}

/**
 * The in-flight placeholders. `set.map(tr.changes)` is what makes the feature
 * correct under collaboration: every transaction — the user's own typing and a
 * peer's remote edit alike — moves the pending insertion point, so an image
 * that finishes uploading 3 seconds later still lands where it was dropped.
 */
const ghostField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(set, tr) {
    // A whole-document replacement is the one change mapping cannot survive:
    // every anchor lives inside the deleted range, so CodeMirror collapses
    // them all to position 0 and the finished image would land at the top of
    // the note. Drop the anchors instead — the insert then falls back to the
    // caret, which is at least where the user is looking.
    set = replacesWholeDoc(tr) ? Decoration.none : set.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(addGhost)) {
        const { id, pos, label } = effect.value;
        set = set.update({
          add: [
            Decoration.widget({
              widget: new UploadingWidget(id, label),
              // side > 0 keeps the ghost after text inserted at the same
              // position, so a second image queued at one spot lands after the
              // first rather than in front of it.
              side: 1,
            }).range(Math.min(pos, tr.state.doc.length)),
          ],
        });
      } else if (effect.is(removeGhost)) {
        const id = effect.value;
        set = set.update({
          filter: (_from, _to, value) =>
            (value.spec.widget as UploadingWidget).id !== id,
        });
      }
    }
    return set;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Number of image uploads currently in flight in this editor. */
export function pendingImageUploads(state: EditorState): number {
  return state.field(ghostField, false)?.size ?? 0;
}

/** Current position of the ghost with `id`, or null once it is gone. */
function ghostPosition(view: EditorView, id: number): number | null {
  let found: number | null = null;
  view.state
    .field(ghostField)
    .between(0, view.state.doc.length, (from, _to, value) => {
      if ((value.spec.widget as UploadingWidget).id === id) {
        found = from;
        return false;
      }
      return undefined;
    });
  return found;
}

/**
 * Views that are still alive. An upload can outlive its editor (navigate away
 * mid-upload), and dispatching into a destroyed view throws.
 */
const liveViews = new WeakSet<EditorView>();
const trackLiveness = ViewPlugin.define((view) => {
  liveViews.add(view);
  return {
    destroy() {
      liveViews.delete(view);
    },
  };
});

let nextGhostId = 1;

/** `photo.png` → `photo`; used as the image's alt text. */
function altFromFilename(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') || 'image';
}

/**
 * Show a placeholder and start the request immediately; return the step that
 * turns the finished upload into text. Separating the two is what lets a batch
 * upload concurrently but insert in order.
 */
function beginUpload(
  view: EditorView,
  file: File,
  pos: number,
  upload: UploadImage,
): () => Promise<void> {
  const id = nextGhostId++;
  view.dispatch({
    effects: addGhost.of({ id, pos, label: file.name || 'image' }),
  });

  const failed = (err: unknown): null => {
    console.error('Image upload failed', err);
    return null;
  };
  // Called synchronously so every request in a batch is in flight before the
  // first one is awaited; only the inserts are serialized.
  let request: Promise<string | null>;
  try {
    request = Promise.resolve(upload(file)).catch(failed);
  } catch (err) {
    request = Promise.resolve(failed(err));
  }

  return async () => {
    const url = await request;
    // The editor can be torn down mid-upload (navigating away); dispatching
    // into a destroyed view throws.
    if (!liveViews.has(view)) return;
    const at = ghostPosition(view, id);
    view.dispatch({ effects: removeGhost.of(id) });
    if (url == null) return;
    // A null position means the anchor was destroyed by a whole-document
    // replacement; `insertImage` then falls back to the caret.
    insertImage(view, url, altFromFilename(file.name), at ?? undefined);
  };
}

/**
 * Start an upload per file, each with its own placeholder anchored at `pos`.
 *
 * Every request starts at once, but the inserts are committed strictly in file
 * order: the placeholders all share one anchor, so letting each insert as it
 * completes would reorder a batch by network speed — paste three screenshots
 * and get them back shuffled.
 */
export function startImageUploads(
  view: EditorView,
  files: readonly File[],
  pos: number,
  upload: UploadImage,
): void {
  const commits = files.map((file) => beginUpload(view, file, pos, upload));
  void (async () => {
    for (const commit of commits) await commit();
  })();
}

/** The image files in a clipboard or drag payload, in order. */
export function imageFilesOf(
  list: ArrayLike<File> | null | undefined,
): File[] {
  if (!list || list.length === 0) return [];
  return Array.from(list).filter((file) => file.type.startsWith('image/'));
}

const uploadGhostTheme = EditorView.baseTheme({
  '.cm-note-upload-ghost': {
    display: 'inline-block',
    padding: '0 6px',
    borderRadius: '4px',
    fontSize: '85%',
    opacity: '0.7',
    border: '1px dashed currentColor',
    userSelect: 'none',
  },
});

/**
 * Paste / drop image upload for the note editor.
 *
 * Both handlers fall through (no `preventDefault`) when the payload carries no
 * image, so plain text paste and drop keep working. A drop inserts at the drop
 * coordinates rather than at the caret — dropping a file onto a paragraph and
 * having the image appear elsewhere is the single most confusing part of the
 * naive implementation.
 */
export function noteImageUpload(upload: UploadImage) {
  return [
    ghostField,
    uploadGhostTheme,
    trackLiveness,
    EditorView.domEventHandlers({
      paste(event, view) {
        if (!view.state.facet(EditorView.editable)) return false;
        const files = imageFilesOf(event.clipboardData?.files);
        if (files.length === 0) return false;
        event.preventDefault();
        startImageUploads(view, files, view.state.selection.main.to, upload);
        return true;
      },
      drop(event, view) {
        if (!view.state.facet(EditorView.editable)) return false;
        const files = imageFilesOf(event.dataTransfer?.files);
        if (files.length === 0) return false;
        event.preventDefault();
        const pos =
          view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
          view.state.selection.main.to;
        startImageUploads(view, files, pos, upload);
        return true;
      },
    }),
  ];
}
