import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Spreadsheet } from '@wafflebase/sheets';
import { SheetContextMenu } from '@/components/sheet-context-menu';

type Range = [{ r: number; c: number }, { r: number; c: number }];
type Hit = { axis: 'row' | 'column'; index: number } | null;

function createSpreadsheet(options: {
  hit?: Hit;
  range?: Range;
  indices?: { axis: 'row' | 'column'; from: number; to: number } | null;
  freeze?: { frozenRows: number; frozenCols: number };
}) {
  const range = options.range ?? [
    { r: 2, c: 2 },
    { r: 2, c: 2 },
  ];
  return {
    headerHitTest: vi.fn(() => options.hit ?? null),
    getSelectedIndices: vi.fn(() => options.indices ?? null),
    selectRow: vi.fn(),
    selectColumn: vi.fn(),
    cellRefFromPoint: vi.fn(() => range[0]),
    getSelectionRangeOrActiveCell: vi.fn(() => range),
    isOnSelectionEdge: vi.fn(() => false),
    selectStart: vi.fn(),
    findAdjacentHiddenRows: vi.fn(() => []),
    findAdjacentHiddenColumns: vi.fn(() => []),
    hideRows: vi.fn(),
    hideColumns: vi.fn(),
    showRows: vi.fn(),
    showColumns: vi.fn(),
    insertRows: vi.fn().mockResolvedValue(undefined),
    insertColumns: vi.fn().mockResolvedValue(undefined),
    deleteRows: vi.fn().mockResolvedValue(undefined),
    deleteColumns: vi.fn().mockResolvedValue(undefined),
    getFreezePane: vi.fn(
      () => options.freeze ?? { frozenRows: 0, frozenCols: 0 },
    ),
    setFreezePane: vi.fn().mockResolvedValue(undefined),
  };
}

function renderMenu(
  spreadsheet: ReturnType<typeof createSpreadsheet>,
  props: Partial<React.ComponentProps<typeof SheetContextMenu>> = {},
) {
  render(
    <SheetContextMenu
      spreadsheet={spreadsheet as unknown as Spreadsheet}
      onCopy={vi.fn()}
      onCut={vi.fn()}
      onPaste={vi.fn()}
      onDeleteCellData={vi.fn()}
      onInsertBefore={vi.fn()}
      onInsertAfter={vi.fn()}
      onDeleteRowCol={vi.fn()}
      {...props}
    >
      <div data-testid="grid" />
    </SheetContextMenu>,
  );
  fireEvent.contextMenu(screen.getByTestId('grid'), {
    clientX: 100,
    clientY: 100,
  });
}

