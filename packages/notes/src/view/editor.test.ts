import { describe, it, expect } from 'vitest';
import { EditorView } from '@codemirror/view';
import { MemNoteStore } from '../store/memory.js';
import { initialize } from './editor.js';

describe('initialize', () => {
  it('mounts an editor showing the store text and a rendered preview', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemNoteStore('# Title\n\nhello');
    const api = initialize(container, store, 'light');

    expect(api.getText()).toBe('# Title\n\nhello');
    // CodeMirror content is present
    expect(container.querySelector('.cm-editor')).toBeTruthy();
    // Preview rendered the heading as an <h1>
    const preview = container.querySelector('[data-role="note-preview"]');
    expect(preview?.innerHTML).toContain('<h1>');
    expect(preview?.textContent).toContain('Title');

    api.dispose();
    container.remove();
  });

  it('is read-only when requested', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const api = initialize(container, new MemNoteStore('x'), 'light', true);
    expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
    api.dispose();
    container.remove();
  });

  it('honors the initial view mode and switches panes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    // Start in 'view' (preview only) — the read-only share default.
    const api = initialize(container, new MemNoteStore('# Hi'), 'light', false, 'view');
    const editorEl = container.querySelector<HTMLElement>('[data-role="note-editor"]')!;
    const previewEl = container.querySelector<HTMLElement>('[data-role="note-preview"]')!;

    expect(api.getViewMode()).toBe('view');
    expect(editorEl.style.display).toBe('none');
    expect(previewEl.style.display).not.toBe('none');

    api.setViewMode('edit');
    expect(api.getViewMode()).toBe('edit');
    expect(editorEl.style.display).not.toBe('none');
    expect(previewEl.style.display).toBe('none');

    api.setViewMode('both');
    expect(api.getViewMode()).toBe('both');
    expect(editorEl.style.display).not.toBe('none');
    expect(previewEl.style.display).not.toBe('none');

    api.dispose();
    container.remove();
  });

  it('routes undo/redo through the store, not CodeMirror history', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemNoteStore('hello');
    const api = initialize(container, store, 'light');

    expect(api.canUndo()).toBe(false);
    // Type through CodeMirror so the edit reaches the store the normal way.
    const view = EditorView.findFromDOM(container)!;
    view.dispatch({ changes: { from: 5, insert: '!' }, userEvent: 'input.type' });
    expect(store.getText()).toBe('hello!');
    expect(api.canUndo()).toBe(true);

    api.undo();
    // The store reverted and pushed the result back into the editor.
    expect(store.getText()).toBe('hello');
    expect(api.getText()).toBe('hello');
    expect(api.canUndo()).toBe(false);
    expect(api.canRedo()).toBe(true);

    api.redo();
    expect(api.getText()).toBe('hello!');

    api.dispose();
    container.remove();
  });

  it('restores the caret the store returns after undo/redo', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    // Seed one undo unit directly so the pre/post-edit carets are known without
    // depending on the view holding focus (the live-caret publisher is
    // focus-gated, which jsdom cannot satisfy).
    const store = new MemNoteStore('hello world');
    store.setLocalSelection(3, 3); // pre-edit caret
    store.batch(() => {
      store.editText(3, 3, 'X');
      store.recordSelectionForHistory({ anchor: 4, head: 4 }); // post-edit caret
    });
    const api = initialize(container, store, 'light');
    const view = EditorView.findFromDOM(container)!;
    expect(api.getText()).toBe('helXlo world');

    api.undo();
    // The reverted text arrives as a selection-less remote transaction; the
    // caret lands at 3 only because the store's returned selection is applied.
    expect(api.getText()).toBe('hello world');
    expect(view.state.selection.main.anchor).toBe(3);
    expect(view.state.selection.main.head).toBe(3);

    api.redo();
    expect(api.getText()).toBe('helXlo world');
    expect(view.state.selection.main.head).toBe(4);

    api.dispose();
    container.remove();
  });

  it('does not re-push an undo result into the store', () => {
    // Regression guard for the echo loop: the store's undo arrives as a
    // remote-tagged transaction, which noteSync must not send back as a
    // forward edit (that would strand the undo stack one step behind).
    const container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemNoteStore('ab');
    const api = initialize(container, store, 'light');
    const view = EditorView.findFromDOM(container)!;

    view.dispatch({ changes: { from: 2, insert: 'c' }, userEvent: 'input.type' });
    api.undo();
    expect(store.getText()).toBe('ab');
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);

    api.dispose();
    container.remove();
  });

  it('binds Mod-z / Mod-Shift-z to the store history', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemNoteStore('hello');
    const api = initialize(container, store, 'light');
    const content = container.querySelector('.cm-content') as HTMLElement;
    const view = EditorView.findFromDOM(container)!;
    view.dispatch({ changes: { from: 5, insert: '!' }, userEvent: 'input.type' });

    // jsdom is not macOS, so CodeMirror resolves `Mod` to Ctrl here. A shifted
    // letter arrives as the uppercase `key`; CodeMirror recovers the base name
    // for the `Ctrl-Shift-z` lookup from `keyCode`, so both must be set.
    const press = (key: string, shift = false) =>
      content.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: shift ? key.toUpperCase() : key,
          keyCode: key.toUpperCase().charCodeAt(0),
          ctrlKey: true,
          shiftKey: shift,
          bubbles: true,
        }),
      );

    press('z');
    expect(store.getText()).toBe('hello');
    press('z', true);
    expect(store.getText()).toBe('hello!');

    api.dispose();
    container.remove();
  });

  it('leaves history unbound on a read-only mount', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemNoteStore('hello');
    // Seed a unit directly on the store: a read-only view cannot type one.
    store.editText(5, 5, '!');
    const api = initialize(container, store, 'light', true);
    const content = container.querySelector('.cm-content') as HTMLElement;
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    );
    expect(store.getText()).toBe('hello!');

    api.dispose();
    container.remove();
  });

  it('switches the keybinding mode (default <-> vim)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const api = initialize(container, new MemNoteStore('hi'), 'light');

    expect(api.getKeymap()).toBe('default');
    // Switching to vim rebuilds the editor state with the vim() extension
    // (throws here if the extension fails to load) and preserves content.
    api.setKeymap('vim');
    expect(api.getKeymap()).toBe('vim');
    expect(api.getText()).toBe('hi');
    api.setKeymap('default');
    expect(api.getKeymap()).toBe('default');

    api.dispose();
    container.remove();
  });
});
