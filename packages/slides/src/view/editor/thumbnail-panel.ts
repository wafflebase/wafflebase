import type { Slide, SlidesDocument } from '../../model/presentation';
import type { SlidesStore } from '../../store/store';
import type { SlidesEditor } from './editor';
import { renderThumbnail, ThumbnailScheduler } from '../canvas/thumbnail';
import { showContextMenu, type ContextMenuItem } from './context-menu';
import { showLayoutPicker } from './layout-picker';

// Debounce window for asset-load triggered repaints. Tight enough that
// users perceive thumbnails filling in promptly, loose enough that a
// burst of N image-load callbacks in the same frame coalesces into one
// repaint per affected thumb.
const ASSET_LOAD_DEBOUNCE_MS = 100;

// IntersectionObserver rootMargin around the scrollable panel. ~1 thumb
// of buffer above + below the viewport so the next slide is painted
// before the user scrolls onto it. 200px is comfortably more than the
// MAX_THUMB_W (320 * 9/16 ≈ 180) thumbnail height, so the prefetch
// horizon is always at least one full thumb out.
const IO_ROOT_MARGIN_PX = 200;

// How many thumbs the render loop builds per animation frame. The first
// chunk runs synchronously so the user immediately sees the panel start
// to fill in; subsequent chunks yield to the event loop between frames
// so a 100-slide deck doesn't block the main thread for ~hundreds of ms
// on mount. 20 is large enough to cover one viewport at the default
// thumb size (panel-width ≈ 192, thumb ≈ 109px tall → ~7-8 visible at
// 800px panel height) with a comfortable buffer; smaller decks finish
// in this single sync chunk and never schedule a follow-up rAF.
const RENDER_CHUNK_SIZE = 20;

// Per-thumbnail mount state. Held in a panel-lifetime map so the
// scheduler's onFlush can look up the latest canvas/ctx for a given
// slide id even after the panel has been rebuilt — a late-arriving
// image load for a since-rebuilt panel paints the new canvas (or
// no-ops if the slide is gone from the store).
type ThumbState = {
  item: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  slide: Slide;
  doc: SlidesDocument;
  dims: ThumbDims;
  dpr: number;
  painted: boolean;
};

// Thumbnails preserve the slide's 16:9 aspect and scale to fit the
// container's measured width. Floor/ceiling keep them legible on a
// very narrow panel and from ballooning on a very wide one.
const THUMB_ASPECT = 16 / 9;
const MIN_THUMB_W = 80;
const MAX_THUMB_W = 320;
const FALLBACK_THUMB_W = 192;
// Border width is constant across selection states (only the color
// changes) so the inner canvas size doesn't jump when the user
// switches the current slide. 1px on each side = 2px reserved.
const BORDER_PX = 1;

interface ThumbDims {
  /** Outer item box (border-box). */
  outerW: number;
  outerH: number;
  /** Inner canvas box — derived to be EXACTLY 16:9 so the slide-renderer
   * (which letterboxes via Math.min(scaleX, scaleY)) fills the canvas
   * end-to-end with no background gap. */
  innerW: number;
  innerH: number;
}

function computeThumbDims(containerWidth: number): ThumbDims {
  const available = containerWidth > 0 ? containerWidth : FALLBACK_THUMB_W;
  const outerW = Math.max(
    MIN_THUMB_W,
    Math.min(MAX_THUMB_W, Math.floor(available)),
  );
  const innerW = outerW - BORDER_PX * 2;
  // Round innerH so the inner box stays as close to 16:9 as integer
  // pixels allow. The outer height absorbs the rounding.
  const innerH = Math.round(innerW / THUMB_ASPECT);
  const outerH = innerH + BORDER_PX * 2;
  return { outerW, outerH, innerW, innerH };
}