describe('SheetContextMenu cell menu', () => {
  it('offers Google-ordered insert and delete for a single cell', async () => {
    renderMenu(createSpreadsheet({}));

    const labels = (await screen.findAllByRole('menuitem')).map(
      (item) => item.textContent?.trim(),
    );
    const structural = labels.filter((label) =>
      /^(Insert|Delete) (row|column)/.test(label ?? ''),
    );
    expect(structural).toEqual([
      'Insert row above',
      'Insert row below',
      'Insert column left',
      'Insert column right',
      'Delete row',
      'Delete column',
    ]);
  });

  it('counts the rows and columns a multi-cell selection spans', async () => {
    const spreadsheet = createSpreadsheet({
      // Drawn bottom-right to top-left: the counts must not depend on it.
      range: [
        { r: 6, c: 4 },
        { r: 4, c: 3 },
      ],
    });
    renderMenu(spreadsheet);

    expect(
      await screen.findByRole('menuitem', { name: 'Insert 3 rows above' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: 'Insert 2 columns right' }),
    ).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete 3 rows' })).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: 'Delete 2 columns' }),
    ).toBeTruthy();
  });

  it.each([
    ['Insert 3 rows above', 'insertRows', [4, 3]],
    ['Insert 3 rows below', 'insertRows', [7, 3]],
    ['Insert 2 columns left', 'insertColumns', [3, 2]],
    ['Insert 2 columns right', 'insertColumns', [5, 2]],
    ['Delete 3 rows', 'deleteRows', [4, 3]],
    ['Delete 2 columns', 'deleteColumns', [3, 2]],
  ] as const)(
    '%s calls the same structural edit the header menu uses',
    async (label, method, args) => {
      const spreadsheet = createSpreadsheet({
        range: [
          { r: 4, c: 3 },
          { r: 6, c: 4 },
        ],
      });
      renderMenu(spreadsheet);

      fireEvent.click(await screen.findByRole('menuitem', { name: label }));

      await waitFor(() => {
        expect(spreadsheet[method]).toHaveBeenCalledWith(...args);
      });
    },
  );

  it('disables structural edits on a read-only mount', async () => {
    renderMenu(createSpreadsheet({}), { readOnly: true });

    const item = await screen.findByRole('menuitem', {
      name: 'Insert row above',
    });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(
      screen
        .getByRole('menuitem', { name: 'Delete column' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('disables structural edits on a pivot output tab', async () => {
    renderMenu(createSpreadsheet({}), { structureLocked: true });

    const item = await screen.findByRole('menuitem', {
      name: 'Insert row above',
    });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    // Copy is still a read, so it stays available.
    expect(
      screen.getByRole('menuitem', { name: 'Copy' }).getAttribute('aria-disabled'),
    ).toBeNull();
  });
});

describe('SheetContextMenu scrolling', () => {
  it('scrolls a menu taller than the space available instead of clipping it', async () => {
    renderMenu(createSpreadsheet({}));

    const menu = await screen.findByRole('menu');
    expect(menu.className).toContain(
      'max-h-(--radix-context-menu-content-available-height)',
    );
    expect(menu.className).toContain('overflow-y-auto');
    expect(menu.className).not.toMatch(/(^|\s)overflow-hidden(\s|$)/);
  });
});

describe('SheetContextMenu header freeze', () => {
  it('freezes up to the right-clicked row, keeping frozen columns', async () => {
    const spreadsheet = createSpreadsheet({
      hit: { axis: 'row', index: 3 },
      indices: { axis: 'row', from: 3, to: 3 },
      freeze: { frozenRows: 0, frozenCols: 2 },
    });
    renderMenu(spreadsheet);

    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Freeze up to row 3' }),
    );

    await waitFor(() => {
      expect(spreadsheet.setFreezePane).toHaveBeenCalledWith(3, 2);
    });
    expect(screen.queryByRole('menuitem', { name: 'Unfreeze rows' })).toBeNull();
  });

  it('freezes up to the last column of a multi-column selection', async () => {
    const spreadsheet = createSpreadsheet({
      hit: { axis: 'column', index: 2 },
      indices: { axis: 'column', from: 2, to: 3 },
      freeze: { frozenRows: 1, frozenCols: 0 },
    });
    renderMenu(spreadsheet);

    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Freeze up to column C' }),
    );

    await waitFor(() => {
      expect(spreadsheet.setFreezePane).toHaveBeenCalledWith(1, 3);
    });
  });

  it('keeps the other axis as it is at click time, not at open time', async () => {
    const spreadsheet = createSpreadsheet({
      hit: { axis: 'row', index: 3 },
      indices: { axis: 'row', from: 3, to: 3 },
      freeze: { frozenRows: 0, frozenCols: 2 },
    });
    renderMenu(spreadsheet);
    const item = await screen.findByRole('menuitem', {
      name: 'Freeze up to row 3',
    });

    // A collaborator changes the frozen columns while the menu is open.
    spreadsheet.getFreezePane.mockReturnValue({ frozenRows: 0, frozenCols: 4 });
    fireEvent.click(item);

    await waitFor(() => {
      expect(spreadsheet.setFreezePane).toHaveBeenCalledWith(3, 4);
    });
  });

  it('offers Unfreeze only when that axis is frozen', async () => {
    const spreadsheet = createSpreadsheet({
      hit: { axis: 'row', index: 5 },
      indices: { axis: 'row', from: 5, to: 5 },
      freeze: { frozenRows: 2, frozenCols: 1 },
    });
    renderMenu(spreadsheet);

    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Unfreeze rows' }),
    );

    await waitFor(() => {
      expect(spreadsheet.setFreezePane).toHaveBeenCalledWith(0, 1);
    });
  });

  it('hides Freeze when that boundary is already the frozen one', async () => {
    renderMenu(
      createSpreadsheet({
        hit: { axis: 'row', index: 2 },
        indices: { axis: 'row', from: 2, to: 2 },
        freeze: { frozenRows: 2, frozenCols: 0 },
      }),
    );

    expect(
      await screen.findByRole('menuitem', { name: 'Unfreeze rows' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: 'Freeze up to row 2' }),
    ).toBeNull();
  });

  it('disables freezing on a read-only mount', async () => {
    renderMenu(
      createSpreadsheet({
        hit: { axis: 'column', index: 1 },
        indices: { axis: 'column', from: 1, to: 1 },
      }),
      { readOnly: true },
    );

    const item = await screen.findByRole('menuitem', {
      name: 'Freeze up to column A',
    });
    expect(item.getAttribute('aria-disabled')).toBe('true');
  });

  it('disables header insert and delete on a pivot output tab', async () => {
    renderMenu(
      createSpreadsheet({
        hit: { axis: 'row', index: 2 },
        indices: { axis: 'row', from: 2, to: 2 },
      }),
      { structureLocked: true },
    );

    const item = await screen.findByRole('menuitem', {
      name: 'Insert row above',
    });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    // Freezing is view state, not structure, so it stays available.
    expect(
      screen
        .getByRole('menuitem', { name: 'Freeze up to row 2' })
        .getAttribute('aria-disabled'),
    ).toBeNull();
  });
});

describe('SheetContextMenu Send to chat', () => {
  it('is hidden without a chat panel to send to', async () => {
    renderMenu(createSpreadsheet({}));
    await screen.findAllByRole('menuitem');
    expect(screen.queryByRole('menuitem', { name: /Send to chat/ })).toBeNull();
  });

  it('is offered, read-only included, and sends when picked', async () => {
    const onSendToChat = vi.fn();
    renderMenu(createSpreadsheet({}), { readOnly: true, onSendToChat });
    const item = await screen.findByRole('menuitem', { name: /Send to chat/ });
    expect(item.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(item);
    await waitFor(() => expect(onSendToChat).toHaveBeenCalledTimes(1));
  });
});
