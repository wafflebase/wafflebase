import { StateEffect, StateField, type EditorState } from '@codemirror/state';
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
    set = set.map(tr.changes);
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

async function uploadAndInsert(
  view: EditorView,
  file: File,
  pos: number,
  upload: UploadImage,
): Promise<void> {
  const id = nextGhostId++;
  view.dispatch({
    effects: addGhost.of({ id, pos, label: file.name || 'image' }),
  });

  let url: string | null = null;
  try {
    url = await upload(file);
  } catch (err) {
    console.error('Image upload failed', err);
  }

  if (!liveViews.has(view)) return;
  const at = ghostPosition(view, id);
  view.dispatch({ effects: removeGhost.of(id) });
  if (url == null || at === null) return;

  insertImage(view, url, altFromFilename(file.name), at);
}

/**
 * Start an upload per file, each with its own placeholder anchored at `pos`.
 * Uploads run concurrently and each inserts as it completes; the placeholders
 * keep the insertion points apart, so completion order does not scramble them.
 */
export function startImageUploads(
  view: EditorView,
  files: readonly File[],
  pos: number,
  upload: UploadImage,
): void {
  for (const file of files) {
    void uploadAndInsert(view, file, pos, upload);
  }
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
