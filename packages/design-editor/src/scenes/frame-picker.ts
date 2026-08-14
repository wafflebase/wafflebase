/**
 * Click-to-select and the selection overlay, INSIDE the frame.
 *
 * This is the half of selection that has to live in the frame's realm: only the
 * frame can read its own DOM, and only the frame can stop a click from
 * activating the product code underneath. The host half is `SceneHost`.
 *
 * WHY THE LISTENER IS ON `capture` AND CALLS `preventDefault`.
 *
 * The scene is REAL product code: a route renders links, lists render row menus
 * and dialogs, a sidebar navigates. A bubble-phase listener runs after React's own
 * handler, so by the time the picker sees the click the router has already
 * navigated the frame away from the node you were trying to select — and behind an
 * in-memory router there is no URL to tell you that happened, so it reads as
 * "selection is broken". Capture-phase
 * plus `preventDefault` + `stopPropagation` is what makes picking a mode rather
 * than a race. Picking is toggleable precisely because the other half of the job
 * is exercising the interaction, and then the product must get its clicks.
 *
 * WHY THE OVERLAY IS DOM AND NOT A CSS OUTLINE ON THE TARGET.
 *
 * Setting `outline` on the selected element changes its own computed style, and
 * this tool exists to judge computed style. An outline also participates in
 * `overflow`/`clip` and gets cut off by any ancestor with `overflow: hidden` —
 * a sidebar, a scroll container, a table. Absolutely-positioned boxes
 * appended to `<body>` are drawn on top of everything, never clipped, and never
 * touch the subject.
 *
 * WHY THE OVERLAY IS `data-wb-overlay` AND EXCLUDED FROM HIT-TESTING.
 *
 * The overlay lives in the same document, so without `pointer-events: none` it
 * would swallow the next click, and without the attribute check `reportClasses`
 * would feed the overlay's own Tailwind classes back to the host as classes the
 * scene rendered.
 */
import {
  isHostMessage,
  parseStampId,
  stampId,
  type FrameMessage,
  type FrameRect,
  type HostMessage,
  type StampRef,
} from './frame-protocol.ts';

/** The element attribute set the stamping transform writes. */
const STAMP_SELECTOR = '[data-wb-node]';

export interface PickerOptions {
  /** Post a message to the host. Supplied so `scene-entry` owns the channel. */
  send: (msg: FrameMessage) => void;
}

let started = false;
/**
 * One controller for every listener this module attaches, so `disposePicker` is a
 * single `abort()` rather than a list of `removeEventListener` calls that has to stay
 * in sync with the list above it.
 */
let abort: AbortController | null = null;
let observers: { disconnect(): void }[] = [];

/** Overlay boxes, created lazily and reused — one per role. */
interface Overlay {
  root: HTMLElement;
  hover: HTMLElement;
  selection: HTMLElement;
  /** One box per extra rendered instance of the selected source node. */
  siblings: HTMLElement[];
  label: HTMLElement;
}
let overlay: Overlay | null = null;

let picking = true;
let selectedId: string | null = null;
let hoverId: string | null = null;

/**
 * Figma-style click cycling: repeatedly clicking the SAME spot walks up the
 * stamped ancestor chain (child → parent → grandparent → …) one step per
 * click, wrapping past the outermost into a deselect and back to the
 * deepest on the next click — rather than every click re-selecting whatever
 * `stampedAt` finds nearest the pointer, which pins you to one depth and
 * makes reaching an outer wrapper require finding a pixel where ONLY that
 * wrapper is hit-tested (often impossible for a padding-only container).
 *
 * Keyed on the raw event target (`cycleTarget`), not on click coordinates:
 * two clicks that land on the exact same DOM element are "the same spot" for
 * this purpose, and comparing elements sidesteps sub-pixel jitter a
 * coordinate comparison would have to tolerate.
 */
let cycleTarget: Element | null = null;
let cycleChain: HTMLElement[] = [];
let cycleIndex = -1;

/** Drop the cycle state — any path that changes `selectedId` for a reason
 *  OTHER than "the user clicked again at the same spot" must call this, or a
 *  stale chain would let the next click resume a cycle the user never
 *  started (e.g. right after picking a different node from the outline). */
