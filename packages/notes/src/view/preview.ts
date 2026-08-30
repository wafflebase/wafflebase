import MarkdownIt from 'markdown-it';
// `highlight.js/lib/common` (~35 commonly fenced languages: js/ts, python,
// bash, go, rust, java/c/c++/c#, ruby, php, sql, yaml, json, markdown, xml,
// css, etc.) instead of the full `highlight.js` package, which statically
// registers all ~190 bundled languages and would blow the frontend's
// per-chunk size budget (see harness.config.json `chunkBudgets`) for a
// notes-preview feature that only ever highlights one fence at a time.
import hljs from 'highlight.js/lib/common';
import taskLists from 'markdown-it-task-lists';
import katexPlugin from '@vscode/markdown-it-katex';
import { detailsPlugin } from './details-plugin.js';
import { imgPlugin } from './img-plugin.js';
import { listEmptyBulletPlugin } from './list-empty-bullet-plugin.js';
import {
  mermaidFenceHtml,
  renderMermaidBlocks,
  type MermaidLoader,
  type MermaidTheme,
} from './mermaid.js';

/** Class `markdown-it-task-lists` puts on a task `<li>`. */
const TASK_ITEM_CLASS = 'task-list-item';
/** Attribute carrying a task item's 0-based source line. */
const TASK_LINE_ATTR = 'data-source-line';
const TASK_CHECKBOX_SELECTOR = 'input.task-list-item-checkbox';

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  // Soft line breaks (single newline -> <br>), matching CodePair's behavior.
  breaks: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang, ignoreIllegals: true })
          .value;
      } catch {
        // Fall through: render as an unhighlighted, escaped code block.
      }
    }
    // Empty string signals "no highlighting" to our custom fence renderer
    // below, which falls back to escaping the raw content itself.
    return '';
  },
});

// Task-list checkboxes (`- [ ] foo` / `- [x] foo`). Rendered enabled so a
// preview wired with an `onToggleTask` callback can be ticked directly; a
// preview without one re-disables them after each render (see `render`).
//
// No `<label>` wrapper around the item text: the whole item is already a click
// target (`onTaskClick`), and a label would also forward its click to the
// checkbox inside it — the same tick reported twice. The accessible name a
// label would have given comes from an `aria-label` written in `render`
// instead, so a screen reader announces the item's own text either way.
md.use(taskLists, { enabled: true });

// Tag every task item with the source line its `- [ ]` sits on, so a click in
// the preview knows which line to flip. `list_item_open.map` is the item's
// source range and its first entry is that line (0-based).
md.core.ruler.push('note-task-source-line', (state) => {
  for (const token of state.tokens) {
    if (
      token.type === 'list_item_open' &&
      token.attrGet('class')?.includes(TASK_ITEM_CLASS) &&
      token.map
    ) {
      token.attrSet(TASK_LINE_ATTR, String(token.map[0]));
    }
  }
});

// KaTeX math (`$inline$` and `$$block$$`).
md.use(katexPlugin);

// Collapsible sections (`<details>` / `<summary>`). A narrow allowlist for
// just these two disclosure tags — keeps the preview's `html: false` posture
// (no arbitrary raw HTML) while supporting GitHub/MDN-style foldouts.
md.use(detailsPlugin);

// Sized images (`<img src="…" width="200">`). Markdown itself has no image
// sizing syntax, so this is the snippet people paste from GitHub; the same
// narrow-allowlist trick as `detailsPlugin` accepts it without opening the
// preview to raw HTML (issue #973).
md.use(imgPlugin);

// A lone empty bullet under a list item should nest as an empty child, not turn
// the line above it into a setext `<h2>` (issue #517).
md.use(listEmptyBulletPlugin);

/**
 * Code fences: reuses markdown-it's own `highlight` option (configured
 * above) but renders the block ourselves so we can guarantee the `hljs`
 * class (for the syntax palette in notes-preview.css) and inject a copy
 * button, matching CodePair's code-block affordances.
 *
 * The copy button is a child of a non-scrolling outer wrapper, NOT of the
 * `<pre>`: the `<pre>` is the horizontally-scrolling element, so anchoring
 * the button to it would make the button drift out of view when a long line
 * scrolls the block sideways. The wrapper is the positioning context; the
 * `<pre>` only owns overflow.
 *
 * A `mermaid` fence is not a code block at all: it emits a diagram
 * placeholder that `NotePreview.render()` fills in asynchronously (see
 * `mermaid.ts`).
 */
