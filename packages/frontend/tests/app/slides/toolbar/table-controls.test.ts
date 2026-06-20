// @vitest-environment jsdom
/**
 * Behavioral tests for the TableControls cell-padding dropdown.
 *
 * Asserts that picking a uniform padding preset patches every targeted
 * cell's style through `store.updateTableCellStyle`, inside a single
 * `store.batch`. Radix DropdownMenu opens on a full pointerdown ->
 * pointerup -> click sequence in jsdom (see line-spacing-picker.test.ts),
 * not a synthetic `.click()`.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createElement as h, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { TooltipProvider } from '../../../../src/components/ui/tooltip.tsx';
import { TableControls } from '../../../../src/app/slides/toolbar/table-controls.tsx';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ui: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(h(TooltipProvider, null, ui));
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

function pointerClick(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    );
    el.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }),
    );
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

// A 2x2 table with empty cells. `cell()` carries the minimal shape the
// component reads (style + span markers).
function makeTable(id: string) {
  const cell = () => ({ body: { blocks: [] }, style: {} });
  return {
    id,
    type: 'table' as const,
    frame: { x: 0, y: 0, w: 200, h: 80, rotation: 0 },
    data: {
      columnWidths: [100, 100],
      rows: [
        { height: 40, cells: [cell(), cell()] },
        { height: 40, cells: [cell(), cell()] },
      ],
    },
  };
}

/** Minimal store/editor doubles covering only what TableControls reads. */
function makeFixture(table: ReturnType<typeof makeTable>) {
  const updateTableCellStyle = vi.fn();
  const batch = vi.fn((fn: () => void) => fn());
  const store = {
    read: () => ({
      slides: [{ id: 's1', elements: [table] }],
      meta: { recentColors: [] },
    }),
    batch,
    updateTableCellStyle,
    pushRecentColor: vi.fn(),
  };
  const editor = { getCurrentSlideId: () => 's1' };
  // The component's prop types are the real slides types; the doubles
  // satisfy the read surface, so cast through unknown at the call site.
  return { store, editor, updateTableCellStyle, batch };
}

function openPaddingMenu(elHost: HTMLElement): HTMLElement[] {
  const trigger = elHost.querySelector(
    '[aria-label="Cell padding"]',
  ) as HTMLElement;
  pointerClick(trigger);
  return [...document.body.querySelectorAll('[role="menuitem"]')] as HTMLElement[];
}

describe('TableControls — cell padding', () => {
  test('picking a preset patches every cell with uniform padding in one batch', () => {
    const table = makeTable('t1');
    const { store, editor, updateTableCellStyle, batch } = makeFixture(table);

    const el = render(
      h(TableControls, {
        editor: editor as never,
        store: store as never,
        theme: null,
        ids: ['t1'],
        cellRange: null,
      }),
    );

    const items = openPaddingMenu(el);
    const five = items.find((n) => n.textContent === '5 px');
    expect(five).toBeTruthy();
    pointerClick(five!);

    // One batch, four cells, each with the uniform padding patch.
    expect(batch).toHaveBeenCalledTimes(1);
    expect(updateTableCellStyle).toHaveBeenCalledTimes(4);
    const pad = { top: 5, right: 5, bottom: 5, left: 5 };
    for (const [, , , , patch] of updateTableCellStyle.mock.calls) {
      expect(patch).toEqual({ padding: pad });
    }
    // Covers each of the 2x2 coordinates exactly once.
    const coords = updateTableCellStyle.mock.calls
      .map(([, , row, col]) => `${row},${col}`)
      .sort();
    expect(coords).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  test('a cell range scopes the padding to the selected cells only', () => {
    const table = makeTable('t1');
    const { store, editor, updateTableCellStyle } = makeFixture(table);

    const el = render(
      h(TableControls, {
        editor: editor as never,
        store: store as never,
        theme: null,
        ids: ['t1'],
        // Just the top row (0,0)-(0,1).
        cellRange: { tableId: 't1', r0: 0, c0: 0, r1: 0, c1: 1 },
      }),
    );

    const items = openPaddingMenu(el);
    const zero = items.find((n) => n.textContent === '0 px');
    pointerClick(zero!);

    expect(updateTableCellStyle).toHaveBeenCalledTimes(2);
    const coords = updateTableCellStyle.mock.calls
      .map(([, , row, col]) => `${row},${col}`)
      .sort();
    expect(coords).toEqual(['0,0', '0,1']);
  });
});