export interface ThumbnailPanelHandle {
  /**
   * Structural re-render — rebuilds the entire panel DOM from the
   * current store. Use ONLY when the slide list itself changed (added,
   * removed, reordered). Wipes innerHTML, so it costs a frame of
   * "blank canvases" until IntersectionObserver fires; call sites that
   * only need to reflect a content edit should use `refreshContent`
   * instead.
   */
  refresh(): void;
  /**
   * Repaint already-painted thumbs in place — no DOM rebuild, no
   * observer churn. Reads the latest doc from the store and updates
   * each thumb's cached slide / doc references so subsequent lazy
   * paints use the fresh state. The right call after a non-structural
   * store change (frame drag, color edit, text edit) — it's what keeps
   * the thumbnail in sync with the main canvas without flickering the
   * whole panel.
   */
  refreshContent(): void;
  /** Detach editor subscriptions. The DOM is left in place. */
  dispose(): void;
  /**
   * The set of slide ids the user has shift-clicked into a multi-
   * selection in the panel. Distinct from `editor.getCurrentSlideId()`,
   * which is the single rendered slide. T4's right-click bulk-delete
   * reads this list.
   */
  getSelectedSlideIds(): readonly string[];
}

export interface MountThumbnailPanelOptions {
  /**
   * Disable every mutating thumbnail interaction. The panel still
   * renders thumbs and routes click + ArrowUp/Down to
   * `editor.setCurrentSlide`, but drag-reorder, the right-click bulk
   * context menu, and the draggable cursor are all suppressed. Used
   * by viewer-role share links.
   */
  readOnly?: boolean;
}

/**
 * Mount a slide thumbnail panel into `container`. Each slide gets a
 * mini-canvas rendered via `renderThumbnail`; clicking a thumbnail
 * switches the editor's current slide; shift-click toggles slide-level
 * multi-selection (held locally in the panel — separate from element
 * selection); HTML5 drag-and-drop reorders via `store.moveSlide`. New
 * slides are added from the formatting toolbar's split-button, not
 * from this panel.
 */
