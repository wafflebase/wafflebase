import type { SlidesStore } from '../../store/store';
import type { SlidesEditor } from './editor';
import { renderThumbnail } from '../canvas/thumbnail';
import { showContextMenu, type ContextMenuItem } from './context-menu';
import { showLayoutPicker } from './layout-picker';

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
   * Re-render the panel from the current store + editor state. Call
   * this after any store change the panel doesn't observe directly
   * (e.g. T2's Cmd+D adding a slide via the keyboard rule).
   */
  refresh(): void;
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
): ThumbnailPanelHandle {
  let selectedSlideIds: string[] = [];

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

  const render = (): void => {
    container.innerHTML = '';
    const dims = computeThumbDims(container.clientWidth);
    // Read DPR per render so a window dragged between Retina and a
    // non-Retina monitor mid-session also re-paints at the right density.
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;
    const doc = store.read();
    const currentId = editor.getCurrentSlideId();
    for (const slide of doc.slides) {
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
      item.draggable = true;

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
        renderThumbnail(ctx, slide, doc, {
          hostWidth: dims.innerW,
          hostHeight: dims.innerH,
          dpr,
        });
      }
      item.appendChild(canvas);

      item.addEventListener('mousedown', (e) => {
        if (e.shiftKey) {
          // Toggle slide-level multi-selection. Shift-click does NOT
          // change the rendered slide — that's handled by plain click.
          const idx = selectedSlideIds.indexOf(slide.id);
          if (idx === -1) selectedSlideIds.push(slide.id);
          else            selectedSlideIds.splice(idx, 1);
          render();
          return;
        }
        selectedSlideIds = [slide.id];
        editor.setCurrentSlide(slide.id);
        // setCurrentSlide may not fire onSelectionChange (when element
        // selection was already empty). Force a re-render so the
        // .current highlight updates.
        render();
      });

      // HTML5 drag-and-drop reorder. jsdom only partially implements
      // dataTransfer, so unit-level coverage is skipped; T6 visual
      // verifies the path.
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
          selectedSlideIds = [slide.id];
          render();
        }
        const items = buildContextMenuItems(targetIds, slide.id, e);
        showContextMenu(document.body, items, e.clientX, e.clientY);
      });

      container.appendChild(item);
    }
  };

  // Re-render when the editor's selection changes — this is a cheap
  // proxy for many editor mutations (selection clear on slide switch,
  // etc.) and the thumbnail draw is fast.
  const off = editor.onSelectionChange(() => render());

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

  return {
    refresh: render,
    dispose: () => {
      off();
      resizeObserver?.disconnect();
    },
    getSelectedSlideIds: () => [...selectedSlideIds],
  };
}