md.renderer.rules.fence = (tokens, idx, options) => {
  const token = tokens[idx];
  const info = token.info ? md.utils.unescapeAll(token.info).trim() : '';
  const lang = info.split(/\s+/)[0] || '';
  if (lang.toLowerCase() === 'mermaid') {
    return mermaidFenceHtml(token.content, md.utils.escapeHtml);
  }
  const highlighted = options.highlight
    ? options.highlight(token.content, lang, '') ||
      md.utils.escapeHtml(token.content)
    : md.utils.escapeHtml(token.content);
  const langClass = lang ? ` language-${md.utils.escapeHtml(lang)}` : '';

  return (
    `<div class="note-code-wrapper">` +
    `<button class="note-copy-btn" type="button" aria-label="Copy code">Copy</button>` +
    `<pre class="hljs note-code">` +
    `<code class="hljs${langClass}">${highlighted}</code>` +
    `</pre>` +
    `</div>\n`
  );
};

// `markdown-it`'s default export is a synthesized-default `export =` class,
// so its merged `MarkdownIt.Renderer.RenderRule` namespace type isn't
// reachable through the value import above; derive the render-rule type
// from the (statically typed) `rules` record instead.
type RenderRule = NonNullable<typeof md.renderer.rules.fence>;

const defaultRenderToken: RenderRule = (tokens, idx, options, _env, self) =>
  self.renderToken(tokens, idx, options);

// External links (`http://` / `https://`) open in a new tab without handing
// the new page a `window.opener` reference back into the note.
const defaultLinkOpen = md.renderer.rules.link_open ?? defaultRenderToken;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href');
  if (href && /^https?:\/\//.test(href)) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/**
 * Maps a note's stored image `src` to the URL actually fetched. Identity by
 * default; a shared-link mount installs a resolver that appends its `?token=`
 * to workspace image URLs so anonymous viewers can load them.
 *
 * The `src` lives in the note's markdown inside the CRDT, so it is shared with
 * every other viewer and the author and cannot itself carry a per-viewer
 * token — it has to be applied at render time. Mirrors the slides seam in
 * `packages/slides/src/view/canvas/image-cache.ts`.
 */
let imageUrlResolver: (src: string) => string = (s) => s;

/**
 * Install (or clear, with `null`) the src → fetch-URL resolver for every
 * preview in this process. The resolver must be idempotent and leave
 * non-workspace URLs (`data:`, `blob:`, external) untouched. Set on a
 * shared-link mount, cleared on unmount.
 *
 * Module-level rather than a `NotePreview` option because the `markdown-it`
 * instance the render rules hang off is itself module-level, and because a
 * shared mount wants every preview it renders tokened without threading the
 * token through each construction site.
 */
export function setImageUrlResolver(
  resolver: ((src: string) => string) | null,
): void {
  imageUrlResolver = resolver ?? ((s) => s);
}

// Images load lazily and don't block the main thread while decoding, and
// their `src` goes through the resolver above.
const defaultImageRule = md.renderer.rules.image ?? defaultRenderToken;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet('loading', 'lazy');
  token.attrSet('decoding', 'async');
  // Tokens are re-parsed from source on every `render()`, so the value read
  // here is always the stored src rather than one this rule already resolved
  // — the resolver never compounds, and a changed token takes effect on the
  // next render. `defaultImageRule` escapes whatever we write.
  const src = token.attrGet('src');
  if (src !== null) token.attrSet('src', imageUrlResolver(src));
  return defaultImageRule(tokens, idx, options, env, self);
};

const COPY_BUTTON_SELECTOR = '.note-copy-btn';
const COPY_RESET_DELAY_MS = 1500;

/**
 * Whether a live text selection covers any part of `item`.
 *
 * A plain click collapses the selection on mousedown, so a non-collapsed range
 * still standing when the `click` arrives means the pointer was dragging over
 * text — a read/copy gesture, not a tick.
 */
function selectionTouches(item: Element): boolean {
  const selection = item.ownerDocument.defaultView?.getSelection?.();
  if (!selection || selection.isCollapsed) return false;
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    if (range.collapsed) continue;
    const container = range.commonAncestorContainer;
    // Inside the item, or spanning it (the selection's common ancestor is then
    // one of the item's own ancestors).
    if (item.contains(container) || container.contains(item)) return true;
  }
  return false;
}

