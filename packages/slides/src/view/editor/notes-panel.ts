import type { Block } from '@wafflebase/docs';
import type { SlidesStore } from '../../store/store';
import type { SlidesEditor } from './editor';

export interface NotesPanelHandle {
  /** Detach editor subscriptions. The DOM is left in place. */
  dispose(): void;
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
): NotesPanelHandle {
  container.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.placeholder = 'Speaker notes…';
  ta.style.width = '100%';
  ta.style.minHeight = '80px';
  ta.style.background = '#2a2a2a';
  ta.style.color = '#ddd';
  ta.style.border = '1px solid #444';
  ta.style.padding = '8px';
  ta.style.fontFamily = 'system-ui, sans-serif';
  ta.style.fontSize = '14px';
  ta.style.resize = 'vertical';
  container.appendChild(ta);

  const sync = (): void => {
    const id = editor.getCurrentSlideId();
    if (!id) { ta.value = ''; return; }
    const slide = store.read().slides.find((s) => s.id === id);
    if (!slide) { ta.value = ''; return; }
    ta.value = blocksToText(slide.notes);
  };

  ta.addEventListener('input', () => {
    const id = editor.getCurrentSlideId();
    if (!id) return;
    store.batch(() => {
      store.withNotes(id, () => textToBlocks(ta.value));
    });
  });

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
