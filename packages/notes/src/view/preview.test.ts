import { describe, it, expect, vi } from 'vitest';
import { NotePreview } from './preview.js';

describe('NotePreview', () => {
  it('highlights fenced code blocks with the hljs class', () => {
    const preview = new NotePreview();
    preview.render('```js\nconst x = 1;\n```');

    const code = preview.el.querySelector('pre.note-code > code');
    expect(code).toBeTruthy();
    expect(code?.className).toContain('hljs');
    expect(code?.className).toContain('language-js');
    // highlight.js should have tokenized the keyword into a span.
    expect(code?.innerHTML).toContain('hljs-keyword');

    // Copy button is present alongside the code.
    expect(preview.el.querySelector('.note-copy-btn')).toBeTruthy();
  });

  it('renders a disabled checkbox for task-list items', () => {
    const preview = new NotePreview();
    preview.render('- [x] done\n- [ ] todo');

    const checkboxes = preview.el.querySelectorAll(
      'input.task-list-item-checkbox',
    );
    expect(checkboxes.length).toBe(2);
    for (const checkbox of checkboxes) {
      expect(checkbox.getAttribute('disabled')).not.toBeNull();
    }
    expect(checkboxes[0].hasAttribute('checked')).toBe(true);
    expect(checkboxes[1].hasAttribute('checked')).toBe(false);
  });

  it('renders KaTeX markup for inline math', () => {
    const preview = new NotePreview();
    preview.render('$E = mc^2$');
    expect(preview.el.querySelector('.katex')).toBeTruthy();
  });

  it('adds target=_blank and rel=noopener to external links', () => {
    const preview = new NotePreview();
    preview.render('[link](https://example.com)');
    const a = preview.el.querySelector('a');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('adds loading=lazy and decoding=async to images', () => {
    const preview = new NotePreview();
    preview.render('![alt](https://example.com/img.png)');
    const img = preview.el.querySelector('img');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('decoding')).toBe('async');
  });

  it('copies code to the clipboard when the copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const preview = new NotePreview();
    document.body.appendChild(preview.el);
    preview.render('```\nhello world\n```');

    const button = preview.el.querySelector<HTMLButtonElement>(
      '.note-copy-btn',
    );
    expect(button).toBeTruthy();
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Clipboard write is async; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('hello world\n');
    expect(button?.textContent).toBe('Copied');

    preview.el.remove();
  });
});
