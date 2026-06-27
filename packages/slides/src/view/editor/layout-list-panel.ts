import { BUILT_IN_LAYOUTS } from '../../model/layout';
import { renderLayoutPreview } from '../canvas/layout-preview';
import type { SlidesStore } from '../../store/store';

const PREVIEW_W = 160;
const PREVIEW_H = 90;

export interface MountLayoutListPanelOptions {
  /** The layout currently being edited; its row carries the marker. */
  selectedLayoutId?: string;
  /** Called when the user picks a layout row to edit. */
  onSelect: (layoutId: string) => void;
}

export interface LayoutListPanelHandle {
  /** Move the selection marker to a different layout row. */
  setSelectedLayoutId(layoutId: string): void;
  /**
   * Rebuild the preview canvases from the current store — call after a
   * theme / master / layout-geometry edit so the rail reflects it.
   */
  refresh(): void;
  /** Remove the panel DOM and detach store subscriptions. */
  dispose(): void;
}

/**
 * Mount the layout-edit rail (PR3 commit 5c). While layout-edit mode is
 * active this replaces the slide thumbnail panel with a vertical list of
 * the deck's layouts; clicking a row drives the editor to edit that
 * layout. Pure vanilla DOM, mirroring `mountThumbnailPanel` /
 * `showLayoutPicker` so the frontend mounts it the same way.
 */
export function mountLayoutListPanel(
  container: HTMLElement,
  store: SlidesStore,
  options: MountLayoutListPanelOptions,
): LayoutListPanelHandle {
  let selectedLayoutId = options.selectedLayoutId;

  const root = document.createElement('div');
  root.className = 'wfb-slides-layout-list';
  root.setAttribute('role', 'listbox');
  root.setAttribute('aria-label', 'Layouts');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '8px';
  root.style.padding = '8px';
  container.appendChild(root);

  function applySelection(): void {
    for (const row of root.querySelectorAll<HTMLElement>('[data-layout-id]')) {
      const on = row.dataset.layoutId === selectedLayoutId;
      row.dataset.selected = String(on);
      row.setAttribute('aria-selected', String(on));
      row.style.outline = on
        ? '2px solid var(--primary, #3a7)'
        : '1px solid var(--border, #444)';
    }
  }

  function build(): void {
    root.replaceChildren();
    const doc = store.read();
    const theme =
      doc.themes.find((t) => t.id === doc.meta.themeId) ?? doc.themes[0];
    const master =
      doc.masters.find((m) => m.id === doc.meta.masterId) ?? doc.masters[0];
    // Edit the document-local layouts when present so previews show
    // builder edits; fall back to the shared built-ins for pre-PR1 docs.
    const layouts = doc.layouts.length > 0 ? doc.layouts : BUILT_IN_LAYOUTS;

    for (const layout of layouts) {
      const row = document.createElement('div');
      row.dataset.layoutId = layout.id;
      row.tabIndex = 0;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-label', layout.name);
      row.style.cursor = 'pointer';
      row.style.boxSizing = 'border-box';
      row.style.padding = '4px';
      row.style.borderRadius = '4px';

      const canvas = renderLayoutPreview(layout, theme, master, {
        w: PREVIEW_W,
        h: PREVIEW_H,
      });
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      canvas.style.display = 'block';
      row.appendChild(canvas);

      const label = document.createElement('div');
      label.textContent = layout.name;
      label.style.fontSize = '12px';
      label.style.marginTop = '4px';
      label.style.textAlign = 'center';
      row.appendChild(label);

      const pick = (): void => options.onSelect(layout.id);
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
      root.appendChild(row);
    }
    applySelection();
  }

  build();
  const unsubscribe = store.onChange?.(() => build());

  return {
    setSelectedLayoutId(layoutId: string): void {
      selectedLayoutId = layoutId;
      applySelection();
    },
    refresh(): void {
      build();
    },
    dispose(): void {
      unsubscribe?.();
      root.remove();
    },
  };
}
