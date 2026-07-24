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

  it('places the copy button in the wrapper, outside the scrolling <pre>', () => {
    const preview = new NotePreview();
    preview.render('```\ncode\n```');

    const wrapper = preview.el.querySelector('.note-code-wrapper');
    const button = preview.el.querySelector('.note-copy-btn');
    const pre = preview.el.querySelector('pre.note-code');

    // The button anchors to the non-scrolling wrapper so it stays pinned when
    // a long line scrolls the <pre> horizontally, rather than drifting inside
    // the scrolled content.
    expect(wrapper).toBeTruthy();
    expect(button?.parentElement).toBe(wrapper);
    expect(pre?.parentElement).toBe(wrapper);
    expect(pre?.contains(button)).toBe(false);
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

  it('renders a collapsed <details>/<summary> disclosure by default', () => {
    const preview = new NotePreview();
    preview.render(
      '<details>\n<summary>More</summary>\n\nHidden body\n\n</details>',
    );

    const details = preview.el.querySelector('details.note-details');
    const summary = details?.querySelector('summary.note-summary');
    expect(details).toBeTruthy();
    expect(summary?.textContent).toBe('More');
    // Collapsed by default: no `open` attribute.
    expect(details?.hasAttribute('open')).toBe(false);
    // Body markdown is rendered inside the disclosure.
    expect(details?.textContent).toContain('Hidden body');
  });

  it('renders <details open> expanded by default', () => {
    const preview = new NotePreview();
    preview.render(
      '<details open>\n<summary>Peek</summary>\n\nShown\n\n</details>',
    );

    const details = preview.el.querySelector('details.note-details');
    expect(details).toBeTruthy();
    expect(details?.hasAttribute('open')).toBe(true);
  });

  it('renders markdown inside the summary label and the body', () => {
    const preview = new NotePreview();
    preview.render(
      '<details>\n<summary>**bold** label</summary>\n\n- one\n- two\n\n</details>',
    );

    const summary = preview.el.querySelector('summary.note-summary');
    expect(summary?.querySelector('strong')?.textContent).toBe('bold');

    const items = preview.el.querySelectorAll('details.note-details li');
    expect(items.length).toBe(2);
  });

  it('supports nested <details> disclosures', () => {
    const preview = new NotePreview();
    preview.render(
      [
        '<details>',
        '<summary>Outer</summary>',
        '',
        '<details>',
        '<summary>Inner</summary>',
        '',
        'deep',
        '',
        '</details>',
        '',
        '</details>',
      ].join('\n'),
    );

    const outer = preview.el.querySelector('details.note-details');
    const inner = outer?.querySelector('details.note-details');
    expect(outer).toBeTruthy();
    expect(inner).toBeTruthy();
    expect(inner?.textContent).toContain('deep');
  });

  it('does not emit raw HTML for a stray </details> or embedded tags', () => {
    const preview = new NotePreview();
    // No opening <details>: the close must not become an orphan element, and
    // the script tag must never be rendered as executable HTML.
    preview.render('</details>\n\n<script>alert(1)</script>');

    expect(preview.el.querySelector('details')).toBeNull();
    expect(preview.el.querySelector('script')).toBeNull();
    // The literal text is preserved (escaped), proving html:false still holds.
    expect(preview.el.textContent).toContain('<script>alert(1)</script>');
  });

  it('copies code to the clipboard when the copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const preview = new NotePreview();
    document.body.appendChild(preview.el);
    preview.render('```\nhello world\n```');

    const button =
      preview.el.querySelector<HTMLButtonElement>('.note-copy-btn');
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
