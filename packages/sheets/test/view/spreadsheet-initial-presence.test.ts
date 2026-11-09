import { describe, expect, it, vi } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Spreadsheet } from '../../src/view/spreadsheet';

/**
 * Switching tabs mounts a fresh `Spreadsheet` for the new tab. The store moves
 * presence's `activeTabId`, but until the engine publishes a selection,
 * presence still carries the previous tab's: peers on the new tab either lose
 * the cursor (its anchors name the other tab's axis IDs) or see it on the
 * other tab's cell. So the host announces the new tab's selection with
 * `publishSelection()` once its mount is known not to have been cancelled —
 * `initialize` itself stays silent, since a mount torn down while it was
 * awaited must not write presence for a tab the user has already left.
 *
 * As in `spreadsheet-readonly-recalc.test.ts`, the method runs against a
 * hand-built context: a real `Worksheet` needs a DOM container.
 */
class TrackingStore extends MemStore {
  rowOrder: string[] = [];
  colOrder: string[] = [];
  calls: Array<Parameters<MemStore['updateSelection']>> = [];

  override getRowOrder(): string[] {
    return [...this.rowOrder];
  }

  override getColOrder(): string[] {
    return [...this.colOrder];
  }

  override getAxisCoverage(): { rows: number; cols: number } {
    return { rows: this.rowOrder.length, cols: this.colOrder.length };
  }

  override ensureAxisOrder(minRows: number, minCols: number): void {
    while (this.rowOrder.length < minRows) {
      this.rowOrder.push(`r${this.rowOrder.length}`);
    }
    while (this.colOrder.length < minCols) {
      this.colOrder.push(`c${this.colOrder.length}`);
    }
  }

  override updateSelection(
    ...args: Parameters<MemStore['updateSelection']>
  ): void {
    this.calls.push(args);
  }
}

const { initialize, publishSelection } = Spreadsheet.prototype as unknown as {
  initialize: (store: MemStore) => Promise<void>;
  publishSelection: () => void;
};

const createContext = () => ({
  sheet: undefined,
  worksheet: { setOnRender: vi.fn(), initialize: vi.fn() },
  notifySelectionChange: vi.fn(),
});

describe('Spreadsheet initial selection presence', () => {
  it('writes no presence during initialize', async () => {
    // The host only knows whether its mount survived once `initialize`
    // resolves, so the engine must not have written presence by then.
    const store = new TrackingStore();
    store.ensureAxisOrder(3, 3);

    await initialize.call(createContext(), store);

    expect(store.calls).toEqual([]);
  });

  it('publishes the new tab selection when the host asks', async () => {
    const store = new TrackingStore();
    store.ensureAxisOrder(3, 3);
    const context = createContext();

    await initialize.call(context, store);
    publishSelection.call(context);

    expect(store.calls).toEqual([
      [{ rowId: 'r0', colId: 'c0' }, [], { r: 1, c: 1 }],
    ]);
  });

  it('publishes the cursor without growing an empty axis', async () => {
    // Growing the axis is a write to the document root. Opening a tab must
    // not make one, so an unanchored cursor goes out as the legacy ref alone.
    const store = new TrackingStore();
    const context = createContext();

    await initialize.call(context, store);
    publishSelection.call(context);

    expect(store.calls).toEqual([[null, [], { r: 1, c: 1 }]]);
    expect(store.rowOrder).toEqual([]);
    expect(store.colOrder).toEqual([]);
  });

  it('is a no-op before initialize', () => {
    // A host that calls it on a mount whose `initialize` never resolved (the
    // engine was torn down) must not throw.
    expect(() => publishSelection.call(createContext())).not.toThrow();
  });
});
