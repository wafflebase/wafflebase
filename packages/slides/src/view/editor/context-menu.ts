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
   * `false`, the menu draws a fixed-width check column (a check icon
   * for selected items, an empty slot for the rest so labels stay
   * column-aligned). Items that leave the field `undefined` render
   * without the column, so unrelated action items in the same menu
   * are not visually shifted. Has no effect on `run()` semantics.
   */
  selected?: boolean;
  /** Use a horizontal divider when label is the literal string '---'. */
}

/**
 * Gap kept between the menu and the viewport edge. Shared by the
 * max-height cap and the clamp below it so the two cannot disagree
 * about how much room there is.
 */
const MENU_VIEWPORT_MARGIN = 8;

let activeMenu: HTMLUListElement | null = null;
let activeCleanup: (() => void) | null = null;

/**
 * Whether the primary input is a fingertip. The menu is the one piece
 * of editor chrome a finger has to hit precisely, and its mouse-sized
 * rows (6px of vertical padding, ~28px tall) are well under the ~44px
 * every touch platform's guidance asks for — small enough that picking
 * "Delete" and picking "Duplicate" are the same gesture.
 *
 * Read per call rather than once at module load: a tablet gains and
 * loses its keyboard folio without reloading the page.
 */
function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The leading 16px slot of a radio-group row: Tabler's `IconCheck` when
 * selected, empty otherwise. Drawn with `currentColor` so it follows the
 * row's text through hover and theme. The check carries an accessible name
 * because it replaced a `✓` text glyph that screen readers announced as
 * part of the row; the empty slot is decoration.
 */
function createCheckSlot(selected: boolean): HTMLSpanElement {
  const slot = document.createElement('span');
  slot.style.display = 'inline-flex';
  slot.style.flex = '0 0 16px';
  slot.style.width = '16px';
  slot.style.height = '16px';
  slot.style.alignItems = 'center';
  slot.style.justifyContent = 'center';
  if (!selected) {
    slot.setAttribute('aria-hidden', 'true');
    return slot;
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Selected');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M5 12l5 5l10 -10');
  svg.appendChild(path);
  slot.appendChild(svg);
  return slot;
}

export function showContextMenu(
  host: HTMLElement,
  items: readonly ContextMenuItem[],
  anchorX: number,
  anchorY: number,
): void {
  // Close any existing menu — only one can be open at a time.
  dismiss();

  const coarse = isCoarsePointer();

  const menu = document.createElement('ul');
  menu.className = 'wfb-slides-context-menu';
  menu.style.position = 'fixed';
  // Themed from the app's tokens so it reads as the same family as the
  // Radix menus (`components/ui/context-menu.tsx`): popover surface,
  // hairline border, 4px inset, md shadow, accent hover. The slides package
  // ships no stylesheet, so every value is a custom property with a
  // fallback — the light popover look — for a host that never loaded
  // `tokens.css`. The frontend does load it, so the menu follows `.dark`
  // like every other menu.
  menu.style.background = 'var(--popover, #ffffff)';
  menu.style.color = 'var(--popover-foreground, #09090b)';
  menu.style.border = '1px solid var(--border, #e4e4e7)';
  menu.style.borderRadius = 'calc(var(--radius, 0.3rem) - 2px)';
  menu.style.padding = '4px';
  menu.style.margin = '0';
  menu.style.listStyle = 'none';
  menu.style.zIndex = '9999';
  menu.style.minWidth = coarse ? '220px' : '180px';
  menu.style.fontFamily = 'var(--font-body, system-ui, sans-serif)';
  menu.style.fontSize = coarse ? '15px' : '14px';
  // A long menu (the table one runs past a dozen entries) at touch row
  // height can be taller than a phone. Cap it and let it scroll rather
  // than letting the viewport clamp below push entries off-screen.
  //
  // Sized from `window.innerHeight`, NOT `100vh`, and set before the
  // measurement below reads it back. On mobile Safari and Chrome `100vh`
  // is the LARGE viewport — the height with the URL bar retracted —
  // while `innerHeight` shrinks when the bar is showing. Mixing the two
  // lets the cap exceed the clamp's idea of the screen by ~80px, so the
  // last rows land below the fold, and a `position: fixed` element
  // cannot be scrolled to. That is exactly the platform the cap exists
  // for.
  menu.style.maxHeight = `${Math.max(0, window.innerHeight - 2 * MENU_VIEWPORT_MARGIN)}px`;
  menu.style.overflowY = 'auto';
  // Tailwind's `shadow-md`, which the Radix menus use.
  menu.style.boxShadow =
    '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)';

  for (const item of items) {
    if (item.label === '---') {
      const sep = document.createElement('li');
      sep.style.borderTop = '1px solid var(--border, #e4e4e7)';
      // Bleed across the menu's 4px inset, as the Radix separator does.
      sep.style.margin = '4px -4px';
      menu.appendChild(sep);
      continue;
    }
    const li = document.createElement('li');
    // Per-item radio group: items opt in by setting `selected` to a
    // boolean and get a fixed-width leading slot, checked or empty, so
    // the group's labels stay aligned. Action items leave it undefined
    // and render with no slot, so a single radio group inside the menu
    // doesn't leak the column onto unrelated entries.
    if (item.selected === undefined) {
      li.textContent = item.label;
    } else {
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      li.style.gap = '8px';
      li.dataset.selected = String(item.selected);
      li.appendChild(createCheckSlot(item.selected));
      const label = document.createElement('span');
      label.textContent = item.label;
      li.appendChild(label);
    }
    // Rows match the Radix item (6px × 8px around a 20px line = 32px) on
    // a mouse. On a fingertip 13px around an 18px line lands the row at
    // 44px, the smallest target every touch platform's guidance accepts.
    li.style.padding = coarse ? '13px 8px' : '6px 8px';
    li.style.lineHeight = coarse ? '18px' : '20px';
    li.style.borderRadius = 'calc(var(--radius, 0.3rem) - 2.4px)';
    li.style.cursor = item.disabled ? 'default' : 'pointer';
    if (item.disabled) {
      li.style.opacity = '0.5';
    } else {
      li.addEventListener('pointerenter', () => {
        // Hover is the neutral accent wash, as in the Radix menus — never
        // the syrup accent, which is reserved for the action.
        li.style.background = 'var(--accent, #f4f4f5)';
        li.style.color = 'var(--accent-foreground, #18181b)';
      });
      li.addEventListener('pointerleave', () => {
        li.style.background = 'transparent';
        li.style.color = '';
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
  const margin = MENU_VIEWPORT_MARGIN;
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
