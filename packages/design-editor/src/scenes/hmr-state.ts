/**
 * Carries focus, text selection and scroll position across a React Fast Refresh
 * patch inside the scene frame.
 *
 * WHY THIS IS NEEDED AT ALL.
 *
 * A layout edit (`layout-props`/`insert`/`remove`) previews by re-serving the
 * scene's own module with the staged plan applied (`plugin/scene-patch.ts` plus
 * `server.reloadModule`), and a token write's post-write half does the same for the
 * project's stylesheet. Both go through Vite's normal
 * Fast Refresh path, which preserves REACT STATE (hooks) across the patch but
 * not DOM-only state: `document.activeElement` is a real DOM node identity, and
 * React Refresh only guarantees the SAME COMPONENT keeps its hooks — the
 * concrete `<input>` element underneath it can still be torn down and rebuilt.
 * A designer mid-edit — typing in a rename field, scrolled three rows down a
 * long list — would lose the caret and the scroll position on every single
 * class tweak, which makes iterating on a real page unusable.
 *
 * WHY KEYING ON `data-wb-fp`, NOT THE DOM NODE ITSELF.
 *
 * The element you had focused before the patch and the (possibly different)
 * element at the same JSX position after it are not `===`. `data-wb-fp` is
 * exactly the identifier built to survive this: `stamp.mjs` stamps it on every
 * JSX element, and its whole design (`jsx-nodes.mjs`) excludes className content
 * and the child-tag sequence so a node keeps its fingerprint across the kind of
 * edit that triggers this very refresh. Re-querying by `[data-wb-fp="…"]` after
 * the patch finds the new DOM node standing in for the same source node.
 *
 * WHAT IS NOT PRESERVED, ON PURPOSE.
 *
 * Open dropdowns and live tooltips are transient UI state with no `data-wb-fp`
 * of their own (many are portaled to `document.body`) and no stable identity to
 * re-anchor on — re-opening one after every keystroke would be its own bug.
 * Content-editable selection (vs. `<input>`/`<textarea>`) is out of scope for the
 * same reason: there is no stable anchor for a range, and nothing to verify it
 * against until a scene uses one.
 */

/** A single scroll container's offset, keyed by its nearest stamped ancestor. */
interface ScrollSnapshot {
  fp: string;
  top: number;
  left: number;
}

/** What survives one Fast Refresh patch. */
interface FrameSnapshot {
  /** The focused element's nearest stamped ancestor-or-self, if any. */
  activeFp: string | null;
  /** Only meaningful for an `<input>`/`<textarea>` — `selectionStart`/`End`. */
  selection: { start: number | null; end: number | null } | null;
  scrolls: ScrollSnapshot[];
  /** The page-level scroll, which has no `data-wb-fp` of its own. */
  windowScroll: { x: number; y: number };
}

const STAMPED = '[data-wb-fp]';

function nearestFp(el: Element | null): string | null {
  return el?.closest(STAMPED)?.getAttribute('data-wb-fp') ?? null;
}

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement);
}

/**
 * Every element under `data-wb-fp` that is actually scrolled. Bounded to
 * elements the stamping transform reached — an unstamped internal wrapper
 * (a component that doesn't spread `{...props}`) cannot be re-found after the
 * patch, so its scroll offset is unrecoverable and skipped rather than guessed.
 */
function scrolledContainers(): ScrollSnapshot[] {
  const out: ScrollSnapshot[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(STAMPED)) {
    if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
      out.push({ fp: el.getAttribute('data-wb-fp')!, top: el.scrollTop, left: el.scrollLeft });
    }
  }
  return out;
}

export function captureFrameState(): FrameSnapshot {
  const active = document.activeElement;
  const activeFp = nearestFp(active);
  const selection = isTextField(active)
    ? { start: active.selectionStart, end: active.selectionEnd }
    : null;
  return {
    activeFp,
    selection,
    scrolls: scrolledContainers(),
    windowScroll: { x: window.scrollX, y: window.scrollY },
  };
}

/**
 * Re-find each snapshotted node by fingerprint and restore it. Run this a frame
 * after the patch lands (`requestAnimationFrame`), not synchronously in
 * `vite:afterUpdate` — that event fires once the module graph has swapped, but
 * React's own re-render from the Fast Refresh boundary is not guaranteed to
 * have committed to the DOM yet, and restoring against the pre-render tree
 * would silently no-op.
 *
 * A `data-wb-fp` can name several DOM nodes at once (a `.map()` row renders it
 * once per item), same as the anchor-resolution ambiguity elsewhere in this
 * tool. There the ambiguity is a WRITE and must refuse; here it is a read-only
 * UX nicety, so the first match in document order is restored rather than
 * refusing outright — worst case a sibling row's identical field gets the
 * caret back instead of the exact one, never a wrong file.
 */
export function restoreFrameState(snap: FrameSnapshot): void {
  for (const s of snap.scrolls) {
    const el = document.querySelector<HTMLElement>(`[data-wb-fp="${s.fp}"]`);
    if (el) {
      el.scrollTop = s.top;
      el.scrollLeft = s.left;
    }
  }
  window.scrollTo(snap.windowScroll.x, snap.windowScroll.y);

  if (!snap.activeFp) return;
  const el = document.querySelector<HTMLElement>(`[data-wb-fp="${snap.activeFp}"]`);
  if (!el) return;
  const target = isTextField(el) ? el : (el.querySelector<HTMLElement>('input,textarea') ?? el);
  target.focus({ preventScroll: true });
  if (snap.selection && isTextField(target)) {
    try {
      target.setSelectionRange(snap.selection.start, snap.selection.end);
    } catch {
      /* a non-text input type (e.g. checkbox) throws on setSelectionRange */
    }
  }
}

/**
 * Wire capture/restore to Vite's global HMR lifecycle events. Idempotent for
 * the same reason `installPicker`/`installFetchGuard` are: a fast-refresh
 * update re-runs module side effects, and `import.meta.hot.on` would otherwise
 * stack a second listener on every patch, capturing and restoring twice.
 */
let installed = false;

export function installHmrStatePreservation(): void {
  if (installed || !import.meta.hot) return;
  installed = true;

  let pending: FrameSnapshot | null = null;
  import.meta.hot.on('vite:beforeUpdate', () => {
    pending = captureFrameState();
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    const snap = pending;
    pending = null;
    if (!snap) return;
    requestAnimationFrame(() => restoreFrameState(snap));
  });
}