export function mountThumbnailPanel(
  container: HTMLElement,
  store: SlidesStore,
  editor: SlidesEditor,
  options: MountThumbnailPanelOptions = {},
): ThumbnailPanelHandle {
  const readOnly = options.readOnly === true;
  let selectedSlideIds: string[] = [];
  let disposed = false;

  // Per-mount thumbnail state, rebuilt by render() but shared across
  // renders via this mutable ref. The scheduler closes over `state` so
  // a late-arriving image-load callback after render() rebuilt the DOM
  // either paints the new canvas (slide still present) or no-ops
  // (slide removed since the load fired).
  const state = new Map<string, ThumbState>();

  // Scheduler debounce groups bursts of `onAssetLoad` callbacks from
  // `image-cache.ts` (one image load can resolve N pending thumbnails
  // at once when the same src is shared) into a single repaint per
  // affected thumb. The 100ms window is invisible to the user but
  // collapses sub-frame storms into one ctx.drawImage cycle each.
  const scheduler = new ThumbnailScheduler(
    ASSET_LOAD_DEBOUNCE_MS,
    (ids) => {
      if (disposed) return;
      for (const id of ids) {
        const s = state.get(id);
        if (!s) continue;
        paintThumb(id, s);
      }
    },
  );

  // The active IntersectionObserver — recreated on every render() so
  // each observation tracks the latest scroll parent / item DOM. Null
  // in jsdom (and any other host that lacks the global) so the
  // fallback path can paint synchronously.
  let intersectionObserver: IntersectionObserver | null = null;

  // Chunked-render bookkeeping. `activeRenderToken` is bumped on every
  // render() start; in-flight chunk callbacks bail out as soon as they
  // see the token has moved on, so a follow-up render() (or dispose)
  // never lets a stale chunk append items / paint into the new state
  // map. `pendingChunkRAF` is the next-frame handle so we can cancel it
  // outright instead of relying on the token check alone.
  let activeRenderToken = 0;
  let pendingChunkRAF: number | null = null;
  const cancelPendingChunk = (): void => {
    if (pendingChunkRAF !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(pendingChunkRAF);
      }
      pendingChunkRAF = null;
    }
  };

  // Cheap update for highlight-only changes (current-slide switch).
  // Touches className + border color on existing items; the canvas
  // bitmaps and IntersectionObserver state are left intact, which
  // avoids both wasted repaints and the one-frame "blank canvas"
  // flicker that a full render() would cause via the async IO fire.
  // No-op when `state` is empty (initial mount before render runs) or
  // when the new current id doesn't exist in the map yet (a deletion
  // flow that fires onCurrentSlideChange before its follow-up render).
  const syncCurrentHighlight = (): void => {
    const currentId = editor.getCurrentSlideId();
    for (const [id, s] of state) {
      const isCurrent = id === currentId;
      s.item.classList.toggle('current', isCurrent);
      s.item.style.borderColor = isCurrent
        ? 'var(--primary, #3a7)'
        : 'var(--border, #444)';
    }
  };

  const paintThumb = (id: string, s: ThumbState): void => {
    if (disposed) return;
    renderThumbnail(
      s.ctx,
      s.slide,
      s.doc,
      { hostWidth: s.dims.innerW, hostHeight: s.dims.innerH, dpr: s.dpr },
      () => {
        // Async image (background or element) finished loading. Re-run
        // paintThumb for this slide via the scheduler so concurrent
        // loads coalesce instead of triggering N draws this frame.
        if (disposed) return;
        scheduler.schedule(id);
      },
    );
    s.painted = true;
    // INVARIANT: once `painted` is set, the IO callback's "skip if
    // already painted" gate (see :393) relies on `refreshContent`
    // keeping `s.slide` / `s.doc` fresh whenever the store changes.
    // Otherwise scrolling an off-screen-since-edit thumb back into
    // view would paint stale content. Don't relax `refreshContent`
    // to skip invisible thumbs without also clearing this flag.
    //
    // Debug + test signal: number of paint cycles this canvas has gone
    // through since it was created. Lets DevTools spot a thumbnail that
    // is silently never repainting, and lets unit tests assert async-
    // image and lazy-paint flow without instrumenting the renderer.
    const prev = Number(s.canvas.dataset.paintCount ?? '0');
    s.canvas.dataset.paintCount = String(prev + 1);
  };

  // Build the right-click menu for the given selection. `anchorSlideId`
  // is the slide the user actually right-clicked — used as the
  // single-target for `Change layout…` and as the insertion anchor for
  // `New slide`. `event` is forwarded so the layout picker can anchor
  // off the click position.
  const buildContextMenuItems = (
    targetIds: readonly string[],
    anchorSlideId: string,
    event: MouseEvent,
  ): ContextMenuItem[] => {
    const isMulti = targetIds.length > 1;
    return [
      {
        label: 'New slide',
        run: () => {
          const doc = store.read();
          const anchorIndex = doc.slides.findIndex((s) => s.id === anchorSlideId);
          let newId = '';
          store.batch(() => {
            newId = store.addSlide('blank', anchorIndex + 1);
          });
          if (newId) editor.setCurrentSlide(newId);
          selectedSlideIds = newId ? [newId] : [];
          render();
        },
      },
      {
        label: isMulti ? `Duplicate ${targetIds.length} slides` : 'Duplicate slide',
        run: () => {
          const newIds: string[] = [];
          store.batch(() => {
            for (const id of targetIds) newIds.push(store.duplicateSlide(id));
          });
          // Anchor follow-up: switch current to the duplicate of the
          // right-clicked slide so the editor's main canvas tracks the
          // user's intent (matches Cmd+D's "duplicate moves the cursor
          // to the new slide" feel).
          const anchorIdx = targetIds.indexOf(anchorSlideId);
          const focusId = anchorIdx >= 0 ? newIds[anchorIdx] : newIds[0];
          if (focusId) editor.setCurrentSlide(focusId);
          selectedSlideIds = newIds;
          render();
        },
      },
      {
        label: isMulti ? `Delete ${targetIds.length} slides` : 'Delete slide',
        // Block deleting the entire deck — the editor's `render()` bails
        // out when no current slide exists, leaving a blank canvas.
        // Matches Google Slides which keeps at least one slide.
        disabled: store.read().slides.length <= targetIds.length,
        run: () => {
          const doc = store.read();
          const targetSet = new Set(targetIds);
          const currentId = editor.getCurrentSlideId();
          // If the current slide is being deleted, pick a survivor:
          // first slide after the last-deleted index, or fall back to
          // the slide just before. The deck-wipe case is gated above.
          let nextCurrent: string | undefined = currentId;
          if (currentId && targetSet.has(currentId)) {
            const surviving = doc.slides.filter((s) => !targetSet.has(s.id));
            const anchorIdx = doc.slides.findIndex((s) => s.id === anchorSlideId);
            // Prefer the first surviving slide after the anchor, else
            // the last surviving slide before it.
            nextCurrent =
              surviving.find(
                (s) => doc.slides.indexOf(s) > anchorIdx,
              )?.id ?? surviving[surviving.length - 1]?.id;
          }
          store.batch(() => store.removeSlides([...targetIds]));
          if (nextCurrent && nextCurrent !== currentId) {
            editor.setCurrentSlide(nextCurrent);
          }
          selectedSlideIds = [];
          render();
        },
      },
      { label: '---', run: () => undefined },
      {
        label: 'Change layout…',
        // Layout change only makes sense for one slide at a time —
        // mass-applying a Title layout to a 30-slide deck is almost
        // never what the user wants. Google Slides also limits this
        // entry point to single-slide.
        disabled: isMulti,
        run: () => {
          const doc = store.read();
          const targetSlide = doc.slides.find((s) => s.id === anchorSlideId);
          if (!targetSlide) return;
          showLayoutPicker(document.body, {
            store,
            anchor: { x: event.clientX, y: event.clientY },
            selectedLayoutId: targetSlide.layoutId,
            onPick: (layoutId) => {
              store.batch(() => store.applyLayout(anchorSlideId, layoutId));
              render();
            },
            onClose: () => {},
          });
        },
      },
    ];
  };

  // Walk up to the closest scrollable ancestor so we can capture and
  // restore its scrollTop across the innerHTML wipe. Without this the
  // browser clamps scrollTop to 0 the instant the wiped children leave
  // scrollHeight smaller than the current scroll offset — every click
  // would otherwise snap the panel back to the first slide.
  const findScrollParent = (
    el: HTMLElement | null,
  ): HTMLElement | null => {
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      const overflowY =
        typeof getComputedStyle === 'function'
          ? getComputedStyle(n).overflowY
          : n.style.overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return n;
    }
    return null;
  };

  const render = (): void => {
    const scrollParent = findScrollParent(container);
    const savedScrollTop = scrollParent?.scrollTop ?? 0;
    container.innerHTML = '';
    // Disconnect the previous observer + cancel any in-flight chunk
    // build before we wipe state. Without the chunk cancel, a follow-up
    // render() during a long deck's chunked load would race the prior
    // chunks into appending stale items.
    intersectionObserver?.disconnect();
    intersectionObserver = null;
    cancelPendingChunk();
    state.clear();
    activeRenderToken += 1;
    const myToken = activeRenderToken;

    const dims = computeThumbDims(container.clientWidth);
    // Read DPR per render so a window dragged between Retina and a
    // non-Retina monitor mid-session also re-paints at the right density.
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;
    const doc = store.read();
    const currentId = editor.getCurrentSlideId();
    const slides = doc.slides;

    // Set up the IntersectionObserver ONCE for this render. Items get
    // observed as they're appended chunk-by-chunk, so the observer's
    // initial-fire on the first batch starts painting visible thumbs
    // even before the rest of the deck has finished laying out.
    const useIO = typeof IntersectionObserver !== 'undefined';
    if (useIO) {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          // Token guard: an in-flight observer from a previous render()
          // could fire here if disconnect() raced the entry queue.
          if (disposed || activeRenderToken !== myToken) return;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const id = (entry.target as HTMLElement).dataset.slideId;
            if (!id) continue;
            const s = state.get(id);
            // `painted` keeps a thumb stable once drawn — scrolling
            // it back out and in again doesn't repaint (the canvas
            // bitmap stays valid for the entire panel mount). A
            // re-render via render() resets state.painted by rebuilding
            // the map.
            if (!s || s.painted) continue;
            paintThumb(id, s);
          }
        },
        {
          // Per IntersectionObserver spec, `root: null` (passed when
          // `findScrollParent` doesn't find an overflow ancestor) means
          // observe against the document viewport. That's the right
          // behavior when the panel's overflow lives outside this
          // package's reach — slides-view's flex layout, for example,
          // keeps scrolling at body level. The rootMargin band gives
          // us a ~1-thumb prefetch horizon regardless of which root
          // was picked.
          root: scrollParent,
          rootMargin: `${IO_ROOT_MARGIN_PX}px`,
          threshold: 0,
        },
      );
    }

    // Per-slide DOM construction. Pulled out of the loop so the chunked
    // build path below can call it from both the synchronous first
    // chunk and the rAF-driven follow-ups without copy/paste. Captures
    // `dims`, `dpr`, `doc`, `currentId` from the render() closure so the
    // chunked tail sees the same snapshot the head started with.
    const buildItem = (slide: Slide): void => {
      const item = document.createElement('div');
      item.dataset.slideId = slide.id;
      const isCurrent = slide.id === currentId;
      item.className = 'wfb-slides-thumb' + (isCurrent ? ' current' : '');
      item.style.width = `${dims.outerW}px`;
      item.style.height = `${dims.outerH}px`;
      item.style.boxSizing = 'border-box';
      item.style.cursor = 'pointer';
      // Use border (inside the box) instead of outline (outside the
      // box). Outline pixels sit at the negative edge of the item and
      // get clipped by the panel's overflow box when a thumbnail is
      // flush against the panel's left/top — leaving the slide looking
      // like its left + top edges are missing. Border thickness is
      // constant across selection states; only the color changes, so
      // the inner canvas size never jumps when the user switches the
      // current slide. Theme tokens follow the host frontend's
      // light/dark mode (fallbacks for theme-less hosts like jsdom).
      const borderColor = isCurrent
        ? 'var(--primary, #3a7)'
        : 'var(--border, #444)';
      item.style.border = `${BORDER_PX}px solid ${borderColor}`;
      item.style.marginBottom = '8px';
      // Read-only viewers keep the click-to-navigate affordance but
      // never see a drag cursor — drag-reorder handlers are skipped
      // below too.
      item.draggable = !readOnly;

      const canvas = document.createElement('canvas');
      // Backing store at device pixels; CSS box at logical pixels.
      // Without the dpr multiplier on width/height, Retina renders a
      // half-resolution bitmap that the browser stretches → blurry.
      canvas.width = Math.round(dims.innerW * dpr);
      canvas.height = Math.round(dims.innerH * dpr);
      canvas.style.width = `${dims.innerW}px`;
      canvas.style.height = `${dims.innerH}px`;
      canvas.style.display = 'block';
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Stash state but DON'T paint yet — the IntersectionObserver
        // decides which thumbs warrant a paint right now. Off-screen
        // thumbs paint lazily as the user scrolls. The fallback (jsdom
        // or any host without IntersectionObserver) paints every state
        // entry synchronously once chunk-building completes so the
        // existing assertions still hold.
        state.set(slide.id, {
          item, canvas, ctx, slide, doc, dims, dpr, painted: false,
        });
      }
      item.appendChild(canvas);

      item.addEventListener('pointerdown', (e) => {
        if (e.shiftKey) {
          // Toggle slide-level multi-selection. Shift-click does NOT
          // change the rendered slide — that's handled by plain click.
          // No render() needed: selectedSlideIds has no visual
          // treatment (only `isCurrent` styles the border), so re-
          // building the DOM would just cost a paint flicker.
          const idx = selectedSlideIds.indexOf(slide.id);
          if (idx === -1) selectedSlideIds.push(slide.id);
          else            selectedSlideIds.splice(idx, 1);
          return;
        }
        selectedSlideIds = [slide.id];
        // Focus the panel so subsequent ArrowUp/ArrowDown navigate
        // slides. preventScroll avoids the browser auto-scrolling the
        // panel to the focused element — we manage scroll explicitly.
        container.focus({ preventScroll: true });
        editor.setCurrentSlide(slide.id);
      });

      // HTML5 drag-and-drop reorder. jsdom only partially implements
      // dataTransfer, so unit-level coverage is skipped; T6 visual
      // verifies the path. Skipped entirely for read-only viewers —
      // every handler below mutates the store.
      if (!readOnly) {
        item.addEventListener('dragstart', (e) => {
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', slide.id);
            e.dataTransfer.effectAllowed = 'move';
          }
        });
        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        });
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          const sourceId = e.dataTransfer?.getData('text/plain');
          if (!sourceId || sourceId === slide.id) return;
          const targetIndex = doc.slides.findIndex((s) => s.id === slide.id);
          store.batch(() => store.moveSlide(sourceId, targetIndex));
          render();
        });

        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          // If the right-clicked slide isn't already in the shift-selected
          // set, replace selection with just that slide. Matches the
          // canvas right-click semantics in editor.ts (right-click selects
          // what was clicked before opening the menu) — without this, a
          // user could right-click a slide they hadn't selected and end
          // up with a Delete that nukes a different slide.
          const targetIds = selectedSlideIds.includes(slide.id)
            ? [...selectedSlideIds]
            : [slide.id];
          if (!selectedSlideIds.includes(slide.id)) {
            // Visual treatment for selectedSlideIds is not implemented
            // (only `isCurrent` styles the border), so no DOM update is
            // needed here either — the state mutation is purely logical.
            selectedSlideIds = [slide.id];
          }
          const items = buildContextMenuItems(targetIds, slide.id, e);
          showContextMenu(document.body, items, e.clientX, e.clientY);
        });
      }

      container.appendChild(item);
      if (intersectionObserver) intersectionObserver.observe(item);
    };

    let cursor = 0;
    const buildChunk = (): void => {
      // Token / dispose guard: a follow-up render() (or dispose) since
      // this chunk was scheduled means the panel is already on a new
      // generation; bail before mutating anything.
      if (disposed || activeRenderToken !== myToken) return;
      pendingChunkRAF = null;
      const end = Math.min(cursor + RENDER_CHUNK_SIZE, slides.length);
      for (; cursor < end; cursor++) buildItem(slides[cursor]);
      // Re-apply savedScrollTop only when the browser has clamped it
      // BELOW the target — i.e., scrollHeight was still smaller than
      // savedScrollTop when the previous chunk landed. If the user
      // scrolled past savedScrollTop during a between-chunk rAF gap on
      // a long deck (~80ms of multi-chunk build for 100+ slides), an
      // unconditional restore would snap them back on every frame. The
      // `<` check leaves user-initiated scrolls intact while still
      // letting the original position creep up as height grows.
      if (scrollParent && scrollParent.scrollTop < savedScrollTop) {
        scrollParent.scrollTop = savedScrollTop;
      }
      if (cursor < slides.length) {
        // More chunks remain. Defer via rAF so the browser gets to
        // paint between batches and the main thread stays responsive
        // (input, scroll, repainting the rest of the editor).
        if (typeof requestAnimationFrame !== 'undefined') {
          pendingChunkRAF = requestAnimationFrame(buildChunk);
        } else {
          // No rAF available — degrade to a tight loop. Keeps the
          // single-batch test environments deterministic.
          buildChunk();
        }
        return;
      }
      // All chunks done. The IO-less fallback path paints synchronously
      // here because there is no observer to drive lazy paints. Done
      // once at the tail so the no-IO env still sees every thumb
      // painted before mount returns to the caller.
      if (!intersectionObserver) {
        for (const [id, s] of state) paintThumb(id, s);
      }
    };

    // First chunk runs synchronously so the panel is non-empty by the
    // time mount() returns and the next animation frame paints. Without
    // this, very small decks would still incur a frame of empty panel.
    buildChunk();
  };

  // Current-slide change is highlight-only — flip the `.current` class
  // and border color on existing items. Avoids a full render() (which
  // would wipe innerHTML, dispose every painted canvas, and cause a
  // one-frame blank flash before IntersectionObserver re-fires). The
  // panel used to subscribe to onSelectionChange as a proxy, but that
  // fired on every element click on the canvas, causing wasted renders
  // and (with the old non-scroll-preserving render) a snap-to-top each
  // time selection cleared.
  const off = editor.onCurrentSlideChange(() => syncCurrentHighlight());

  // Make the panel a keyboard-focusable host so ArrowUp/Down navigate
  // slides when the user clicks a thumbnail or tabs in. No visible
  // focus ring on the container itself — the `.current` thumb already
  // shows where we are.
  if (!container.hasAttribute('tabindex')) container.tabIndex = 0;
  container.style.outline = 'none';
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Defer to the canvas element-nudge rule (interactions/keyboard.ts)
    // when the user has a canvas selection. After clicking a thumbnail
    // the panel container keeps focus (canvas isn't focusable, so
    // selecting an element on the canvas doesn't move focus away), and
    // without this gate ArrowUp/Down would steal the user's nudge —
    // switching slides AND clearing their selection.
    if (editor.getSelection().length > 0) return;
    const slides = store.read().slides;
    if (slides.length === 0) return;
    const currentId = editor.getCurrentSlideId();
    const idx = slides.findIndex((s) => s.id === currentId);
    if (idx === -1) return;
    const nextIdx =
      e.key === 'ArrowUp'
        ? Math.max(0, idx - 1)
        : Math.min(slides.length - 1, idx + 1);
    if (nextIdx === idx) return;
    e.preventDefault();
    selectedSlideIds = [slides[nextIdx].id];
    editor.setCurrentSlide(slides[nextIdx].id);
    // The onCurrentSlideChange listener has already re-rendered, so
    // the new thumb element exists. Scroll it into view if off-screen.
    // scrollIntoView is missing from jsdom; the optional-chain guard
    // keeps unit tests happy.
    const newItem = container.querySelector<HTMLDivElement>(
      `[data-slide-id="${slides[nextIdx].id}"]`,
    );
    newItem?.scrollIntoView?.({ block: 'nearest' });
  });

  // Re-render when the panel's host element changes width (user drags
  // the column resizer in slides-view.tsx). Skip the no-op tick where
  // the computed thumb size hasn't actually moved off the last value,
  // so editor selection changes that happen to coincide don't render
  // twice. ResizeObserver isn't in jsdom by default — fall through to
  // a one-shot render in that case so the panel still mounts.
  let lastOuterW = -1;
  let resizeObserver: ResizeObserver | null = null;
  const renderIfSizeChanged = (): void => {
    const { outerW } = computeThumbDims(container.clientWidth);
    if (outerW === lastOuterW) return;
    lastOuterW = outerW;
    render();
  };
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => renderIfSizeChanged());
    resizeObserver.observe(container);
  }

  // Seed lastOuterW so the observer's first synchronous fire is a
  // no-op (it would otherwise paint the same frame twice on mount).
  lastOuterW = computeThumbDims(container.clientWidth).outerW;
  render();

  // Lightweight repaint path for content-only store changes (frame
  // drag, color tweak, text edit). Walks the existing state map,
  // re-snapshots each thumb's slide + doc to the latest store read so
  // subsequent lazy paints see fresh data, and schedules a repaint
  // for thumbs that have already been painted at least once. Unpainted
  // (off-screen) thumbs intentionally aren't repainted here — they'll
  // pick up the fresh state when their IntersectionObserver entry
  // fires.
  //
  // Routes repaints through `ThumbnailScheduler` instead of calling
  // `paintThumb` synchronously. Without this, a peer's drag commits
  // (or a local burst of edits) firing N onChange events per frame
  // would each trigger M synchronous paints — O(N×M). The scheduler
  // collapses bursts into one paint per affected thumb per debounce
  // window.
  //
  // Falls back to a full structural `render()` when the state map's
  // slide-id sequence diverges from the store's — that means a slide
  // was added, removed, or reordered (remote peer most likely). The
  // panel's caller only fires `refresh()` on count changes, so without
  // this fallback a remote reorder with the same count would silently
  // leave the DOM order pointing at the wrong slides.
  const refreshContent = (): void => {
    if (state.size === 0) return;
    const doc = store.read();
    if (!stateMatchesSlideOrder(doc.slides)) {
      render();
      return;
    }
    for (const [id, s] of state) {
      const slide = doc.slides.find((sl) => sl.id === id);
      // Guarded above by stateMatchesSlideOrder; defensive only.
      if (!slide) continue;
      s.slide = slide;
      s.doc = doc;
      if (s.painted) scheduler.schedule(id);
    }
  };

  // `state` (insertion-ordered Map) vs `doc.slides` (the authoritative
  // store order). Returns true iff every id appears in both, in the
  // same position. Cheap O(n) check — runs once per `refreshContent`.
  const stateMatchesSlideOrder = (slides: readonly Slide[]): boolean => {
    if (slides.length !== state.size) return false;
    let i = 0;
    for (const id of state.keys()) {
      if (slides[i].id !== id) return false;
      i++;
    }
    return true;
  };

  return {
    refresh: render,
    refreshContent,
    dispose: () => {
      // Order matters: flip `disposed` first so any pending scheduler
      // tick OR chunked-render rAF that fires between the disconnects
      // below and GC bails out before touching torn-down canvas state.
      disposed = true;
      off();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      intersectionObserver = null;
      cancelPendingChunk();
      // Drop the scheduler's pending timer outright. The disposed-flag
      // guard inside the onFlush would also catch this, but explicit
      // cancel keeps the lifecycle from depending on that guard.
      scheduler.cancel();
      state.clear();
    },
    getSelectedSlideIds: () => [...selectedSlideIds],
  };
}
