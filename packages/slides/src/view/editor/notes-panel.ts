import type { Block } from '@wafflebase/docs';
import type { SlidesStore } from '../../store/store';
import type { SlidesEditor } from './editor';

export interface NotesPanelHandle {
  /** Detach editor subscriptions. The DOM is left in place. */
  dispose(): void;
}

export interface MountNotesPanelOptions {
  /**
   * Render the textarea as `readOnly` and skip the `input` listener
   * that writes back into the store. Used by viewer-role share links
   * so anonymous visitors can still read speaker notes without
   * mutating them.
   */
  readOnly?: boolean;
}

/**
 * Mount a speaker-notes panel into `container`. v1 is a plain
 * `<textarea>` bound to the current slide's `notes` Block[] via
 * `store.withNotes`. The serialization is one paragraph per line:
 * `blocks` ↔ `lines` round-trips losslessly for plain text.
 *
 * Phase 5 will replace this with a docs-IME-backed contenteditable so
 * notes get the same rich-text affordances as body text. The Block[]
 * storage is forward-compatible.
 */
export function mountNotesPanel(
  container: HTMLElement,
  store: SlidesStore,
  editor: SlidesEditor,
  options: MountNotesPanelOptions = {},
): NotesPanelHandle {
  const readOnly = options.readOnly === true;
  container.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.placeholder = 'Speaker notes…';
  ta.readOnly = readOnly;
  // Fill the host's drag-resized height instead of carrying its own
  // intrinsic size. The slides editor shell owns the notes resizer
  // affordance, so the textarea here is a content slot — no border,
  // no rounded box, no user-resize handle.
  ta.style.width = '100%';
  ta.style.height = '100%';
  ta.style.boxSizing = 'border-box';
  ta.style.resize = 'none';
  // Theme tokens from shadcn (frontend's index.css) so the textarea
  // follows the surrounding light/dark mode. Background stays
  // transparent so the panel blends with the editor column instead of
  // floating as its own boxy surface.
  ta.style.background = 'transparent';
  ta.style.color = 'var(--foreground, #ddd)';
  ta.style.border = 'none';
  ta.style.outline = 'none';
  ta.style.padding = '8px';
  ta.style.fontFamily = 'system-ui, sans-serif';
  ta.style.fontSize = '14px';
  container.appendChild(ta);

  const sync = (): void => {
    const id = editor.getCurrentSlideId();
    if (!id) { ta.value = ''; return; }
    const slide = store.read().slides.find((s) => s.id === id);
    if (!slide) { ta.value = ''; return; }
    ta.value = blocksToText(slide.notes);
  };

  if (!readOnly) {
    ta.addEventListener('input', () => {
      const id = editor.getCurrentSlideId();
      if (!id) return;
      store.batch(() => {
        store.withNotes(id, () => textToBlocks(ta.value));
      });
    });
  }

  // Re-bind when the current slide changes. We subscribe to BOTH
  // selection changes (covers in-place edits like select/deselect on
  // the same slide; cheap to re-read) AND current-slide changes
  // (selection.clear() is a no-op when selection was already empty,
  // so onSelectionChange alone misses some setCurrentSlide calls).
  const offSelection = editor.onSelectionChange(() => sync());
  const offSlide = editor.onCurrentSlideChange(() => sync());
  sync();

  return {
    dispose: () => {
      offSelection();
      offSlide();
    },
  };
}

function blocksToText(blocks: readonly Block[]): string {
  return blocks
    .map((b) => (b.inlines || []).map((i) => i.text).join(''))
    .join('\n');
}

function textToBlocks(text: string): Block[] {
  const lines = text === '' ? [''] : text.split('\n');
  return lines.map((line, i) => ({
    id: `notes-${i}`,
    type: 'paragraph',
    inlines: [{ text: line, style: {} }],
    style: {},
  } as unknown as Block));
}
