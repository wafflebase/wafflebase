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
 *   - `stripConfigDirectives()` removes the two config carriers — `%%{...}%%`
 *     directives and leading front matter — from the fence body, so a note
 *     cannot push per-diagram config (notably `themeCSS`) into the `<style>`
 *     block mermaid emits. It uses mermaid's own carrier patterns, because
 *     `secure` only pins TOP-LEVEL keys: anything the strip misses but the
 *     engine still recognizes reaches the config as a nested override.
 *     `securityLevel` is directive-protected by mermaid itself; `themeCSS`
 *     and friends are only protected because we strip and pin them.
 *   - `sanitizeSvg()` runs the engine's output through DOMPurify (allowlist,
 *     SVG+HTML profiles) and hands `apply()` a `DocumentFragment`, so the tree
 *     that was inspected is the tree that reaches the document — no
 *     re-serialize/re-parse step for a mutation-XSS gap to open in.
 *
 * `securityLevel: 'sandbox'` (mermaid's own advice for untrusted input) is
 * deliberately not used: it wraps every diagram in an iframe, which breaks
 * sizing, text selection and the preview's light/dark surface. Be precise
 * about what that costs, because layer 3 is NOT an equivalent substitute:
 * outside sandbox mode `mermaid.render()` appends its own `d<id>` host div to
 * `document.body`, lays the diagram out there (it needs a rendered box to
 * measure text), and only then serializes it — so the engine's output exists
 * in the reader's live document *before* `sanitizeSvg()` ever sees it. What
 * guards that window is mermaid's own strict-mode sanitizing (the engine
 * DOMPurifies label content as it builds the tree) plus layer 2 stripping the
 * carriers a note could steer the engine with; layer 3 governs what *persists*
 * in the preview, and is defense in depth over the engine's own final
 * DOMPurify pass. Sandbox mode remains the only way to close the layout
 * window itself, and that trade is knowingly taken.
 */

import type { Config as PurifyConfig, DOMPurify as Purifier } from 'dompurify';

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

/**
 * A rendered diagram is kept as a sanitized `DocumentFragment`, never as
 * markup: `apply()` inserts a clone of it. See `sanitizeSvg()`.
 */
type Rendered = { node: DocumentFragment } | { error: string };

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

let purifier: Promise<Purifier | null> | null = null;

/**
 * DOMPurify is loaded next to the engine rather than statically, so a note
 * with no mermaid fence still downloads neither (mermaid depends on DOMPurify
 * itself, so this costs no bytes a diagram was not already paying for). A
 * failed load resolves to `null` and no diagram renders — the placeholders
 * keep showing their source, which is the same degradation as a failed engine
 * load and strictly better than painting unsanitized markup.
 */
function loadPurifier(): Promise<Purifier | null> {
  purifier ??= import('dompurify').then((mod) => mod.default).catch(() => null);
  return purifier;
}

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

/**
 * The mermaid release the carrier patterns below were copied from. They are
 * verbatim copies of a NON-EXPORTED upstream module, so nothing here can be
 * derived from the installed engine at runtime, and `mermaid: ^11.16.0` lets a
 * routine minor/patch upgrade move the patterns while these copies stay put —
 * exactly the drift that leaves a live carrier behind.
 *
 * `preview.test.ts` asserts this equals the installed `mermaid` version, so an
 * upgrade fails the suite until someone re-diffs `src/utils/regexes.ts` and
 * moves this constant.
 */
export const MERMAID_CARRIER_PATTERNS_VERSION = '11.16.0';

/**
 * Mermaid's own carrier patterns, copied verbatim from its `src/utils/regexes.ts`
 * (`directiveRegex` / `frontMatterRegex`, mermaid
 * `MERMAID_CARRIER_PATTERNS_VERSION`). Recognizing LESS than the engine does is
 * the whole failure mode here — a carrier we leave in place is one the engine
 * still reads. Note in particular that the closing
 * `}%%` of a directive is OPTIONAL for mermaid, so an unterminated `%%{init:`
 * runs to the end of the diagram; matching that exactly means an unterminated
 * directive is stripped exactly as far as mermaid would have read it.
 */
const DIRECTIVE_RE =
  /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;