/**
 * The text of the task item `checkbox` belongs to, for its accessible name.
 *
 * Only the item's own text counts: a task with a nested list under it would
 * otherwise be announced together with every one of its children, so the walk
 * stops at the first nested list.
 */
function taskItemText(checkbox: Element): string {
  const item = checkbox.closest(`.${TASK_ITEM_CLASS}`);
  if (!item) return '';
  let text = '';
  for (const node of item.childNodes) {
    if (node instanceof Element && /^(UL|OL)$/.test(node.tagName)) break;
    text += node.textContent ?? '';
  }
  return text.trim();
}

/**
 * A lightweight, framework-free markdown preview pane. Renders `markdown-it`
 * HTML into a container element on demand.
 *
 * SECURITY: `html: false` is deliberate. Enabling raw inline HTML in a
 * collaborator's note is a stored-XSS vector (any workspace member could
 * embed `<script>`/event-handler HTML that runs in another member's
 * session), so this preview never renders raw HTML from note content. This
 * is an intentional deviation from CodePair, which used `html: true` plus a
 * sanitizer step; Wafflebase opts to never construct the sanitize-or-be-
 * vulnerable trade-off in the first place.
 */
export class NotePreview {
  readonly el: HTMLDivElement;

  /** Mermaid palette, kept in step with the editor's light/dark theme. */
  private mermaidTheme: MermaidTheme;

  /** Injectable in tests; production uses `mermaid.ts`'s lazy import. */
  private readonly mermaidLoader: MermaidLoader | undefined;

  /**
   * Writes a task item's new checked state back to the source. Absent (a
   * read-only mount) makes the rendered checkboxes inert.
   */
  private readonly onToggleTask:
    | ((line: number, checked: boolean) => void)
    | undefined;

