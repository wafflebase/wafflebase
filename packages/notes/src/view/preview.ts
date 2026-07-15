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

// Read-only task-list checkboxes (`- [ ] foo` / `- [x] foo`): the preview is
// not editable, so checkboxes render disabled rather than interactive.
md.use(taskLists, { label: true, enabled: false });

// KaTeX math (`$inline$` and `$$block$$`).
md.use(katexPlugin);

/**
 * Code fences: reuses markdown-it's own `highlight` option (configured
 * above) but renders the block ourselves so we can guarantee the `hljs`
 * class (for the syntax palette in notes-preview.css) and inject a copy
 * button, matching CodePair's code-block affordances.
 */
md.renderer.rules.fence = (tokens, idx, options) => {
  const token = tokens[idx];
  const info = token.info ? md.utils.unescapeAll(token.info).trim() : '';
  const lang = info.split(/\s+/)[0] || '';
  const highlighted = options.highlight
    ? options.highlight(token.content, lang, '') ||
      md.utils.escapeHtml(token.content)
    : md.utils.escapeHtml(token.content);
  const langClass = lang ? ` language-${md.utils.escapeHtml(lang)}` : '';

  return (
    `<pre class="hljs note-code">` +
    `<button class="note-copy-btn" type="button" aria-label="Copy code">Copy</button>` +
    `<code class="hljs${langClass}">${highlighted}</code>` +
    `</pre>\n`
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

// Images load lazily and don't block the main thread while decoding.
const defaultImageRule = md.renderer.rules.image ?? defaultRenderToken;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet('loading', 'lazy');
  token.attrSet('decoding', 'async');
  return defaultImageRule(tokens, idx, options, env, self);
};

const COPY_BUTTON_SELECTOR = '.note-copy-btn';
const COPY_RESET_DELAY_MS = 1500;

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

  constructor() {
    this.el = document.createElement('div');
    this.el.dataset.role = 'note-preview';
    this.el.className = 'note-preview markdown-body';

    // One delegated listener survives `render()`'s innerHTML replacement, so
    // copy buttons work without per-render listener churn/leaks.
    this.el.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const button = target.closest(COPY_BUTTON_SELECTOR);
      if (!(button instanceof HTMLElement) || !this.el.contains(button))
        return;

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
  }

  render(markdown: string): void {
    this.el.innerHTML = md.render(markdown);
  }
}