const FRONTMATTER_RE = /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/s;

/**
 * Removes note-supplied mermaid configuration from a fence body. `secure`
 * blocks the keys listed above, but only at the TOP level of the config, so a
 * carrier that survives here can still deliver a nested override; this strips
 * the carriers themselves rather than depending on that list.
 *
 * Front matter goes first (mermaid's own preprocess order) and goes
 * unconditionally: it is dropped whether or not it looks like it carries
 * `config:`, because YAML can spell that key in more ways than a regex can
 * enumerate (`"config":`, `'config':`, `? config`, aliases). The cost is
 * mermaid's front-matter `title:`/`displayMode:`, which the preview does not
 * advertise; the alternative is a rule that can be spelled around.
 */
export function stripConfigDirectives(source: string): string {
  return source.replace(FRONTMATTER_RE, '').replace(DIRECTIVE_RE, '');
}

const PURIFY_CONFIG: PurifyConfig & { RETURN_DOM_FRAGMENT: true } = {
  // SVG (+ filters) for the diagram, HTML for the `<foreignObject>` label
  // subtree mermaid emits for html-label diagram types.
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  // DOMPurify excludes both by default because they are namespace-confusion
  // and external-reference carriers in a sanitize-to-STRING pipeline. Mermaid
  // needs them (labels are `<foreignObject>` subtrees, markers/icons are
  // `<use>` references), and this pipeline returns nodes, so the serialize →
  // re-parse step those attacks depend on never happens. `use` is still held
  // to `ALLOWED_URI_REGEXP` below, which is the same allowlist every other
  // reference in the tree answers to.
  ADD_TAGS: ['foreignobject', 'use'],
  // `<foreignObject>` is an HTML integration point per the HTML spec, so the
  // label subtree inside it is HTML and is checked against the HTML profile.
  // DOMPurify's default map omits it only because it excludes the tag itself.
  HTML_INTEGRATION_POINTS: { foreignobject: true, 'annotation-xml': true },
  // Fetch carriers on top of DOMPurify's own denylist. None of these appear in
  // mermaid output, and each would let note-derived markup pull a URL — an
  // IP-logging beacon — into every reader's page.
  FORBID_TAGS: ['img', 'image', 'audio', 'video', 'source', 'track', 'input'],
  FORBID_ATTR: ['ping', 'srcset', 'background', 'lowsrc', 'dynsrc'],
  // DOMPurify's default URI allowlist with the scheme list narrowed to what a
  // diagram needs: it links out (`http(s)`, `mailto:`) or within itself (`#`,
  // which the `[^a-z]` branch covers), and nothing else — no `ftp`/`tel`/
  // `callto`/`sms`/`cid`/`xmpp`/`matrix`.
  //
  // The two trailing branches are the default's own, and are NOT optional:
  // DOMPurify applies this regexp to the value of every allowed attribute that
  // is not `data-*`/`aria-*`/URI-safe, not just to the ones that hold a URL.
  // They are what lets a non-URI value through — `d="M0,0 L4,2"`,
  // `transform="translate(4,2)"`, `fill="none"`, `width="120"`, `viewBox`.
  // Dropping them strips a real diagram down to an empty `<svg>`. They still
  // reject anything carrying a scheme, `javascript:` and `data:` included,
  // because `[a-z+.\-]+` must be followed by a character that is not `:`.
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  // Nodes, not markup — see `sanitizeSvg()`.
  RETURN_DOM_FRAGMENT: true,
};

/**
 * CSS constructs that fetch a URL. `url(#id)` is exempt: mermaid references
 * its own in-document markers and gradients that way.
 */
