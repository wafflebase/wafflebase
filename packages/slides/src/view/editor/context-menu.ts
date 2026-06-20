/**
 * Vanilla-DOM context menu used by the slides editor. The slides
 * package has no React dependency, so the in-package menu mounts a
 * `<ul>` directly into a host element. Phase 4's frontend wrapper can
 * swap in Radix `ContextMenu` by intercepting the `contextmenu` event
 * before it reaches the editor.
 */

export interface ContextMenuItem {
  label: string;
  run: () => void;
  disabled?: boolean;
  /**
   * Opt this item into a radio-group display: when set to `true` or
   * `false`, the menu draws a check-mark column (`✓` for selected
   * items, three spaces for non-selected items so labels stay
   * column-aligned). Items that leave the field `undefined` render
   * without any prefix, so unrelated action items in the same menu
   * are not visually shifted. Has no effect on `run()` semantics.
   */
  selected?: boolean;
  /** Use a horizontal divider when label is the literal string '---'. */
}

let activeMenu: HTMLUListElement | null = null;
let activeCleanup: (() => void) | null = null;

export function showContextMenu(
  host: HTMLElement,
  items: readonly ContextMenuItem[],
  anchorX: number,
  anchorY: number,
): void {
  // Close any existing menu — only one can be open at a time.
  dismiss();

  const menu = document.createElement('ul');
  menu.className = 'wfb-slides-context-menu';
  menu.style.position = 'fixed';
  menu.style.background = '#2a2a2a';
  menu.style.border = '1px solid #444';
  menu.style.borderRadius = '4px';
  menu.style.padding = '4px 0';
  menu.style.margin = '0';
  menu.style.listStyle = 'none';
  menu.style.zIndex = '9999';
  menu.style.minWidth = '180px';
  menu.style.fontFamily = 'system-ui, sans-serif';
  menu.style.fontSize = '13px';
  menu.style.color = '#ddd';
  menu.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.5)';

  for (const item of items) {
    if (item.label === '---') {
      const sep = document.createElement('li');
      sep.style.borderTop = '1px solid #444';
      sep.style.margin = '4px 0';
      menu.appendChild(sep);
      continue;
    }
    const li = document.createElement('li');
    // Per-item radio group: items opt in by setting `selected` to a
    // boolean. Action items leave it undefined and render with no
    // prefix, so a single radio group inside the menu doesn't leak
    // the column onto unrelated entries.
    li.textContent = item.selected === undefined
      ? item.label
      : item.selected
        ? `✓ ${item.label}`
        : `   ${item.label}`;
    li.style.padding = '6px 16px';
    li.style.cursor = item.disabled ? 'default' : 'pointer';
    if (item.disabled) {
      li.style.opacity = '0.5';
    } else {
      li.addEventListener('pointerenter', () => {
        li.style.background = '#3a7';
        li.style.color = '#fff';
      });
      li.addEventListener('pointerleave', () => {
        li.style.background = 'transparent';
        li.style.color = '#ddd';
      });
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        const handler = item.run;
        dismiss();
        handler();
      });
    }
    menu.appendChild(li);
  }

  host.appendChild(menu);

  // Keep the menu inside the viewport. It mounts with `position:
  // fixed`, so its coordinates are viewport-relative. When the anchor
  // sits near the right/bottom edge there isn't room to open down-right
  // and the menu would be clipped, so flip it to open up/left of the
  // anchor; if it still spills (menu taller/wider than the available
  // space), clamp it to the opposite edge.
  const margin = 8;
  const rect = menu.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let left = anchorX;
  let top = anchorY;
  if (left + rect.width > viewportW - margin) {
    left = anchorX - rect.width;
  }
  if (left < margin) {
    left = Math.max(margin, viewportW - rect.width - margin);
  }
  if (top + rect.height > viewportH - margin) {
    top = anchorY - rect.height;
  }
  if (top < margin) {
    top = Math.max(margin, viewportH - rect.height - margin);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  // Dismiss on outside click or Escape.
  const onOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) dismiss();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss();
  };
  // Run AFTER current event loop so the showing right-click doesn't
  // immediately dismiss its own menu via the same event.
  const attachTimer = setTimeout(() => {
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
  }, 0);

  activeMenu = menu;
  activeCleanup = () => {
    // Cancel a pending attach if dismiss() runs before the timer fires.
    // Without this, rapid right-clicks (second contextmenu before the
    // first menu's setTimeout has run) would: dismiss() the first menu
    // → drop the first activeCleanup pointer → the first timer would
    // still fire later and addEventListener `onOutside`/`onKey` to
    // `document` with no removal path. Those orphaned listeners would
    // then dismiss the second menu on the next mousedown anywhere.
    clearTimeout(attachTimer);
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  };
}

export function dismiss(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
}