  constructor(
    options: {
      theme?: 'light' | 'dark';
      mermaidLoader?: MermaidLoader;
      onToggleTask?: (line: number, checked: boolean) => void;
    } = {},
  ) {
    this.mermaidTheme = options.theme === 'dark' ? 'dark' : 'default';
    this.mermaidLoader = options.mermaidLoader;
    this.onToggleTask = options.onToggleTask;

    this.el = document.createElement('div');
    this.el.dataset.role = 'note-preview';
    // The interactive marker is what the stylesheet keys the task item's
    // pointer cursor off — the class is on the root, so it says "this preview
    // can be ticked" without a selector that has to inspect each checkbox.
    this.el.className = `note-preview markdown-body${
      this.onToggleTask ? ' note-tasks-interactive' : ''
    }`;

    // One delegated listener survives `render()`'s innerHTML replacement, so
    // copy buttons work without per-render listener churn/leaks.
    this.el.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const button = target.closest(COPY_BUTTON_SELECTOR);
      if (!(button instanceof HTMLElement) || !this.el.contains(button)) return;

      const code = button.parentElement?.querySelector('code');
      const text = code?.textContent ?? '';
      if (!navigator.clipboard?.writeText) return;

      navigator.clipboard
        .writeText(text)
        .then(() => {
          const original = button.textContent;
          button.textContent = 'Copied';
          setTimeout(() => {
            button.textContent = original;
          }, COPY_RESET_DELAY_MS);
        })
        .catch(() => {
          // Clipboard write can fail (permissions, insecure context); the
          // button simply stays as "Copy" and the user can select manually.
        });
    });

    // Click-to-toggle for task items, delegated for the same reason. The whole
    // item is the target — the checkbox and the text beside it — so a task can
    // be ticked without hitting the small box, which matters most on touch.
    if (this.onToggleTask) this.el.addEventListener('click', this.onTaskClick);
  }

  /**
   * Toggle the task item a click landed in. Clicks on a link or button inside
   * the item belong to that control, not to the checkbox.
   *
   * The DOM is not updated here: the callback rewrites the source line, and
   * the resulting document change re-renders the preview from it. That keeps
   * the checkbox showing what the note actually says, including when a peer
   * ticks the same item concurrently.
   */
  private readonly onTaskClick = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const item = target.closest(`.${TASK_ITEM_CLASS}`);
    if (!item || !this.el.contains(item)) return;
    // Controls that own their own click. `details` matters here because the
    // preview renders foldouts, and one nested in a task item would otherwise
    // be cancelled below — the disclosure would not open and the click would
    // rewrite the source line instead. The whole disclosure is exempt, not
    // just its `summary`: its body is content of its own, and a click there
    // points at no task either.
    //
    // It has to be a control INSIDE the item, though. A task list nested in a
    // foldout body puts the `details` *above* the item, where `closest()`
    // finds it just the same — bailing there would make every task inside a
    // foldout dead, and (since this is before the cancel below) leave its box
    // flipped against a source that never changed.
    const control = target.closest('a, button, details');
    if (control && item.contains(control)) return;
    const checkbox = item.querySelector(TASK_CHECKBOX_SELECTOR);
    if (!(checkbox instanceof HTMLInputElement)) return;
    const onCheckbox = checkbox.contains(target);

    // The browser has already flipped a real checkbox by the time this runs,
    // and only cancelling reverts it. Cancel before the guards below: any of
    // them bailing would otherwise leave the preview showing a state the note
    // does not have, with no re-render to correct it (the preview repaints on
    // `docChanged`, and a bail-out changes no document).
    if (onCheckbox) e.preventDefault();

    // A repeated click is a selection gesture — double-click selects a word,
    // triple-click the line — and browsers still deliver a `click` for each.
    // Selecting a task's text must not rewrite it. A click landing on the
    // checkbox itself is never such a gesture, though, and dropping it would
    // swallow a quick tick-then-untick.
    if (!onCheckbox && e.detail > 1) return;
    // A nested list item under a task owns its own text; `closest()` would
    // otherwise resolve a click on a plain child bullet to the ancestor task
    // and tick a line the user never pointed at.
    const clickedItem = target.closest('li');
    if (clickedItem && clickedItem !== item) return;
    // The `click` that ends a drag-select lands here too, so a user merely
    // selecting a task's text (to read or copy it) would silently rewrite the
    // source line and sync that edit to peers.
    if (!onCheckbox && selectionTouches(item)) return;

    // A missing (or blank) attribute must not be read as line 0: `Number(null)`
    // and `Number('')` are both 0, which passes the integer guard and would
    // flip whatever task sits on the note's first line instead.
    const raw = item.getAttribute(TASK_LINE_ATTR);
    const line = raw !== null && raw.trim() !== '' ? Number(raw) : Number.NaN;
    if (!Number.isInteger(line) || line < 0) return;

    // A click on the checkbox itself has already flipped `checked` (the
    // cancellation above only takes effect once dispatch finishes); anywhere
    // else in the item leaves it as rendered, so read the intent from the
    // element the click landed on.
    const checked = onCheckbox ? checkbox.checked : !checkbox.checked;
    e.preventDefault();
    this.onToggleTask?.(line, checked);
  };

  /**
   * Switches the mermaid palette. Diagrams already on screen keep their old
   * palette until the next `render()`, which the caller (the editor's
   * `setTheme`) triggers.
   */
  setTheme(mode: 'light' | 'dark'): void {
    this.mermaidTheme = mode === 'dark' ? 'dark' : 'default';
  }

  render(markdown: string): void {
    this.el.innerHTML = md.render(markdown);
    for (const box of this.el.querySelectorAll(TASK_CHECKBOX_SELECTOR)) {
      // Without a way to write the change back (a read-only mount), the
      // checkboxes are display only — disabled rather than clickable-looking.
      if (!this.onToggleTask) box.setAttribute('disabled', '');
      // An unlabelled checkbox is announced as just "checkbox", which tells a
      // screen-reader user nothing about which task it is — and a read-only
      // viewer, who cannot tick anything, has only the name to go on.
      const name = taskItemText(box);
      if (name) box.setAttribute('aria-label', name);
    }
    // Mermaid diagrams render asynchronously (the engine is lazily imported);
    // cached ones land inside this call, the rest arrive shortly after.
    //
    // This is called once per keystroke in split mode and needs no debounce
    // here: `renderMermaidBlocks` bumps a per-root pass counter and runs every
    // pass through one chain, so passes never overlap (at most one
    // `mermaid.render()` in flight) and a pass this call supersedes abandons
    // its remaining diagrams. Errors are reported on the block itself and the
    // returned promise never rejects, so there is nothing to handle here.
    void renderMermaidBlocks(this.el, {
      theme: this.mermaidTheme,
      load: this.mermaidLoader,
    });
  }
}
