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
 *
 * SECURITY: note content is untrusted (any workspace collaborator or
 * editor-role share-link visitor can write a fence, and it renders in someone
 * else's session), and this is the one place the preview assigns note-derived
 * markup with `innerHTML`. Three layers keep the preview's no-raw-HTML
 * posture instead of delegating it wholesale to the engine:
 *
 *   - `securityLevel: 'strict'` plus an extended `secure` key list, so
 *     mermaid sanitizes labels and ignores `click` directives.
 *   - `stripConfigDirectives()` removes `%%{init: ...}%%` directives and
 *     `config:`-bearing front matter from the fence body, so a note cannot
 *     push per-diagram config (notably `themeCSS`) into the `<style>` block
 *     mermaid emits. `securityLevel` is directive-protected; `themeCSS` and
 *     friends are only protected because we strip and pin them.
 *   - `sanitizeSvgMarkup()` re-parses the engine's output in an inert
 *     `<template>` and drops scripts, `on*` handlers, non-`#`/http(s) URL
 *     attributes and external CSS references before it reaches the live DOM.
 *
 * `securityLevel: 'sandbox'` (mermaid's own advice for untrusted input) is
 * deliberately not used: it wraps every diagram in an iframe, which breaks
 * sizing, text selection and the preview's light/dark surface. The app-side
 * sanitize pass above is the substitute — the engine's sanitizer is then
 * defense in depth rather than the only defense.
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
 * typed, and because passes are serialized (see `passChain`) a failure is a
 * deterministic property of the source rather than a concurrency artifact.
 *
 * Least-recently-used, not insertion-ordered: reads move the entry back to
 * the end. A stable diagram is looked up on every keystroke, so it survives
 * the flood of one-shot sources produced while an adjacent diagram is typed.
 */
const renderCache = new Map<string, Rendered>();
const RENDER_CACHE_LIMIT = 40;

let renderSeq = 0;

function touch(key: string, result: Rendered): void {
  renderCache.delete(key);
  renderCache.set(key, result);
}

function remember(key: string, result: Rendered): void {
  touch(key, result);
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
 * Config keys a `%%{init}%%` directive may not override. Mermaid strips only
 * the keys listed here, and its default list covers `securityLevel` but not
 * the theming keys, which reach the `<style>` element inside the emitted SVG.
 */
const SECURE_KEYS = [
  // mermaid's own defaults, repeated because `secure` replaces the list.
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
  // Theming/labels: note-controlled values here become document-scoped CSS.
  'theme',
  'themeCSS',
  'themeVariables',
  'fontFamily',
  'altFontFamily',
  'htmlLabels',
  'layout',
  'look',
];

/** `%%{init: {...}}%%` (and `%%{wrap}%%`-style) per-diagram directives. */
const DIRECTIVE_RE = /%%\{[\s\S]*?\}%%/g;
/** Leading YAML front matter, which can also carry a `config:` block. */
const FRONTMATTER_RE = /^\s*-{3,}[ \t]*\r?\n([\s\S]*?)\r?\n-{3,}[ \t]*(?:\r?\n|$)/;

/**
 * Removes note-supplied mermaid configuration from a fence body. `secure`
 * blocks the keys above even if a directive slips through; this strips the
 * carrier itself so nothing depends on that list being exhaustive.
 */
export function stripConfigDirectives(source: string): string {
  let stripped = source.replace(DIRECTIVE_RE, '');
  const frontmatter = FRONTMATTER_RE.exec(stripped);
  if (frontmatter && /^\s*config\s*:/m.test(frontmatter[1])) {
    stripped = stripped.slice(frontmatter[0].length);
  }
  return stripped;
}

const SAFE_URL_RE = /^(?:#|https?:\/\/|mailto:)/i;
/** Never legitimate inside a mermaid diagram; script-capable if present. */
const DROPPED_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'link',
  'base',
  'meta',
  'form',
  // SMIL animation can retarget `href` to a javascript: URL after parsing.
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'handler',
]);
const URL_ATTRS = new Set(['href', 'xlink:href', 'src', 'action', 'formaction']);

/** Drops `@import` and off-page `url(...)` (beacon / external asset) refs. */
function scrubCss(css: string): string {
  return css
    .replace(/@import[^;}]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none');
}

/**
 * Re-parses engine output in an inert `<template>` and removes anything that
 * could execute or phone home, so the `innerHTML` assignment in `apply()`
 * does not rest on the engine's sanitizer alone.
 */
export function sanitizeSvgMarkup(svg: string): string {
  const template = document.createElement('template');
  // Parsed, never connected: `<script>` inside a template is inert, and no
  // resource in the fragment loads until it is adopted into the document.
  template.innerHTML = svg;
  for (const el of Array.from(template.content.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (DROPPED_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (tag === 'style') {
      el.textContent = scrubCss(el.textContent ?? '');
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (URL_ATTRS.has(name) && !SAFE_URL_RE.test(attr.value.trim())) {
        el.removeAttribute(attr.name);
      } else if (name === 'style') {
        el.setAttribute(attr.name, scrubCss(attr.value));
      }
    }
  }
  return template.innerHTML;
}

/**
 * Per-root pass counter. `render()` bumps it, so a pass that was already
 * awaiting the engine (or a diagram) when the preview re-rendered stops
 * instead of racing the newer pass for the same DOM.
 */
const passSeq = new WeakMap<Element, number>();

/**
 * All passes run through one chain. Mermaid's config (including the palette)
 * and its layout engine are process-global singletons, so overlapping passes
 * would both `initialize()` and `render()` against the same global state —
 * one diagram rendered under the other pass's theme, then cached under this
 * pass's theme key. Serializing also bounds concurrency to a single
 * `mermaid.render()` no matter how fast the user types.
 */
let passChain: Promise<void> = Promise.resolve();

type PendingBlock = { el: Element; source: string; key: string };

/**
 * Applies cached outcomes in place (synchronously, so typing beside a rendered
 * diagram never flashes back to source) and returns the placeholders that
 * still need the engine.
 */
function collectPending(root: Element, theme: MermaidTheme): PendingBlock[] {
  const pending: PendingBlock[] = [];
  for (const el of Array.from(root.querySelectorAll(PENDING_SELECTOR))) {
    const source = el.querySelector(`.${SOURCE_CLASS}`)?.textContent ?? '';
    const key = `${theme} ${source}`;
    const cached = renderCache.get(key);
    if (cached) {
      touch(key, cached);
      apply(el, cached);
      continue;
    }
    pending.push({ el, source, key });
  }
  return pending;
}

/**
 * Renders every pending mermaid placeholder under `root`.
 *
 * Safe to call on every keystroke: cached outcomes land before the returned
 * promise is even created, the engine work is serialized against every other
 * pass, and a pass superseded by a newer `render()` abandons its remaining
 * diagrams. The returned promise never rejects — per-diagram failures become
 * an error label on the block.
 */
export function renderMermaidBlocks(
  root: Element,
  options: { theme?: MermaidTheme; load?: MermaidLoader } = {},
): Promise<void> {
  const theme = options.theme ?? 'default';
  const load = options.load ?? loadMermaid;

  // Bumped even when nothing is pending: a re-render with no fence still means
  // the placeholders an in-flight pass holds are detached and stale.
  const generation = (passSeq.get(root) ?? 0) + 1;
  passSeq.set(root, generation);

  const pending = collectPending(root, theme);
  if (pending.length === 0) return Promise.resolve();

  const run = passChain
    .then(() => renderPass(root, generation, pending, theme, load))
    .catch(() => {
      // Nothing here is recoverable and the chain must survive for the next
      // pass; per-diagram errors are already reported on the block itself.
    });
  passChain = run;
  return run;
}

async function renderPass(
  root: Element,
  generation: number,
  pending: PendingBlock[],
  theme: MermaidTheme,
  load: MermaidLoader,
): Promise<void> {
  const superseded = () => passSeq.get(root) !== generation;
  if (superseded()) return;

  const mermaid = await load();
  if (!mermaid || superseded()) return;

  if (initializedTheme !== theme) {
    // `startOnLoad: false`: the preview drives rendering itself rather than
    // letting mermaid scan the whole document. `securityLevel: 'strict'` plus
    // the extended `secure` list keeps the preview's no-raw-HTML posture (see
    // the SECURITY note at the top of this file).
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      secure: SECURE_KEYS,
      theme,
    });
    initializedTheme = theme;
  }

  for (const { el, source, key } of pending) {
    // A newer render() owns the preview's DOM now; stop rather than paint into
    // a replaced tree or cache a diagram under a stale theme.
    if (superseded()) return;
    // Belt and braces: this placeholder alone was detached (e.g. a caller
    // mutated the tree without going through render()).
    if (!root.contains(el)) continue;

    // An earlier pass may have rendered this very source after we collected
    // (the same diagram gets a fresh placeholder on every keystroke), so look
    // again rather than paying for a second identical layout.
    const cached = renderCache.get(key);
    if (cached) {
      touch(key, cached);
      apply(el, cached);
      continue;
    }

    const id = `note-mermaid-${++renderSeq}`;
    let result: Rendered;
    try {
      const { svg } = await mermaid.render(id, stripConfigDirectives(source));
      result = { svg: sanitizeSvgMarkup(svg) };
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
    if (!superseded() && root.contains(el)) apply(el, result);
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
  passChain = Promise.resolve();
}
