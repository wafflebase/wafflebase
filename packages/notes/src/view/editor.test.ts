import { describe, it, expect, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { MemNoteStore } from '../store/memory.js';
import { initialize } from './editor.js';
import { NotePreview } from './preview.js';

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

  // A theme switch has to repaint the preview: mermaid bakes its palette into
  // the SVG it emits, so diagrams would otherwise keep the old colours.
  it('repaints the preview on a theme switch while it is visible', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const api = initialize(container, new MemNoteStore('# Hi'), 'light');
    const previewEl = container.querySelector<HTMLElement>(
      '[data-role="note-preview"]',
    )!;

    // A marker only survives if render() did not replace the preview's markup.
    const marker = document.createElement('span');
    marker.dataset.role = 'repaint-marker';
    previewEl.appendChild(marker);

    api.setTheme('dark');
    expect(previewEl.querySelector('[data-role="repaint-marker"]')).toBeNull();
    expect(previewEl.querySelector('h1')).toBeTruthy();

    // Same theme again: no-op, so no repaint.
    previewEl.appendChild(marker);
    api.setTheme('dark');
    expect(previewEl.querySelector('[data-role="repaint-marker"]')).toBeTruthy();

    api.dispose();
    container.remove();
  });

  // The repaint alone is not enough: the preview owns the mermaid palette, and
  // re-rendering without pushing the new one just repaints the old colours.
  it('pushes the new palette into the preview on a theme switch', () => {
    const setTheme = vi.spyOn(NotePreview.prototype, 'setTheme');
    try {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const api = initialize(container, new MemNoteStore('# Hi'), 'light');

      api.setTheme('dark');
      expect(setTheme).toHaveBeenCalledWith('dark');

      // The palette follows the editor back, and an unchanged theme is a no-op.
      api.setTheme('light');
      expect(setTheme).toHaveBeenLastCalledWith('light');
      api.setTheme('light');
      expect(setTheme).toHaveBeenCalledTimes(2);

      api.dispose();
      container.remove();
    } finally {
      setTheme.mockRestore();
    }
  });

  it('skips the theme repaint while the preview is hidden', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    // 'edit' hides the preview; repainting it there is wasted work (and would
    // download the mermaid engine for a pane nobody is looking at).
    const api = initialize(
      container,
      new MemNoteStore('# Hi'),
      'light',
      false,
      'edit',
    );
    const previewEl = container.querySelector<HTMLElement>(
      '[data-role="note-preview"]',
    )!;
    const marker = document.createElement('span');
    marker.dataset.role = 'repaint-marker';
    previewEl.appendChild(marker);

    api.setTheme('dark');
    expect(previewEl.querySelector('[data-role="repaint-marker"]')).toBeTruthy();

    // Switching back into a preview-visible mode repaints it.
    api.setViewMode('both');
    expect(previewEl.querySelector('[data-role="repaint-marker"]')).toBeNull();

    api.dispose();
    container.remove();
  });

  it('ticks a task from the preview and leaves a read-only one alone', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemNoteStore('# Todo\n\n- [ ] milk\n- [ ] bread');
    const api = initialize(container, store, 'light');

    // Click the text of the second task — the source line it maps to is the
    // one the preview tagged, not the item's position among the checkboxes.
    const items = container.querySelectorAll('li.task-list-item');
    items[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(api.getText()).toBe('# Todo\n\n- [ ] milk\n- [x] bread');
    // The preview re-rendered from the change, so the box now shows ticked.
    expect(
      container.querySelectorAll('input.task-list-item-checkbox')[1],
    ).toHaveProperty('checked', true);

    api.dispose();
    container.remove();

    const roContainer = document.createElement('div');
    document.body.appendChild(roContainer);
    const roStore = new MemNoteStore('- [ ] milk');
    const roApi = initialize(roContainer, roStore, 'light', true);
    roContainer
      .querySelector('li.task-list-item')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(roApi.getText()).toBe('- [ ] milk');

    roApi.dispose();
    roContainer.remove();
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
