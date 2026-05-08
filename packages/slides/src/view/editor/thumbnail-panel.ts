import type { SlidesStore } from '../../store/store';
import type { SlidesEditor } from './editor';
import { renderThumbnail } from '../canvas/thumbnail';

const THUMB_W = 192;
const THUMB_H = 108;

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
 * selection); HTML5 drag-and-drop reorders via `store.moveSlide`; a
 * "+" button at the bottom appends a new blank slide.
 */
export function mountThumbnailPanel(
  container: HTMLElement,
  store: SlidesStore,
  editor: SlidesEditor,
): ThumbnailPanelHandle {
  let selectedSlideIds: string[] = [];

  const render = (): void => {
    container.innerHTML = '';
    const doc = store.read();
    const currentId = editor.getCurrentSlideId();
    for (const slide of doc.slides) {
      const item = document.createElement('div');
      item.dataset.slideId = slide.id;
      const isCurrent = slide.id === currentId;
      item.className = 'wfb-slides-thumb' + (isCurrent ? ' current' : '');
      item.style.width = `${THUMB_W}px`;
      item.style.height = `${THUMB_H}px`;
      item.style.cursor = 'pointer';
      item.style.outline = isCurrent ? '2px solid #3a7' : '1px solid #444';
      item.style.marginBottom = '8px';
      item.draggable = true;

      const canvas = document.createElement('canvas');
      canvas.width = THUMB_W;
      canvas.height = THUMB_H;
      canvas.style.width = `${THUMB_W}px`;
      canvas.style.height = `${THUMB_H}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        renderThumbnail(ctx, slide, doc, {
          hostWidth: THUMB_W,
          hostHeight: THUMB_H,
          dpr: 1,
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

      container.appendChild(item);
    }

    // "+" Add-slide button at the bottom.
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add slide';
    addBtn.style.width = `${THUMB_W}px`;
    addBtn.addEventListener('click', () => {
      store.batch(() => store.addSlide('blank'));
      render();
    });
    container.appendChild(addBtn);
  };

  // Re-render when the editor's selection changes — this is a cheap
  // proxy for many editor mutations (selection clear on slide switch,
  // etc.) and the thumbnail draw is fast.
  const off = editor.onSelectionChange(() => render());

  render();

  return {
    refresh: render,
    dispose: () => off(),
    getSelectedSlideIds: () => [...selectedSlideIds],
  };
}
