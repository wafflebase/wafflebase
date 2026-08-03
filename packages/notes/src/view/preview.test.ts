import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotePreview } from './preview.js';
import { resetMermaidStateForTests, type MermaidLike } from './mermaid.js';

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

  // Issue #517: a list item followed by an empty nested bullet used to render
  // the parent's text as a setext `<h2>` (the lone `-` was read as an underline).
  it('nests an empty bullet instead of turning the parent into an <h2>', () => {
    const preview = new NotePreview();
    preview.render('- 1\n  -');

    // No accidental heading.
    expect(preview.el.querySelector('h2')).toBeNull();

    // Parent keeps body text and gains an empty nested child item.
    const outer = preview.el.querySelector('ul > li');
    expect(outer?.textContent?.trim().startsWith('1')).toBe(true);
    const nested = outer?.querySelector('ul > li');
    expect(nested).toBeTruthy();
    expect(nested?.textContent?.trim()).toBe('');
  });

  it('nests an empty bullet with a trailing space too', () => {
    const preview = new NotePreview();
    preview.render('- 1\n  - ');
    expect(preview.el.querySelector('h2')).toBeNull();
    expect(preview.el.querySelector('ul > li > ul > li')).toBeTruthy();
  });

  it('still renders the blank-line workaround correctly', () => {
    const preview = new NotePreview();
    preview.render('- 1\n\n  - ');
    expect(preview.el.querySelector('h2')).toBeNull();
    expect(preview.el.querySelector('ul > li > ul > li')).toBeTruthy();
  });

  it('preserves multi-dash setext headings', () => {
    const preview = new NotePreview();
    preview.render('Heading\n---');
    const h2 = preview.el.querySelector('h2');
    expect(h2?.textContent).toBe('Heading');
  });

  it('leaves a non-empty nested list unchanged', () => {
    const preview = new NotePreview();
    preview.render('- 1\n  - 2');
    expect(preview.el.querySelector('h2')).toBeNull();
    const nested = preview.el.querySelector('ul > li > ul > li');
    expect(nested?.textContent?.trim()).toBe('2');
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

// Issue #625: a ```mermaid fence renders as a diagram, not a code block. The
// engine is stubbed here — real mermaid needs SVG layout APIs jsdom lacks.
describe('NotePreview mermaid fences', () => {
  const DIAGRAM = '```mermaid\nflowchart LR\n  Editor --> Preview\n```';
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function stubEngine(
    render: MermaidLike['render'] = async (_id, text) => ({
      svg: `<svg data-text="${text.replace(/\n/g, '|')}"></svg>`,
    }),
  ) {
    const engine: MermaidLike = { initialize: vi.fn(), render: vi.fn(render) };
    return engine;
  }

  beforeEach(() => {
    resetMermaidStateForTests();
  });

  it('emits a source-carrying placeholder, not a highlighted code block', () => {
    const preview = new NotePreview({
      mermaidLoader: async () => stubEngine(),
    });
    preview.render(DIAGRAM);

    const block = preview.el.querySelector('.note-mermaid');
    expect(block).toBeTruthy();
    // Not a code block: no hljs markup and no copy button for a diagram.
    expect(preview.el.querySelector('pre.note-code')).toBeNull();
    expect(preview.el.querySelector('.note-copy-btn')).toBeNull();
    // The escaped source is the pre-render fallback, so a diagram that has not
    // rendered yet (or cannot) still reads as its markdown source.
    expect(block?.querySelector('.note-mermaid-source')?.textContent).toBe(
      'flowchart LR\n  Editor --> Preview\n',
    );
  });

  it('replaces the placeholder with the rendered SVG', async () => {
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(DIAGRAM);
    await flush();

    const block = preview.el.querySelector('.note-mermaid');
    expect(block?.hasAttribute('data-mermaid-pending')).toBe(false);
    expect(block?.querySelector('svg')).toBeTruthy();
    expect(block?.querySelector('.note-mermaid-source')).toBeNull();
    expect(engine.render).toHaveBeenCalledWith(
      expect.any(String),
      'flowchart LR\n  Editor --> Preview\n',
    );
  });

  it('keeps the source visible and reports the error for invalid syntax', async () => {
    const engine = stubEngine(async () => {
      throw new Error('Parse error on line 2');
    });
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render('```mermaid\nnot a diagram\n```');
    await flush();

    const block = preview.el.querySelector('.note-mermaid');
    expect(block?.getAttribute('data-mermaid-error')).toBe('true');
    expect(block?.querySelector('.note-mermaid-source')?.textContent).toBe(
      'not a diagram\n',
    );
    expect(
      block?.querySelector('.note-mermaid-message')?.textContent,
    ).toContain('Parse error on line 2');
  });

  it('leaves the source in place when the engine cannot be loaded', async () => {
    const preview = new NotePreview({ mermaidLoader: async () => null });
    preview.render(DIAGRAM);
    await flush();

    const block = preview.el.querySelector('.note-mermaid');
    expect(block?.querySelector('.note-mermaid-source')?.textContent).toContain(
      'flowchart LR',
    );
  });

  it('reuses a cached diagram across re-renders instead of re-rendering it', async () => {
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(DIAGRAM);
    await flush();

    // The preview re-renders on every keystroke in split mode; an unchanged
    // diagram must not re-run the layout engine, and must not flash back to
    // its source (the cached SVG lands inside the synchronous render() call).
    preview.render(`${DIAGRAM}\n\ntyping`);
    expect(preview.el.querySelector('.note-mermaid svg')).toBeTruthy();
    await flush();
    expect(engine.render).toHaveBeenCalledTimes(1);
  });

  it('re-renders the same diagram for the other theme', async () => {
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(DIAGRAM);
    await flush();

    preview.setTheme('dark');
    preview.render(DIAGRAM);
    await flush();

    // Mermaid bakes the palette into the SVG, so a theme switch is a cache miss.
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(engine.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'dark', securityLevel: 'strict' }),
    );
  });
});
