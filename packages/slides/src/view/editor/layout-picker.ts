import { BUILT_IN_LAYOUTS } from '../../model/layout';
import { renderLayoutPreview } from '../canvas/layout-preview';
import type { SlidesStore } from '../../store/store';

const PREVIEW_W = 160;
const PREVIEW_H = 90;

export interface LayoutPickerOptions {
  store: SlidesStore;
  /** When set, the matching cell is outlined. Omit when inserting a new slide. */
  selectedLayoutId?: string;
  /** Top-left anchor in viewport coords (clientX/clientY). */
  anchor: { x: number; y: number };
  onPick: (layoutId: string) => void;
  onClose: () => void;
}

/**
 * Mount a vanilla-DOM layout picker popover into `host`. The popover
 * shows a 4-column grid of canvas previews (one per BUILT_IN_LAYOUTS
 * entry) and resolves through `onPick` on cell click. Outside-click
 * and Escape both call `onClose` only.
 */
export function showLayoutPicker(
  host: HTMLElement,
  opts: LayoutPickerOptions,
): void {
  const popover = document.createElement('div');
  popover.className = 'wfb-slides-layout-picker';
  popover.setAttribute('role', 'listbox');
  popover.setAttribute('aria-label', 'Choose a layout');
  popover.style.position = 'fixed';
  popover.style.left = `${opts.anchor.x}px`;
  popover.style.top = `${opts.anchor.y}px`;
  popover.style.background = '#2a2a2a';
  popover.style.border = '1px solid #444';
  popover.style.borderRadius = '6px';
  popover.style.padding = '8px';
  popover.style.zIndex = '9999';
  popover.style.boxShadow = '0 6px 24px rgba(0, 0, 0, 0.5)';
  popover.style.display = 'grid';
  popover.style.gridTemplateColumns = `repeat(4, ${PREVIEW_W}px)`;
  popover.style.gap = '8px';

  const doc = opts.store.read();
  const theme =
    doc.themes.find((t) => t.id === doc.meta.themeId) ?? doc.themes[0];
  const master =
    doc.masters.find((m) => m.id === doc.meta.masterId) ?? doc.masters[0];

  for (const layout of BUILT_IN_LAYOUTS) {
    const cell = document.createElement('div');
    cell.dataset.layoutId = layout.id;
    cell.tabIndex = 0;
    cell.setAttribute('role', 'option');
    cell.setAttribute('aria-label', layout.name);
    cell.setAttribute(
      'aria-selected',
      String(layout.id === opts.selectedLayoutId),
    );
    cell.style.cursor = 'pointer';
    cell.style.padding = '4px';
    cell.style.borderRadius = '4px';
    if (layout.id === opts.selectedLayoutId) {
      cell.dataset.selected = 'true';
      cell.style.outline = '2px solid #3a7';
    } else {
      cell.style.outline = '1px solid #444';
    }
    const canvas = renderLayoutPreview(layout, theme, master, {
      w: PREVIEW_W,
      h: PREVIEW_H,
    });
    cell.appendChild(canvas);
    const label = document.createElement('div');
    label.textContent = layout.name;
    label.style.fontSize = '12px';
    label.style.color = '#ddd';
    label.style.marginTop = '4px';
    label.style.textAlign = 'center';
    cell.appendChild(label);
    cell.addEventListener('click', () => {
      opts.onPick(layout.id);
      close();
    });
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        opts.onPick(layout.id);
        close();
      }
    });
    popover.appendChild(cell);
  }

  function close(): void {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onOutside, true);
    popover.remove();
    opts.onClose();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
  function onOutside(e: MouseEvent): void {
    if (!popover.contains(e.target as Node)) close();
  }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onOutside, true);

  host.appendChild(popover);

  // Clamp to viewport so the grid is never clipped on right/bottom edges.
  const rect = popover.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    popover.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
  }
  if (rect.bottom > window.innerHeight) {
    popover.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
  }

  // Move keyboard focus into the popover so screen readers and
  // keyboard-only users can drive the picker. Prefer the currently
  // selected cell; otherwise focus the first cell.
  const focusTarget =
    popover.querySelector<HTMLElement>('[data-selected="true"]')
    ?? popover.querySelector<HTMLElement>('[tabindex="0"]');
  focusTarget?.focus();
}