function resetCycle() {
  cycleTarget = null;
  cycleChain = [];
  cycleIndex = -1;
}

function makeBox(kind: 'hover' | 'selection' | 'sibling'): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-wb-overlay', kind);
  Object.assign(el.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483646',
    display: 'none',
    boxSizing: 'border-box',
    borderRadius: '2px',
  } satisfies Partial<CSSStyleDeclaration>);
  // Colours are hard-coded rather than token-driven ON PURPOSE. The overlay must
  // stay legible while you are editing the very tokens a themed overlay would
  // read — an outline that turns invisible because you just set `--primary` to
  // the background colour is worse than an unthemed one.
  if (kind === 'selection') {
    el.style.border = '1px solid #2563eb';
    el.style.boxShadow = '0 0 0 1px rgba(37,99,235,0.35)';
  } else if (kind === 'hover') {
    el.style.border = '1px dashed rgba(37,99,235,0.7)';
  } else {
    el.style.border = '1px dashed rgba(37,99,235,0.45)';
    el.style.background = 'rgba(37,99,235,0.06)';
  }
  return el;
}

function ensureOverlay(): Overlay {
  if (overlay) return overlay;
  const root = document.createElement('div');
  root.setAttribute('data-wb-overlay', 'root');
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '2147483646',
  } satisfies Partial<CSSStyleDeclaration>);

  const label = document.createElement('div');
  label.setAttribute('data-wb-overlay', 'label');
  Object.assign(label.style, {
    position: 'fixed',
    display: 'none',
    pointerEvents: 'none',
    zIndex: '2147483647',
    padding: '1px 4px',
    borderRadius: '2px',
    background: '#2563eb',
    color: '#fff',
    font: '10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
    whiteSpace: 'nowrap',
  } satisfies Partial<CSSStyleDeclaration>);

  const hover = makeBox('hover');
  const selection = makeBox('selection');
  root.append(hover, selection, label);
  document.body.appendChild(root);
  overlay = { root, hover, selection, siblings: [], label };
  return overlay;
}

const rectOf = (el: Element): FrameRect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