const CSS_EXTERNAL_RE =
  /@import|(?:image-set|image|src|cross-fade)\s*\(|url\(\s*['"]?\s*(?!#)/i;

/**
 * Resolves CSS escape sequences (`\40 import`, `\75 rl(...)`) so the check
 * below cannot be spelled around: the CSS parser resolves them, so a check
 * that reads the raw text sees a different stylesheet than the browser does.
 * Used for DETECTION only — the original text is what survives, because
 * decoding it would change what an escaped `}` or quote means.
 */
function decodeCssEscapes(css: string): string {
  return css.replace(
    /\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|([\s\S]))/gi,
    (_match, hex: string | undefined, char: string | undefined) => {
      if (hex === undefined) return char ?? '';
      const code = Number.parseInt(hex, 16);
      return String.fromCodePoint(
        code > 0x10ffff || code === 0 ? 0xfffd : code,
      );
    },
  );
}

function isSafeCss(css: string): boolean {
  return (
    !CSS_EXTERNAL_RE.test(css) && !CSS_EXTERNAL_RE.test(decodeCssEscapes(css))
  );
}

/**
 * Sanitizes engine output for the DOM. Layer 3 of the SECURITY note above.
 *
 * DOMPurify — allowlist-based, and already in this feature's dependency graph
 * because mermaid itself depends on it — does the element/attribute pass, and
 * the result is returned as a `DocumentFragment` that `apply()` inserts
 * directly. Deliberately NOT a string: sanitizing a tree and then
 * re-serializing it for `innerHTML` re-parses it, and the tree that was
 * inspected is then not the tree that reaches the document (mutation XSS).
 *
 * CSS is the one thing DOMPurify does not look inside, and an inline-SVG
 * `<style>` is document-scoped — a surviving `@import`/`url()` would restyle
 * the whole app or phone home from it. Mermaid namespaces its own rules under
 * the per-diagram `#id`, so an offending block is dropped whole rather than
 * patched: nothing legitimate needs the constructs being rejected.
 */
export function sanitizeSvg(purify: Purifier, svg: string): DocumentFragment {
  const fragment = purify.sanitize(svg, PURIFY_CONFIG);
  for (const el of Array.from(fragment.querySelectorAll('style'))) {
    // The browser builds the stylesheet from the element's *child text
    // content* — its direct `Text` children, concatenated — while
    // `textContent` concatenates every descendant's text. The two differ
    // exactly when a `<style>` has an element child, and this pipeline
    // manufactures that case: mermaid serializes an HTML-namespace raw-text
    // `<style>`, and DOMPurify re-parses it inside `<svg>`, where the same
    // bytes are markup. `@im<title>x</title>port` then reads as `@import` to
    // the CSS parser and as `@imxport` to the check below. Mermaid never emits
    // a `<style>` with an element child, so drop the block rather than trying
    // to reconcile the two readings.
    if (el.firstElementChild) {
      el.remove();
      continue;
    }
    if (!isSafeCss(el.textContent ?? '')) el.remove();
  }
  for (const el of Array.from(fragment.querySelectorAll('[style]'))) {
    if (!isSafeCss(el.getAttribute('style') ?? '')) el.removeAttribute('style');
  }
  return fragment;
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

  // The sanitizer is a hard requirement, not an enhancement: without it there
  // is nothing to paint engine output with.
  const [mermaid, purify] = await Promise.all([load(), loadPurifier()]);
  if (!mermaid || !purify || superseded()) return;

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
      result = { node: sanitizeSvg(purify, svg) };
    } catch (err) {
      result = {
        error:
          err instanceof Error && err.message
            ? `Diagram error: ${err.message}`
            : 'Diagram error',
      };
    } finally {
      // Outside sandbox mode mermaid lays the diagram out in a `d<id>` host
      // div it appends to `document.body` (see the SECURITY note above), and
      // removes it only on the success path. Clean up unconditionally: on a
      // failed parse it would otherwise leak one host — with the engine's
      // un-DOMPurified output still in it — per keystroke, since a diagram is
      // unparseable for most of the time it is being typed.
      document.getElementById(`d${id}`)?.remove();
    }
    remember(key, result);
    if (!superseded() && root.contains(el)) apply(el, result);
  }
}

function apply(el: Element, result: Rendered): void {
  el.removeAttribute(PENDING_ATTR);
  el.querySelector(`.${MESSAGE_CLASS}`)?.remove();
  if ('node' in result) {
    el.removeAttribute(ERROR_ATTR);
    // Nodes, not markup: the sanitized tree goes into the document as-is,
    // never back through an `innerHTML` re-parse. The cached fragment is
    // cloned because inserting a fragment empties it.
    el.replaceChildren(result.node.cloneNode(true));
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
  purifier = null;
  initializedTheme = null;
  passChain = Promise.resolve();
}
