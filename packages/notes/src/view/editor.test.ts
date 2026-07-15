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
});
