// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize } from '../../../src/view/editor/editor';
import { mountNotesPanel } from '../../../src/view/editor/notes-panel';

beforeEach(() => { document.body.innerHTML = ''; });

function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 540;
  const overlay = document.createElement('div');
  const notes = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  document.body.appendChild(notes);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  const editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
  return { canvas, overlay, notes, store, editor };
}

describe('mountNotesPanel', () => {
  it('renders a textarea', () => {
    const { notes, store, editor } = makeFixture();
    mountNotesPanel(notes, store, editor);
    expect(notes.querySelector('textarea')).toBeTruthy();
  });

  it('typing into the textarea writes to the slide notes', () => {
    const { notes, store, editor } = makeFixture();
    mountNotesPanel(notes, store, editor);
    const ta = notes.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'remember to smile';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    // Notes are stored as Block[]; one block per line, plain inlines.
    const text = (store.read().slides[0].notes[0]?.inlines?.[0] as { text: string } | undefined)?.text;
    expect(text).toBe('remember to smile');
    void editor;
  });

  it('switching slides re-binds to the new slide notes', () => {
    const { notes, store, editor } = makeFixture();
    let secondId = '';
    store.batch(() => { secondId = store.addSlide('blank'); });
    mountNotesPanel(notes, store, editor);
    const ta = notes.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'first slide notes';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    editor.setCurrentSlide(secondId);
    expect(ta.value).toBe('');
    ta.value = 'second slide notes';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    expect((store.read().slides[1].notes[0]?.inlines?.[0] as { text: string }).text).toBe('second slide notes');
    expect((store.read().slides[0].notes[0]?.inlines?.[0] as { text: string }).text).toBe('first slide notes');
  });

  it('reflects an external (remote) notes edit while the textarea is unfocused', () => {
    const { notes, store, editor } = makeFixture();
    mountNotesPanel(notes, store, editor);
    const ta = notes.querySelector<HTMLTextAreaElement>('textarea')!;
    const id = editor.getCurrentSlideId()!;
    // Simulate a remote peer editing the notes — not through this
    // textarea. This commits via batch and fires store.onChange.
    store.batch(() => {
      store.withNotes(id, () => [
        { id: 'n0', type: 'paragraph', inlines: [{ text: 'from peer', style: {} }], style: {} } as never,
      ]);
    });
    expect(ta.value).toBe('from peer');
  });

  it('does not clobber the local value while the textarea is focused', () => {
    const { notes, store, editor } = makeFixture();
    mountNotesPanel(notes, store, editor);
    const ta = notes.querySelector<HTMLTextAreaElement>('textarea')!;
    const id = editor.getCurrentSlideId()!;
    // User is mid-typing in this textarea (focused) — a concurrent
    // remote commit must not overwrite their in-progress caret/value.
    ta.focus();
    ta.value = 'local in progress';
    store.batch(() => {
      store.withNotes(id, () => [
        { id: 'n0', type: 'paragraph', inlines: [{ text: 'from peer', style: {} }], style: {} } as never,
      ]);
    });
    expect(ta.value).toBe('local in progress');
  });

  it('rebinds to the new slide even when the textarea is focused', () => {
    const { notes, store, editor } = makeFixture();
    let secondId = '';
    store.batch(() => { secondId = store.addSlide('blank'); });
    mountNotesPanel(notes, store, editor);
    const ta = notes.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'slide one notes';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    // Focus stays in the textarea while the user navigates to slide 2
    // (e.g. clicking a non-focusable thumbnail doesn't blur it). The
    // box MUST rebind to slide 2's notes — the focus guard is only for
    // remote edits, never for a local slide change. Otherwise typing
    // would write slide 1's stale text into slide 2.
    ta.focus();
    editor.setCurrentSlide(secondId);
    expect(ta.value).toBe('');
  });

  it('readOnly: true marks textarea read-only and ignores input', () => {
    const { notes, store, editor } = makeFixture();
    mountNotesPanel(notes, store, editor, { readOnly: true });
    const ta = notes.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(ta.readOnly).toBe(true);
    ta.value = 'attempted edit';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    // Store remains untouched — the input listener was never attached.
    expect(store.read().slides[0].notes).toEqual([]);
  });
});
