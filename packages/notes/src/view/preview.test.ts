import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { NotePreview } from './preview.js';
import { insertFoldout } from './commands.js';
import {
  MAX_FENCE_CHARS,
  MERMAID_CARRIER_PATTERNS_VERSION,
  mermaidFenceHtml,
  renderMermaidBlocks,
  resetMermaidStateForTests,
  type MermaidLike,
} from './mermaid.js';

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

  // The toolbar's Foldout button and this renderer have to agree on the source
  // shape: four-space-indented tags would parse as an indented code block.
  it('renders the toolbar-inserted foldout skeleton as a disclosure', () => {
    const view = new EditorView({ state: EditorState.create({ doc: '' }) });
    insertFoldout(view);
    const source = view.state.doc.toString();
    view.destroy();

    const preview = new NotePreview();
    preview.render(source);
    expect(
      preview.el.querySelector('details.note-details > summary.note-summary'),
    ).toBeTruthy();
    expect(preview.el.querySelector('pre')).toBeNull();
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

  /**
   * One macrotask, which is all a render pass needs *once its modules are
   * loaded* — every other step in it is a microtask, and microtasks all drain
   * before a timer fires. It deliberately does not await the pass itself: two
   * cases below park a pass inside a gated engine and assert on the DOM while
   * it is still open, so waiting for completion would hang them.
   */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function stubEngine(
    render: MermaidLike['render'] = async (_id, text) => ({
      svg: `<svg data-text="${text.replace(/\n/g, '|')}"></svg>`,
    }),
  ) {
    const engine: MermaidLike = { initialize: vi.fn(), render: vi.fn(render) };
    return engine;
  }

  beforeAll(async () => {
    // The engine is stubbed, but the sanitizer is not: a pass always awaits the
    // real `import('dompurify')` in `loadPurifier()`, and that is the one step
    // in it that is not a microtask. On a cold module cache the resolution
    // outlasts `flush()`'s single tick — which is how the first awaiting case
    // flaked in CI while passing locally against a warm cache. Load the module
    // once up front: `resetMermaidStateForTests()` still drops the memoized
    // promise per case, but the module stays cached, so every later import
    // settles in microtasks and one tick is deterministically enough.
    await import('dompurify');
  });

  beforeEach(() => {
    resetMermaidStateForTests();
  });

  it('still targets the mermaid release its carrier patterns came from', () => {
    // `stripConfigDirectives()` uses verbatim copies of mermaid's
    // `directiveRegex`/`frontMatterRegex`, which live in a non-exported module
    // — there is nothing to import and compare against at runtime. Under
    // `mermaid: ^11.16.0` a routine minor/patch upgrade can move those
    // patterns while the copies stay put, and recognizing LESS than the engine
    // does is the failure mode: the carrier we leave behind is one the engine
    // still reads. So pin the version instead — an upgrade fails here until
    // someone re-diffs `src/utils/regexes.ts` and moves the constant.
    const require = createRequire(import.meta.url);
    const { version } = require('mermaid/package.json') as { version: string };
    expect(version).toBe(MERMAID_CARRIER_PATTERNS_VERSION);
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
    const load = vi.fn(async () => null);
    const preview = new NotePreview({ mermaidLoader: load });
    preview.render(DIAGRAM);
    await flush();

    // The load was attempted and resolved to null; the block must stay a
    // readable, still-pending source fallback rather than an error or a blank.
    expect(load).toHaveBeenCalledTimes(1);
    const block = preview.el.querySelector('.note-mermaid');
    expect(block?.getAttribute('data-mermaid-pending')).toBe('true');
    expect(block?.hasAttribute('data-mermaid-error')).toBe(false);
    expect(block?.querySelector('.note-mermaid-message')).toBeNull();
    expect(block?.querySelector('svg')).toBeNull();
    expect(block?.querySelector('.note-mermaid-source')?.textContent).toContain(
      'flowchart LR',
    );
  });

  it('does not load the engine for a note without a mermaid fence', async () => {
    const load = vi.fn(async () => stubEngine());
    const preview = new NotePreview({ mermaidLoader: load });
    preview.render('# Title\n\n```js\nconst x = 1;\n```\n\nplain text');
    await flush();

    // The whole point of the lazy import (and of the frontend chunk-count
    // budget it costs): a note with no diagram never pays for mermaid.
    expect(load).not.toHaveBeenCalled();

    // Sanity check that the spy would have fired for a fence.
    preview.render(DIAGRAM);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('escapes HTML in the fence source instead of emitting markup', async () => {
    // The mermaid fence bypasses the escaped code-block path, so the
    // placeholder has to escape the source itself.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\n<script>alert(1)</script>\n<img src=x onerror=alert(2)>\n```',
    );

    const block = preview.el.querySelector('.note-mermaid');
    expect(block?.querySelector('script')).toBeNull();
    expect(block?.querySelector('img')).toBeNull();
    expect(block?.querySelector('.note-mermaid-source')?.innerHTML).toContain(
      '&lt;script&gt;',
    );
    expect(block?.textContent).toContain('<script>alert(1)</script>');

    // The unparseable-diagram path keeps the same escaped source visible.
    const failing = stubEngine(async () => {
      throw new Error('Parse error');
    });
    const preview2 = new NotePreview({ mermaidLoader: async () => failing });
    preview2.render('```mermaid\n<script>alert(1)</script>\n```');
    await flush();
    expect(preview2.el.querySelector('script')).toBeNull();
    expect(preview2.el.textContent).toContain('<script>alert(1)</script>');
  });

  it('strips script and event handlers from the engine output', async () => {
    // The rendered SVG reaches the live DOM, so it is sanitized locally rather
    // than trusting the engine's own sanitizer alone.
    const engine = stubEngine(async () => ({
      svg:
        '<svg><style>@import url(https://evil.example/x.css);' +
        '.n{background:url(https://evil.example/beacon)}</style>' +
        '<script>alert(1)</script>' +
        '<g onclick="alert(2)" style="fill:url(https://evil.example/b)">' +
        '<a href="javascript:alert(3)"><rect/></a></g></svg>',
    }));
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    document.body.appendChild(preview.el);
    preview.render(DIAGRAM);
    await flush();

    const block = preview.el.querySelector('.note-mermaid');
    expect(block?.querySelector('svg')).toBeTruthy();
    expect(block?.querySelector('script')).toBeNull();
    expect(block?.querySelector('g')?.hasAttribute('onclick')).toBe(false);
    expect(block?.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(block?.querySelector('g')?.hasAttribute('style')).toBe(false);
    // An inline-SVG <style> is document-scoped, so an offending block goes
    // whole rather than being patched in place.
    const style = block?.querySelector('style')?.textContent ?? '';
    expect(style).not.toContain('@import');
    expect(style).not.toContain('evil.example');

    preview.el.remove();
  });

  it('keeps the in-document references a real diagram is built from', async () => {
    // The hostile cases below must not be bought by breaking ordinary mermaid
    // output: markers, gradients and internal links are all `#` references.
    const engine = stubEngine(async () => ({
      svg:
        '<svg><style>#d .edge{stroke:#333;marker-end:url(#arrow)}</style>' +
        '<defs><marker id="arrow"><path d="M0,0 L4,2 L0,4"/></marker></defs>' +
        '<a href="#section"><g class="edge" style="fill:url(#grad)">' +
        '<use xlink:href="#arrow"/></g></a>' +
        '<foreignObject><div class="label">Editor</div></foreignObject></svg>',
    }));
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(DIAGRAM);
    await flush();

    const block = preview.el.querySelector('.note-mermaid')!;
    expect(block.querySelector('style')?.textContent).toContain('url(#arrow)');
    expect(block.querySelector('marker#arrow')).toBeTruthy();
    expect(block.querySelector('a')?.getAttribute('href')).toBe('#section');
    expect(block.querySelector('.edge')?.getAttribute('style')).toContain(
      'url(#grad)',
    );
    // A <use> that kept the element but lost the reference renders nothing.
    expect(block.querySelector('use')?.getAttribute('xlink:href')).toBe(
      '#arrow',
    );
    // htmlLabels diagrams put their label text in a foreignObject subtree.
    expect(block.querySelector('foreignObject .label')?.textContent).toBe(
      'Editor',
    );
  });

  it('drops CSS whose fetch is spelled with escapes, and fetching tags', async () => {
    // A string-level scrub is escaped around with CSS escape sequences (the
    // parser resolves `\40 import` to `@import`), so the check decodes before
    // it looks. The fetch-capable tags are separate markup, not text inside a
    // <style>: an <img> there would be removed with the block that carries it,
    // which would say nothing about FORBID_TAGS.
    const engine = stubEngine(async () => ({
      svg:
        '<svg><g style="background:\\75 rl(https://evil.example/c)"/>' +
        '<style>\\40 import "https://evil.example/x.css";' +
        '.n{background:\\75 rl(https://evil.example/beacon)}</style>' +
        '<image href="https://evil.example/pixel.png"/>' +
        '<img src="https://evil.example/pixel.png">' +
        '<foreignObject><div><img src="https://evil.example/label.png">' +
        '</div></foreignObject></svg>',
    }));
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    document.body.appendChild(preview.el);
    preview.render(DIAGRAM);
    await flush();

    const block = preview.el.querySelector('.note-mermaid')!;
    expect(block.querySelector('style')).toBeNull();
    // Both the SVG <image> and the HTML <img>, including one reached through
    // the foreignObject label subtree the HTML profile is enabled for.
    expect(block.querySelector('img')).toBeNull();
    expect(block.querySelector('image')).toBeNull();
    expect(block.textContent).not.toContain('evil.example');
    expect(block.querySelector('g')?.hasAttribute('style')).toBe(false);

    preview.el.remove();
  });

  it('drops a <style> whose CSS an element child splits past the check', async () => {
    // The browser builds the stylesheet from the element's *child text
    // content*, so `@im<title>x</title>port` is `@import` to the CSS parser
    // while `textContent` reads `@imxport`. Mermaid never emits a <style> with
    // an element child; DOMPurify manufactures one, because the raw-text
    // <style> mermaid serialized is re-parsed inside <svg>, where the same
    // bytes are markup.
    const engine = stubEngine(async () => ({
      svg:
        '<svg><style>@im<title>x</title>port ' +
        '"https://evil.example/x.css";</style></svg>',
    }));
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    document.body.appendChild(preview.el);
    preview.render(DIAGRAM);
    await flush();

    const block = preview.el.querySelector('.note-mermaid')!;
    expect(block.querySelector('style')).toBeNull();
    expect(block.textContent).not.toContain('evil.example');

    preview.el.remove();
  });

  it('keeps the geometry and presentation attributes of a real diagram', async () => {
    // DOMPurify applies ALLOWED_URI_REGEXP to EVERY allowed attribute that is
    // not data-*/aria-*/URI-safe — `d`, `transform`, `viewBox`, `width`,
    // `fill` included — so a regexp narrowed to actual URL shapes silently
    // renders every diagram as an empty <svg>. Real mermaid cannot run under
    // jsdom, so this fixture stands in for its output.
    const engine = stubEngine(async () => ({
      svg:
        '<svg viewBox="0 0 120 40" width="120" height="40">' +
        '<g transform="translate(4,2)" class="node">' +
        '<path d="M0,0 L4,2 L0,4" fill="none" stroke-width="2" ' +
        'marker-end="url(#arrow)"/>' +
        '<rect x="0" y="0" rx="3" width="60" height="20"/>' +
        '<text text-anchor="middle" dy="0.3em">A</text></g></svg>',
    }));
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(DIAGRAM);
    await flush();

    const block = preview.el.querySelector('.note-mermaid')!;
    const svg = block.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 120 40');
    expect(svg.getAttribute('width')).toBe('120');
    expect(block.querySelector('g')?.getAttribute('transform')).toBe(
      'translate(4,2)',
    );
    const path = block.querySelector('path')!;
    expect(path.getAttribute('d')).toBe('M0,0 L4,2 L0,4');
    expect(path.getAttribute('fill')).toBe('none');
    expect(path.getAttribute('stroke-width')).toBe('2');
    expect(path.getAttribute('marker-end')).toBe('url(#arrow)');
    expect(block.querySelector('rect')?.getAttribute('rx')).toBe('3');
    expect(block.querySelector('text')?.getAttribute('text-anchor')).toBe(
      'middle',
    );
  });

  it('strips an unterminated config directive, which mermaid still reads', async () => {
    // Mermaid's own directive regex ends in `(?:}%{2})?` — the closing `}%%`
    // is optional, so a strip that requires it leaves a live carrier behind.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\n%%{init: {"themeCSS": "body{display:none}"}\nflowchart LR\n  A-->B\n```',
    );
    await flush();

    const [, source] = vi.mocked(engine.render).mock.calls[0];
    expect(source).not.toContain('themeCSS');
  });

  it('drops front matter whose config key is quoted', async () => {
    // YAML can spell the key several ways, so front matter goes whole.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\n---\n"config":\n  themeCSS: "body{display:none}"\n---\nflowchart LR\n  A-->B\n```',
    );
    await flush();

    const [, source] = vi.mocked(engine.render).mock.calls[0];
    expect(source).not.toContain('themeCSS');
    expect(source.trimStart().startsWith('flowchart LR')).toBe(true);
  });

  it('strips note-supplied config directives before rendering', async () => {
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\n%%{init: {"themeCSS": "body{display:none}"} }%%\nflowchart LR\n  A-->B\n```',
    );
    await flush();

    // A `%%{init}%%` directive would let a note push config (themeCSS lands in
    // the <style> block inside the SVG) into another user's page.
    const [, source] = vi.mocked(engine.render).mock.calls[0];
    expect(source).not.toContain('themeCSS');
    expect(source).toContain('flowchart LR');
  });

  it('renders labels as SVG text, not as an HTML subtree', async () => {
    // Issue #721: with HTML labels on, `A["<img src=…>"]` is laid out as a
    // <foreignObject> subtree in the live document while mermaid measures it,
    // so the URL is fetched — beaconing the reader's IP to the note's author —
    // before sanitizeSvg() ever runs. Only the engine config closes that.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(DIAGRAM);
    await flush();

    expect(engine.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ htmlLabels: false }),
    );
  });

  it('pins htmlLabels per diagram section as well as at the root', async () => {
    // A few renderers read `flowchart.htmlLabels` / `class.htmlLabels`
    // directly instead of through mermaid's root-first resolver, so the root
    // key alone leaves those paths resting on a per-diagram default.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(DIAGRAM);
    await flush();

    expect(engine.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        class: { htmlLabels: false },
      }),
    );
  });

  it('pins the config keys a directive could use to widen the engine', async () => {
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(DIAGRAM);
    await flush();

    const [config] = vi.mocked(engine.initialize).mock.calls[0] as [
      { secure: string[]; maxTextSize: number },
    ];
    // `dompurifyConfig` goes to mermaid's OWN label sanitizer, so a value
    // there (`ADD_TAGS: ['script']`) turns a surviving HTML label path from a
    // beacon into script execution. `flowchart`/`class` are pinned whole
    // because `secure` matches nested keys by name only at their own level.
    expect(config.secure).toContain('dompurifyConfig');
    expect(config.secure).toContain('htmlLabels');
    expect(config.secure).toContain('flowchart');
    expect(config.secure).toContain('class');
    expect(config.maxTextSize).toBe(MAX_FENCE_CHARS);
  });

  /**
   * Runs `body` against REAL mermaid. Two singletons have to be borrowed and
   * put back: jsdom implements no SVG measurement APIs (stubbing `getBBox` is
   * enough to run the engine's whole layout pass, which is what makes the case
   * below an outcome test rather than a config round-trip), and mermaid's
   * config is process-global — without `globalReset()` the config this leaves
   * behind would follow every later case in the file.
   */
  async function withRealEngine(
    body: (engine: MermaidLike, rawSvg: () => string) => Promise<void>,
  ): Promise<void> {
    const mermaid = (await import('mermaid')).default;
    const proto = SVGElement.prototype as unknown as Record<string, unknown>;
    const saved = {
      bbox: proto.getBBox,
      length: proto.getComputedTextLength,
    };
    proto.getBBox = () => ({ x: 0, y: 0, width: 40, height: 16 });
    proto.getComputedTextLength = () => 40;

    let raw = '';
    const engine: MermaidLike = {
      initialize: (config) => mermaid.initialize(config),
      render: async (id, text) => {
        const result = await mermaid.render(id, text);
        raw = result.svg;
        return result;
      },
    };
    try {
      await body(engine, () => raw);
    } finally {
      proto.getBBox = saved.bbox;
      proto.getComputedTextLength = saved.length;
      mermaid.mermaidAPI.globalReset();
    }
  }

  it('lays a real diagram out with no HTML label subtree', async () => {
    // The cases above assert what we ASK the engine for. This one runs the
    // production config through REAL mermaid and asserts the outcome the fix
    // is actually about: no `<foreignObject>` is created while the engine lays
    // the diagram out in the live document, and the label's markup is text.
    // A rename, a dropped key, or an engine that stopped resolving labels
    // through it fails here while every stubbed case still passes.
    await withRealEngine(async (engine, rawSvg) => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      root.innerHTML = mermaidFenceHtml(
        'flowchart LR\n  A["<b>bold</b> label"] --> B\n',
        (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;'),
      );
      await renderMermaidBlocks(root, { load: async () => engine });

      // The engine's own serialized output, i.e. what it had just laid out in
      // the live document — upstream of sanitizeSvg().
      expect(rawSvg()).toContain('<svg');
      expect(rawSvg()).not.toContain('foreignObject');
      expect(root.querySelector('.note-mermaid svg text')).toBeTruthy();
      expect(root.querySelector('.note-mermaid foreignObject')).toBeNull();
      root.remove();
    });
  });

  it('would have laid out an HTML label subtree without that key', async () => {
    // The control for the case above: the same engine, the same source, only
    // `htmlLabels` left at its default. Without this, a build in which no
    // label is ever an HTML subtree — a broken layout pass, say — would let
    // the assertion above pass for the wrong reason.
    await withRealEngine(async () => {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      const { svg } = await mermaid.render(
        'control-html-labels',
        'flowchart LR\n  A["<b>bold</b> label"] --> B\n',
      );
      expect(svg).toContain('foreignObject');
    });
  });

  it('refuses a fence whose shape metadata carries an image URL', async () => {
    // `htmlLabels: false` does not reach this one: mermaid's image shape does
    // `new Image(); img.src = node.img; await img.decode()` and appends an SVG
    // <image href> to the live layout host, with no label involved. Both
    // requests are gone by the time sanitizeSvg() runs, so the source is
    // refused instead.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\nflowchart LR\n  A@{ img: "https://evil.example/beacon.png" }\n```',
    );
    await flush();

    expect(engine.render).not.toHaveBeenCalled();
    const block = preview.el.querySelector('.note-mermaid')!;
    expect(block.getAttribute('data-mermaid-error')).toBe('true');
    expect(block.querySelector('.note-mermaid-message')?.textContent).toContain(
      'image shapes are not allowed',
    );
    // The source stays readable, the way an unparseable diagram does.
    expect(block.querySelector('.note-mermaid-source')?.textContent).toContain(
      'evil.example',
    );
  });

  it('refuses a fence carrying raw HTML that loads a URL', async () => {
    // The diagram types that emit a `foreignObject` regardless of
    // `htmlLabels` (venn, architecture, kanban, sequence) hand their label to
    // mermaid's own sanitizer, whose DEFAULT allowlist permits `<img src>` —
    // so a raw <img> in one of those labels is still laid out, and fetched, in
    // the live document. Refusing the source covers every label path at once.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\nsequenceDiagram\n  A->>B: <img src="https://evil.example/b.png">\n```',
    );
    await flush();

    expect(engine.render).not.toHaveBeenCalled();
    expect(
      preview.el.querySelector('.note-mermaid-message')?.textContent,
    ).toContain('HTML that loads a URL is not allowed');
  });

  it('refuses a fence whose CSS loads an external URL', async () => {
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\nflowchart LR\n  A-->B\n' +
        '  style A background:url("https://evil.example/b.png")\n```',
    );
    await flush();

    expect(engine.render).not.toHaveBeenCalled();
    expect(
      preview.el.querySelector('.note-mermaid-message')?.textContent,
    ).toContain('CSS that loads a URL is not allowed');
  });

  it('still renders the label markup that reaches no network', async () => {
    // The guard is a tag-name list, not "no raw HTML": `<br/>`, `<b>` and the
    // class-diagram arrows have to keep working, `url(#id)` is how mermaid
    // references its own markers, and a prose label that happens to say
    // `image(s)` is not a CSS fetch.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\nflowchart LR\n  A["<b>x</b><br/>Resize image(s)"] --> B\n' +
        '  style A fill:url(#grad)\n```\n\n' +
        '```mermaid\nclassDiagram\n  A <|-- B : <i>label</i>\n```',
    );
    await flush();

    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(preview.el.querySelector('.note-mermaid-message')).toBeNull();
    expect(preview.el.querySelectorAll('.note-mermaid svg').length).toBe(2);
  });

  it('refuses a fence longer than the engine bound rather than scanning it', async () => {
    // Nothing upstream caps a fence body, and mermaid's own `maxTextSize` is
    // enforced INSIDE render() — after every scan and strip here has already
    // run on the whole thing. The cap is what bounds that work.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    const body = `flowchart LR\n${'  A-->B\n'.repeat(8000)}`;
    expect(body.length).toBeGreaterThan(MAX_FENCE_CHARS);
    preview.render(`\`\`\`mermaid\n${body}\`\`\``);
    await flush();

    expect(engine.render).not.toHaveBeenCalled();
    expect(
      preview.el.querySelector('.note-mermaid-message')?.textContent,
    ).toContain('longer than');
  });

  it('refuses a fence that stacks more carriers than the strip bound', async () => {
    // Each strip pass removes at most ONE leading front-matter block while
    // rescanning the whole body, so an unbounded fixpoint loop is quadratic in
    // a hostile fence — a stored main-thread freeze for every reader. The pass
    // bound turns that into a refusal; a diagram needs one pass, or two when
    // it is front-matter-titled.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\n' +
        '---\nx: 1\n---\n'.repeat(40) +
        'flowchart LR\n  A-->B\n```',
    );
    await flush();

    expect(engine.render).not.toHaveBeenCalled();
    expect(
      preview.el.querySelector('.note-mermaid-message')?.textContent,
    ).toContain('too many stacked config directives');
  });

  it('strips a second front matter block the first strip would promote', async () => {
    // The front-matter pattern is ^-anchored, so a single pass removes block
    // one and PROMOTES block two into the leading position mermaid parses —
    // manufacturing a carrier the source did not have. Stripping runs to a
    // fixpoint instead.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\n---\ntitle: FIRST\n---\n---\nconfig:\n  themeCSS: "body{display:none}"\n---\nflowchart LR\n  A-->B\n```',
    );
    await flush();

    const [, source] = vi.mocked(engine.render).mock.calls[0];
    expect(source).not.toContain('themeCSS');
    expect(source).not.toContain('FIRST');
    expect(source.trimStart().startsWith('flowchart LR')).toBe(true);
  });

  it('strips front matter a directive strip promotes to leading', async () => {
    // The same promotion across carrier kinds. Mermaid extracts front matter
    // BEFORE removing directives, so it never reads a `---` block that a
    // directive precedes — but our strip hands it text where that block leads.
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\n%%{init: {"theme": "dark"} }%%---\nconfig:\n  themeCSS: "body{display:none}"\n---\nflowchart LR\n  A-->B\n```',
    );
    await flush();

    const [, source] = vi.mocked(engine.render).mock.calls[0];
    expect(source).not.toContain('themeCSS');
    expect(source.trimStart().startsWith('flowchart LR')).toBe(true);
  });

  it('drops a config-bearing front matter block too', async () => {
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(
      '```mermaid\n---\nconfig:\n  themeCSS: "body{display:none}"\n---\nflowchart LR\n  A-->B\n```',
    );
    await flush();

    const [, source] = vi.mocked(engine.render).mock.calls[0];
    expect(source).not.toContain('themeCSS');
    expect(source.trimStart().startsWith('flowchart LR')).toBe(true);
  });

  it('abandons a pass whose placeholders a newer render replaced', async () => {
    // The engine resolves only once we let it, so the first pass is still
    // waiting on the import when the preview re-renders.
    let releaseLoad: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const engine = stubEngine();
    const preview = new NotePreview({
      mermaidLoader: async () => {
        await gate;
        return engine;
      },
    });

    preview.render(DIAGRAM);
    const stale = preview.el.querySelector('.note-mermaid')!;
    // Let the first pass start and park on the gated load before re-rendering.
    await Promise.resolve();
    await Promise.resolve();
    preview.render('```mermaid\nflowchart TD\n  A --> B\n```');
    releaseLoad!();
    await flush();

    // Only the surviving placeholder is rendered: the superseded pass neither
    // paints into its detached block nor burns a layout pass on it.
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(engine.render).toHaveBeenCalledWith(
      expect.any(String),
      'flowchart TD\n  A --> B\n',
    );
    expect(stale.querySelector('svg')).toBeNull();
    expect(preview.el.querySelectorAll('.note-mermaid svg').length).toBe(1);
  });

  it('never runs two engine renders concurrently', async () => {
    let active = 0;
    let peak = 0;
    let calls = 0;
    let releaseFirst: (() => void) | undefined;
    const firstRender = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const engine = stubEngine(async (_id, text) => {
      peak = Math.max(peak, ++active);
      // Hold the first diagram inside the engine, the way a real layout pass
      // occupies the main thread for tens of milliseconds.
      if (++calls === 1) await firstRender;
      active--;
      return { svg: `<svg data-len="${text.length}"></svg>` };
    });
    const preview = new NotePreview({ mermaidLoader: async () => engine });

    preview.render(DIAGRAM);
    await flush(); // the first pass is now parked inside mermaid.render

    // A keystroke outside the fence: the diagram is unchanged but not cached
    // yet (it is still rendering), so this pass wants it too.
    preview.render(`${DIAGRAM}\n\ntyping`);
    releaseFirst!();
    await flush();

    // Passes are serialized, so the second one starts after the first has
    // cached its result — one layout pass, never two at once.
    expect(peak).toBe(1);
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(preview.el.querySelector('.note-mermaid svg')).toBeTruthy();
  });

  it('keeps a reused diagram cached while transient ones churn through', async () => {
    const engine = stubEngine();
    const preview = new NotePreview({ mermaidLoader: async () => engine });
    preview.render(DIAGRAM);
    await flush();
    expect(engine.render).toHaveBeenCalledTimes(1);

    // Typing a second diagram produces one throwaway source per keystroke.
    // Eviction is least-recently-used, so the diagram that is looked up on
    // every pass stays cached instead of aging out by insertion order and
    // flashing back to its source.
    for (let i = 1; i <= 60; i++) {
      preview.render(`${DIAGRAM}\n\n\`\`\`mermaid\nflowchart TD\n  ${'A'.repeat(i)}\n\`\`\``);
      await flush();
      expect(preview.el.querySelector('.note-mermaid svg')).toBeTruthy();
    }

    // 1 (original) + 60 (transient) — the original was never re-rendered.
    expect(engine.render).toHaveBeenCalledTimes(61);
  });

  it('skips a placeholder detached while the engine was loading', async () => {
    // Direct pass, so the tree changes underneath it without a new render()
    // bumping the pass counter — the `root.contains(el)` guard is what has to
    // catch this one.
    const root = document.createElement('div');
    root.innerHTML =
      mermaidFenceHtml('flowchart LR\n  A-->B\n', (s) => s) +
      mermaidFenceHtml('flowchart TD\n  C-->D\n', (s) => s);
    const blocks = Array.from(root.querySelectorAll('.note-mermaid'));

    let releaseLoad: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const engine = stubEngine();
    const pass = renderMermaidBlocks(root, {
      load: async () => {
        await gate;
        return engine;
      },
    });
    blocks[0].remove();
    releaseLoad!();
    await pass;

    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(engine.render).toHaveBeenCalledWith(
      expect.any(String),
      'flowchart TD\n  C-->D\n',
    );
    expect(blocks[0].querySelector('svg')).toBeNull();
    expect(blocks[0].hasAttribute('data-mermaid-pending')).toBe(true);
    expect(blocks[1].querySelector('svg')).toBeTruthy();
  });

  it('seeds the mermaid palette from the constructor theme', async () => {
    const engine = stubEngine();
    const preview = new NotePreview({
      theme: 'dark',
      mermaidLoader: async () => engine,
    });
    preview.render(DIAGRAM);
    await flush();

    expect(engine.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark' }),
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
