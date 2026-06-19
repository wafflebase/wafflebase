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
  ensureNotesPanelStyles();
  const ta = document.createElement('textarea');
  ta.className = 'wfb-slides-notes-ta';
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
  // floating as its own boxy surface. The `outline: none` here drops
  // the boxy default focus ring; keyboard users get a subtler 2-px
  // inset ring via the `:focus-visible` rule installed by
  // `ensureNotesPanelStyles` so a11y stays intact (WCAG 2.4.7).
  ta.style.background = 'transparent';
  ta.style.color = 'var(--foreground, #ddd)';
  ta.style.border = 'none';
  ta.style.outline = 'none';
  ta.style.padding = '8px';
  ta.style.fontFamily = 'system-ui, sans-serif';
  ta.style.fontSize = '14px';
  container.appendChild(ta);

  const sync = (opts: { fromRemote?: boolean } = {}): void => {
    // The focus guard applies ONLY to remote (store.onChange) syncs: a
    // peer's commit fires mid-keystroke, and overwriting `ta.value`
    // here would reset the caret and drop the local user's in-progress
    // text. Notes are whole-array LWW (see `withNotes`), so the local
    // input listener already owns the field while focused; we reconcile
    // on the next unfocused sync (e.g. blur). Selection/slide-change
    // syncs must NOT be guarded — they rebind the textarea to a
    // possibly-different slide and have to run even while focused, or
    // the box would show (and accept edits into) the wrong slide.
    // Checked before the `store.read()` clone below so the typing hot
    // path (input → batch → onChange) bails without cloning the deck.
    if (opts.fromRemote && document.activeElement === ta) return;
    const id = editor.getCurrentSlideId();
    if (!id) { ta.value = ''; return; }
    const slide = store.read().slides.find((s) => s.id === id);
    if (!slide) { ta.value = ''; return; }
    const next = blocksToText(slide.notes);
    if (ta.value !== next) ta.value = next;
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
  // Also re-sync on ANY store change — crucially, remote Yorkie edits
  // from a collaborator. Without this the textarea only refreshed on
  // local selection/slide changes, so a peer's note edit stayed
  // invisible until the user navigated away and back. `fromRemote`
  // applies the focus guard so this can't clobber the local caret.
  const offChange = store.onChange?.(() => sync({ fromRemote: true })) ?? (() => {});
  sync();

  return {
    dispose: () => {
      offSelection();
      offSlide();
      offChange();
    },
  };
}

/**
 * Inject a `:focus-visible` outline rule for the notes textarea once
 * per document. The inline `outline: none` strips the default focus
 * ring (which would render as a boxy rectangle around the borderless
 * panel); this rule re-adds a subtle 2-px inset ring that only shows
 * for keyboard focus — WCAG 2.4.7 compliant without re-introducing
 * the chrome we deliberately removed for mouse users.
 */
function ensureNotesPanelStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('wfb-slides-notes-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'wfb-slides-notes-panel-styles';
  style.textContent =
    '.wfb-slides-notes-ta:focus-visible {' +
    '  outline: 2px solid var(--ring, #3a7);' +
    '  outline-offset: -2px;' +
    '  border-radius: 2px;' +
    '}';
  document.head.appendChild(style);
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
