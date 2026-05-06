// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../canvas/test-canvas-env';
import { MemSlidesStore } from '../../store/memory';
import { initialize } from './editor';
import { mountNotesPanel } from './notes-panel';

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
});
