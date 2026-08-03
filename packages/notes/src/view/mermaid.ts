/**
 * Mermaid diagram support for the markdown preview (issue #625).
 *
 * A ` ```mermaid ` fence renders as a diagram instead of a code block, the
 * way GitHub / Obsidian / Notion render it. Two pieces:
 *
 *   1. `mermaidFenceHtml()` — the synchronous placeholder markdown-it emits.
 *      It carries the escaped source, so an unrendered (still loading) or
 *      unparseable diagram degrades to readable source rather than a blank
 *      block.
 *   2. `renderMermaidBlocks()` — the asynchronous pass that swaps those
 *      placeholders for SVG.
 *
 * Mermaid (~3 MB with its per-diagram-type module graph) is reached only
 * through `import('mermaid')` here, so a note without a mermaid fence never
 * downloads it.
 */

/** Mermaid palette, following the preview's light/dark surface. */
export type MermaidTheme = 'default' | 'dark';

/**
 * The subset of the mermaid module this file uses. Declared structurally so
 * mermaid's own (very large) config types stay out of the notes package's
 * public declarations, and so tests can supply a stub engine.
 */
export interface MermaidLike {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

/** Resolves the mermaid engine, or `null` when it cannot be loaded. */
export type MermaidLoader = () => Promise<MermaidLike | null>;

const BLOCK_CLASS = 'note-mermaid';
const SOURCE_CLASS = 'note-mermaid-source';
const MESSAGE_CLASS = 'note-mermaid-message';
const PENDING_ATTR = 'data-mermaid-pending';
const ERROR_ATTR = 'data-mermaid-error';

/** Selects placeholders that still need a render attempt. */
const PENDING_SELECTOR = `.${BLOCK_CLASS}[${PENDING_ATTR}]`;

type Rendered = { svg: string } | { error: string };

/**
 * Render outcomes keyed by `theme source`. The preview re-renders on every
 * keystroke in split mode, so without this the mermaid layout engine would
 * re-run for every diagram on the page per character typed. Failures are
 * cached too — a diagram is unparseable for most of the time it is being
 * typed. Bounded and insertion-ordered, so the oldest entries fall out first.
 */
const renderCache = new Map<string, Rendered>();
const RENDER_CACHE_LIMIT = 40;

let renderSeq = 0;

function remember(key: string, result: Rendered): void {
  renderCache.set(key, result);
  if (renderCache.size > RENDER_CACHE_LIMIT) {
    const oldest = renderCache.keys().next();
    if (!oldest.done) renderCache.delete(oldest.value);
  }
}

/**
 * The placeholder for one mermaid fence. `escape` is markdown-it's own
 * `escapeHtml`, passed in so this module stays free of a markdown-it import.
 */
export function mermaidFenceHtml(
  source: string,
  escape: (str: string) => string,
): string {
  return (
    `<div class="${BLOCK_CLASS}" ${PENDING_ATTR}="true">` +
    `<pre class="${SOURCE_CLASS}">${escape(source)}</pre>` +
    `</div>\n`
  );
}

let loaded: Promise<MermaidLike | null> | null = null;
let initializedTheme: MermaidTheme | null = null;

/**
 * Loads mermaid once per page. A failed load (offline, blocked chunk) resolves
 * to `null` and is not retried — the placeholders keep showing their source.
 */
const loadMermaid: MermaidLoader = () => {
  loaded ??= import('mermaid')
    .then((mod) => mod.default as unknown as MermaidLike)
    .catch(() => null);
  return loaded;
};

/**
 * Renders every pending mermaid placeholder under `root`.
 *
 * Cached outcomes are applied synchronously (before the first `await`), so
 * typing beside an already-rendered diagram does not flash back to source.
 * The rest wait on the lazily-imported engine; placeholders detached by a
 * newer `render()` in the meantime are skipped.
 */
export async function renderMermaidBlocks(
  root: Element,
  options: { theme?: MermaidTheme; load?: MermaidLoader } = {},
): Promise<void> {
  const theme = options.theme ?? 'default';
  const load = options.load ?? loadMermaid;

  const pending: Array<{ el: Element; source: string; key: string }> = [];
  for (const el of Array.from(root.querySelectorAll(PENDING_SELECTOR))) {
    const source = el.querySelector(`.${SOURCE_CLASS}`)?.textContent ?? '';
    const key = `${theme} ${source}`;
    const cached = renderCache.get(key);
    if (cached) {
      apply(el, cached);
      continue;
    }
    pending.push({ el, source, key });
  }
  if (pending.length === 0) return;

  const mermaid = await load();
  if (!mermaid) return;

  if (initializedTheme !== theme) {
    // `startOnLoad: false`: the preview drives rendering itself rather than
    // letting mermaid scan the whole document. `securityLevel: 'strict'`
    // keeps the preview's no-raw-HTML posture — mermaid sanitizes diagram
    // labels and ignores `click` directives, so a collaborator's note cannot
    // inject script through a diagram.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
    });
    initializedTheme = theme;
  }

  for (const { el, source, key } of pending) {
    // A newer render() replaced the preview's DOM while we were loading (the
    // placeholders it emitted are no longer under `root`); the fresh pass owns
    // these diagrams now.
    if (!root.contains(el)) continue;

    const id = `note-mermaid-${++renderSeq}`;
    let result: Rendered;
    try {
      result = { svg: (await mermaid.render(id, source)).svg };
    } catch (err) {
      result = {
        error:
          err instanceof Error && err.message
            ? `Diagram error: ${err.message}`
            : 'Diagram error',
      };
      // mermaid renders into a detached `d<id>` host element and only cleans
      // it up on success, so drop it here rather than leaking one node per
      // failed parse (a diagram is unparseable while it is being typed).
      document.getElementById(`d${id}`)?.remove();
    }
    remember(key, result);
    if (root.contains(el)) apply(el, result);
  }
}

function apply(el: Element, result: Rendered): void {
  el.removeAttribute(PENDING_ATTR);
  el.querySelector(`.${MESSAGE_CLASS}`)?.remove();
  if ('svg' in result) {
    el.removeAttribute(ERROR_ATTR);
    el.innerHTML = result.svg;
    return;
  }
  // Unparseable diagram: keep the escaped source visible and label it, the
  // way a fenced block with a syntax error still shows its text.
  el.setAttribute(ERROR_ATTR, 'true');
  const message = document.createElement('p');
  message.className = MESSAGE_CLASS;
  message.textContent = result.error;
  el.prepend(message);
}

/** Test seam: drops memoized engine, palette, and cache state between cases. */
export function resetMermaidStateForTests(): void {
  renderCache.clear();
  loaded = null;
  initializedTheme = null;
}