function place(box: HTMLElement, rect: FrameRect | null) {
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  box.style.left = `${rect.x}px`;
  box.style.top = `${rect.y}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
}

/**
 * Every DOM element rendered from one source node.
 *
 * A source node inside a `.map()` renders N times and all N carry the SAME
 * stamp, which is the whole point: an edit to that node changes every row, so
 * the overlay has to show every row or the edit's blast radius is invisible.
 */
/** Escape for use inside a double-quoted attribute-selector value. */
const q = (v: string) => v.replace(/[\\"]/g, '\\$&');

function elementsFor(id: string): HTMLElement[] {
  const p = parseStampId(id);
  if (!p) return [];
  const stamp = `${p.component}:${p.path.join('.')}`;
  return [
    ...document.querySelectorAll<HTMLElement>(
      `[data-wb-file="${q(p.file)}"][data-wb-node="${q(stamp)}"]`,
    ),
  ];
}

/** Build the host-facing reference for one stamped element. */
function refFor(el: HTMLElement): StampRef | null {
  const raw = el.dataset.wbNode;
  const file = el.dataset.wbFile;
  const fp = el.dataset.wbFp;
  if (!raw || !file || !fp) return null;
  const colon = raw.lastIndexOf(':');
  if (colon <= 0) return null;
  const tail = raw.slice(colon + 1);
  const path = tail === '' ? [] : tail.split('.').map(Number);
  const id = stampId(file, raw.slice(0, colon), path);
  return {
    id,
    component: raw.slice(0, colon),
    path,
    fp,
    file,
    tag: el.tagName.toLowerCase(),
    instances: elementsFor(id).length,
  };
}

/**
 * The stamped element a pointer event landed on.
 *
 * `closest` rather than the target itself: the deepest DOM node under the cursor
 * is frequently a text node's parent that no source node produced (an SVG path
 * inside an icon component, a Radix-injected wrapper). Walking up finds the
 * nearest node the designer can actually edit, which is what they meant.
 */
function stampedAt(target: EventTarget | null): HTMLElement | null {
  const el = target instanceof Element ? target : null;
  if (!el) return null;
  if (el.closest('[data-wb-overlay]')) return null;
  return el.closest<HTMLElement>(STAMP_SELECTOR);
}

/**
 * Every stamped ancestor of `target`, deepest first — the full path a
 * repeated click cycles through. Built from successive `.closest` calls
 * starting at each match's OWN parent (not itself), which is what stops this
 * from returning the same element forever.
 */
function stampChainAt(target: EventTarget | null): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let next = stampedAt(target);
  while (next) {
    chain.push(next);
    next = stampedAt(next.parentElement);
  }
  return chain;
}

/**
 * Elements the overlay is currently drawn over, re-observed after every paint.
 *
 * A `ResizeObserver` on `documentElement` only fires when the DOCUMENT resizes.
 * The sidebar collapsing does not resize the document — it resizes a box inside
 * it, and everything to its right shifts. Without observing the subject itself,
 * the outline stays exactly where it was while the thing it outlines slides away.
 */
let subjectObserver: ResizeObserver | null = null;

function observeSubjects(els: HTMLElement[]) {
  if (!subjectObserver) return;
  subjectObserver.disconnect();
  for (const el of els) subjectObserver.observe(el);
}

function paint() {
  const o = ensureOverlay();

  // Picking OFF means the frame is being USED, not inspected. Keeping the box up
  // is wrong twice over: it sits on top of a control you are about to click, and
  // it reads as an active state the app did not set. The selection itself is
  // kept — the inspector still describes the node — only the drawing stops.
  if (!picking) {
    place(o.selection, null);
    place(o.hover, null);
    o.siblings.forEach((b) => place(b, null));
    o.label.style.display = 'none';
    observeSubjects([]);
    return;
  }

  const selected = selectedId ? elementsFor(selectedId) : [];
  // A node can vanish between paints — an HMR patch replaced it, or the app
  // unmounted it. `elementsFor` returning nothing draws nothing, which is what
  // stops a box hanging in space over a node that no longer exists.
  place(o.selection, selected[0] ? rectOf(selected[0]) : null);

  // Extra instances get their own boxes, pooled so a 200-row table does not
  // create and destroy 200 elements on every scroll frame.
  const extra = selected.slice(1);
  while (o.siblings.length < extra.length) {
    const box = makeBox('sibling');
    o.siblings.push(box);
    o.root.appendChild(box);
  }
  o.siblings.forEach((box, i) => place(box, extra[i] ? rectOf(extra[i]) : null));

  if (selected[0]) {
    const r = rectOf(selected[0]);
    const n = selected.length;
    o.label.textContent =
      `<${selected[0].tagName.toLowerCase()}>` + (n > 1 ? `  ×${n}` : '');
    o.label.style.display = 'block';
    // Above the box when there is room, inside its top edge when there is not.
    const above = r.y >= 16;
    o.label.style.left = `${Math.max(0, r.x)}px`;
    o.label.style.top = `${above ? r.y - 15 : r.y + 1}px`;
  } else {
    o.label.style.display = 'none';
  }

  const hovered = hoverId && hoverId !== selectedId ? elementsFor(hoverId) : [];
  place(o.hover, hovered[0] ? rectOf(hovered[0]) : null);

  observeSubjects([...selected, ...hovered]);
}

/**
 * Install the picker. Idempotent — a fast-refresh update re-runs module side
 * effects, and a second set of capture listeners would double-report every click.
 */
export function installPicker({ send }: PickerOptions): void {
  if (started) return;
  started = true;
  abort = new AbortController();
  const { signal } = abort;

  window.addEventListener(
    'click',
    (e) => {
      const el = stampedAt(e.target);
      if (!el) {
        // A click on a non-selectable area — Chrome DevTools / Figma both
        // treat "clicked elsewhere on the canvas" as a deselect. Left alone
        // (not prevented) so the product still gets it: a click on real
        // whitespace has no product handler to race, and a click that landed
        // here BECAUSE the target swallows the stamped attribute (a known
        // gap — see SceneOutline's header) should still reach its own handler.
        //
        // Checked BEFORE the `picking` gate below, deliberately: a selection
        // made while picking was on should still clear when the user switches
        // to Use mode and clicks elsewhere to interact with the app normally.
        // Gating this on `picking` too would mean the only way to deselect in
        // Use mode is to flip back to Pick first — not how DevTools or Figma
        // behave, and not what "click outside to deselect" means to a user
        // who is done picking and is now just using the app.
        resetCycle();
        if (selectedId !== null) {
          selectedId = null;
          paint();
          send({ type: 'wb:deselect' });
        }
        return;
      }
      if (!picking) return;

      // Capture + prevent + stop: the product's own handler must not run. See
      // the header — without this a `<Link>` navigates before selection lands.
      e.preventDefault();
      e.stopPropagation();

      // Ctrl/Cmd+click bypasses whatever depth a repeated-click cycle is
      // currently sitting at and jumps straight to `el` — the nearest
      // stamped node to the pointer, i.e. the deepest one — the same way
      // Figma's deep-select modifier ignores group boundaries. It also
      // resets the cycle, so a PLAIN click right after starts fresh from
      // here rather than resuming wherever the cycle was before the
      // modifier click.
      if (e.metaKey || e.ctrlKey) {
        resetCycle();
        const ref = refFor(el);
        if (!ref) return;
        selectedId = ref.id;
        paint();
        send({ type: 'wb:select', node: ref, rect: rectOf(el), altKey: e.altKey });
        return;
      }

      // A fresh spot starts the chain over at the deepest node (index 0); the
      // SAME spot clicked again advances one ancestor up. `stampChainAt` is
      // rebuilt on a fresh spot rather than reused/cached across clicks — a
      // staged edit or a re-render can change the tree between clicks, and a
      // stale chain would walk ancestors that no longer exist.
      if (e.target !== cycleTarget) {
        cycleTarget = e.target as Element;
        cycleChain = stampChainAt(e.target);
        cycleIndex = -1;
      }
      cycleIndex++;

      if (cycleIndex >= cycleChain.length) {
        // Past the outermost — deselect. `cycleIndex` resets to -1 (not
        // cleared entirely) so the NEXT click at this same spot advances to
        // 0 and starts the cycle over from the deepest node again, rather
        // than requiring the user to click away and back.
        cycleIndex = -1;
        selectedId = null;
        paint();
        send({ type: 'wb:deselect' });
        return;
      }

      const target = cycleChain[cycleIndex];
      const ref = refFor(target);
      if (!ref) return;
      selectedId = ref.id;
      paint();
      send({ type: 'wb:select', node: ref, rect: rectOf(target), altKey: e.altKey });
    },
    { capture: true, signal },
  );

  // Suppress the OTHER activation paths a capture click listener does not cover.
  // `mousedown` starts drags and opens Radix menus on press; a keyboard Enter on
  // a focused link activates it without a click at all.
  for (const type of ['mousedown', 'mouseup', 'dblclick'] as const) {
    window.addEventListener(
      type,
      (e) => {
        if (!picking) return;
        if (!stampedAt(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
      },
      { capture: true, signal },
    );
  }

  window.addEventListener(
    'mousemove',
    (e) => {
      if (!picking) return;
      const el = stampedAt(e.target);
      const ref = el ? refFor(el) : null;
      const next = ref?.id ?? null;
      if (next === hoverId) return;
      hoverId = next;
      paint();
      send({ type: 'wb:hover', node: ref, rect: el ? rectOf(el) : null });
    },
    { capture: true, signal },
  );

  window.addEventListener('mouseleave', () => {
    if (hoverId === null) return;
    hoverId = null;
    paint();
    send({ type: 'wb:hover', node: null, rect: null });
  }, { signal });

  // The overlay is `position: fixed` over a scrolling document, so it has to be
  // repainted on scroll and resize or it detaches from its subject. `capture`
  // catches scrolls inside nested containers (the documents table, the sidebar),
  // which do not bubble to `window`.
  //
  // Coalesced to one repaint per animation frame. A scroll fires these tens of
  // times per frame and `paint()` reads `getBoundingClientRect()` for every
  // rendered instance of the selection — on a table that is a forced layout per
  // row per event.
  let queued = 0;
  const repaint = () => {
    if (queued) return;
    queued = window.requestAnimationFrame(() => {
      queued = 0;
      paint();
    });
  };
  window.addEventListener('scroll', repaint, { capture: true, signal });
  window.addEventListener('resize', repaint, { signal });

  /**
   * A CSS TRANSITION finishes long after the mutation that started it.
   *
   * Collapsing the sidebar flips a class; the MutationObserver below sees that
   * immediately and repaints — against the geometry at frame zero, before
   * anything has moved. Every element to the right of the sidebar then slides
   * ~200ms to its new position while the outline sits at the old one, which is
   * exactly the "outline stays behind after a layout shift" report.
   *
   * Two listeners, because they cover different halves: `transitionrun` fires at
   * the start (so we begin tracking) and `transitionend`/`animationend` fire at
   * the finish (so the last frame is correct). Between them, `trackFor` keeps
   * repainting every frame for the duration — the only way to follow an
   * interpolated position, since nothing fires per-frame during a transition.
   */
  let trackUntil = 0;
  let tracking = false;
  const trackFor = (ms: number) => {
    trackUntil = Math.max(trackUntil, performance.now() + ms);
    if (tracking) return;
    tracking = true;
    const step = () => {
      paint();
      if (performance.now() < trackUntil) window.requestAnimationFrame(step);
      else tracking = false;
    };
    window.requestAnimationFrame(step);
  };

  for (const type of ['transitionrun', 'transitionstart', 'animationstart'] as const) {
    window.addEventListener(type, () => trackFor(400), { capture: true, signal });
  }
  for (const type of ['transitionend', 'animationend', 'transitioncancel'] as const) {
    window.addEventListener(type, () => trackFor(50), { capture: true, signal });
  }

  // The scene re-renders for reasons the host never hears about (a fixture
  // resolving, a `.map()` growing, a Radix dialog opening). A ResizeObserver on
  // the document element covers reflow; a MutationObserver covers a selected
  // node being replaced outright, which is what an HMR patch does.
  //
  // BOTH MUST IGNORE THE OVERLAY'S OWN WRITES. `paint()` sets inline styles on
  // overlay boxes, those are attribute mutations inside the observed subtree,
  // and an unfiltered observer would therefore schedule a repaint for every
  // repaint — a self-sustaining rAF loop that pins a core and never settles.
  const isOurs = (n: Node | null) =>
    n instanceof Element ? !!n.closest('[data-wb-overlay]') : false;

  if (typeof ResizeObserver !== 'undefined') {
    const docObserver = new ResizeObserver(repaint);
    docObserver.observe(document.documentElement);
    observers.push(docObserver);
    // A second observer, aimed at the SUBJECT rather than the document. The
    // document does not resize when the sidebar collapses; the subject moves.
    subjectObserver = new ResizeObserver(repaint);
    observers.push(subjectObserver);
  }
  const mutations = new MutationObserver((records) => {
    for (const r of records) {
      if (isOurs(r.target)) continue;
      repaint();
      return;
    }
  });
  mutations.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
  observers.push(mutations);

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    if (!isHostMessage(e.data)) return;
    const msg = e.data as HostMessage;
    switch (msg.type) {
      case 'wb:set-selection':
        // The outline (or a candidate pick, or a scene switch) is choosing a
        // node for a reason that has nothing to do with a click cycle in
        // progress here — without this, clicking the SAME spot again right
        // after would resume advancing from wherever the OLD cycle left off
        // instead of starting fresh from the deepest node under it.
        resetCycle();
        selectedId = msg.id;
        paint();
        // Bring it into view — the outline panel can select a node that is
        // scrolled out of the frame, and a highlight you cannot see reads as a
        // highlight that did not happen.
        if (msg.id) elementsFor(msg.id)[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        break;
      case 'wb:set-hover':
        hoverId = msg.id;
        paint();
        break;
      case 'wb:set-picking':
        picking = msg.enabled;
        // Repaint immediately: switching to Use must take the box DOWN now, not
        // whenever something else happens to trigger a repaint, and switching
        // back to Pick must put it back on the node's CURRENT geometry rather
        // than wherever it was when picking was turned off.
        paint();
        break;
      case 'wb:measure': {
        const el = elementsFor(msg.id)[0];
        send({ type: 'wb:measured', nonce: msg.nonce, rect: el ? rectOf(el) : null });
        break;
      }
      case 'wb:set-token-vars':
        applyTokenVars(msg.vars);
        break;
    }
  }, { signal });
}

/**
 * Detach everything `installPicker` attached.
 *
 * A frame normally dies with its document, so in production nothing calls this. It
 * exists because the observers are the one part of this module that OUTLIVE the turn
 * that created them: a `MutationObserver` callback is a microtask, and it can run
 * after its document is gone. That is not hypothetical — it took down the first DOM
 * test run of this file twice, first on `Element` and then on `window`, both from
 * inside an observer where nothing catches it.
 *
 * DISPOSING IS THE WHOLE FIX. The first attempt guarded the individual global reads
 * instead (duck-typing `isOurs` rather than `instanceof Element`), and reverting that
 * guard with this function in place changes no test — which is the evidence it was
 * treating the symptom. One teardown beats N defensive reads, so the guard is gone.
 */
export function disposePicker(): void {
  abort?.abort();
  abort = null;
  for (const o of observers) o.disconnect();
  observers = [];
  overlay?.root.remove();
  overlay = null;
  subjectObserver = null;
  resetCycle();
  selectedId = null;
  hoverId = null;
  picking = true;
  started = false;
}

/**
 * Live token overrides, as a real `:root` declaration block.
 *
 * A `<style>` element rather than `documentElement.style.setProperty`: the
 * application's own theme provider writes to the root element's class list and other
 * code may write inline styles there, and a stylesheet keeps the editor's overrides
 * in one replaceable unit that is trivially removable when the edit is discarded.
 *
 * `darkSelector` IS A PARAMETER because it is configuration, not a constant. The
 * default `cssVariables()` adapter defaults to `.dark` and a shadcn project matches,
 * but the option exists precisely because a project may use something else — and if
 * it does, its own dark block out-specifies a `:root` override and the dark preview
 * silently shows the on-disk colour. NOTHING CONFIGURES THIS YET: the shell would
 * have to thread the adapter's selector through `wb:set-token-vars`, which is PR 11's
 * work. Recorded here rather than fixed speculatively — see §6.
 */
const TOKEN_STYLE_ID = 'wb-token-preview';

export function applyTokenVars(vars: Record<string, string>, darkSelector = '.dark'): void {
  let style = document.getElementById(TOKEN_STYLE_ID) as HTMLStyleElement | null;
  const entries = Object.entries(vars);
  if (!entries.length) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = TOKEN_STYLE_ID;
    document.head.appendChild(style);
  }
  // Appended last, so it wins the cascade against the equally-specific `:root` and
  // dark blocks in the project's own stylesheet. Both selectors are emitted because
  // the frame can be in either theme and the host sends the values for the theme it
  // is showing.
  const body = entries.map(([k, v]) => `  ${k}: ${v};`).join('\n');
  style.textContent = `:root {\n${body}\n}\n${darkSelector} {\n${body}\n}\n`;
}

/** Ids of every stamp that actually reached the DOM (the `clickSelectable` fix). */
export function selectableIds(): string[] {
  const ids = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>(STAMP_SELECTOR)) {
    const ref = refFor(el);
    if (ref) ids.add(ref.id);
  }
  return [...ids];
}

/**
 * Class strings the frame rendered, for Tailwind candidate registration.
 *
 * Skips the overlay: its classes are the editor's, not the scene's, and feeding
 * them back would have the host register candidates for its own furniture.
 */
export function renderedClasses(): string[] {
  const seen = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>('[class]')) {
    if (el.closest('[data-wb-overlay]')) continue;
    for (const c of el.className.toString().split(/\s+/)) if (c) seen.add(c);
  }
  return [...seen];
}
