import { describe, it, expect } from 'vitest';
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
