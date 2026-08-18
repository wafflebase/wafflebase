import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LakehouseView } from '@/app/spreadsheet/lakehouse-view';

type MockAsOf =
  | { kind: 'version'; version: number }
  | { kind: 'snapshot'; snapshotId: string };

type MockRoot = {
  tabs: Record<
    string,
    {
      id: string;
      name: string;
      type: 'lakehouse';
      lakehouseSourceId: string;
      asOf?: MockAsOf;
    }
  >;
};

const mocks = vi.hoisted(() => ({
  root: null as MockRoot | null,
  docUpdate: vi.fn(),
  presenceSet: vi.fn(),
  initialize: vi.fn(),
  loadQueryResults: vi.fn(),
  reloadDimensions: vi.fn(),
  renderSheet: vi.fn(),
  cleanup: vi.fn(),
  theme: 'light',
  loading: false,
  read: vi.fn(),
  history: vi.fn(),
}));

vi.mock('@yorkie-js/react', () => ({
  useDocument: () => ({
    doc: { update: mocks.docUpdate },
    root: mocks.root,
    loading: mocks.loading,
    error: null,
  }),
}));

vi.mock('@wafflebase/sheets', () => ({
  ReadOnlyStore: class {
    loadQueryResults = mocks.loadQueryResults;
  },
  initialize: mocks.initialize,
}));

vi.mock('@/api/auth', () => ({
  isAuthExpiredError: () => false,
}));

vi.mock('@/api/lakehouse', () => ({
  fetchLakehouseHistory: mocks.history,
  readLakehouseSource: mocks.read,
}));

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: mocks.theme }),
}));

vi.mock('@/hooks/use-mobile-sheet-gestures', () => ({
  useMobileSheetGestures: () => undefined,
}));

vi.mock('@/app/spreadsheet/time-travel-slider', () => ({
  TimeTravelSlider: ({
    onCommit,
  }: {
    onCommit: (value: { kind: 'version'; version: number } | undefined) => void;
  }) => (
    <>
      <button type="button" onClick={() => onCommit(undefined)}>
        Latest mock
      </button>
      <button
        type="button"
        onClick={() => onCommit({ kind: 'version', version: 7 })}
      >
        Version 7 mock
      </button>
    </>
  ),
}));

function makeRoot(asOf?: MockAsOf): MockRoot {
  return {
    tabs: {
      'lakehouse-1': {
        id: 'lakehouse-1',
        name: 'Orders',
        type: 'lakehouse',
        lakehouseSourceId: 'source-1',
        asOf,
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const oldResult = {
  columns: [{ name: 'old', dataTypeID: 0 }],
  rows: [{ old: 'stale' }],
  rowCount: 1,
  truncated: false,
  executionTime: 1,
};

const newResult = {
  columns: [{ name: 'new', dataTypeID: 0 }],
  rows: [{ new: 'current' }],
  rowCount: 1,
  truncated: false,
  executionTime: 2,
};

describe('LakehouseView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.root = makeRoot();
    mocks.theme = 'light';
    mocks.loading = false;
    mocks.reloadDimensions.mockResolvedValue(undefined);
    mocks.initialize.mockResolvedValue({
      reloadDimensions: mocks.reloadDimensions,
      render: mocks.renderSheet,
      cleanup: mocks.cleanup,
    });
    mocks.history.mockResolvedValue([]);
    mocks.read.mockResolvedValue(newResult);
    mocks.docUpdate.mockImplementation(
      (
        update: (
          root: MockRoot,
          presence: { set: typeof mocks.presenceSet },
        ) => void,
      ) => {
        update(mocks.root!, { set: mocks.presenceSet });
      },
    );
  });

  it('loads on mount and ignores a superseded read response', async () => {
    const firstRead = deferred<typeof oldResult>();
    const secondRead = deferred<typeof newResult>();
    mocks.read
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise);

    const view = render(<LakehouseView tabId="lakehouse-1" />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    expect(mocks.read).toHaveBeenNthCalledWith(
      1,
      'source-1',
      undefined,
      expect.any(AbortSignal),
    );

    mocks.root = makeRoot({ kind: 'version', version: 3 });
    view.rerender(<LakehouseView tabId="lakehouse-1" />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    expect(mocks.read).toHaveBeenNthCalledWith(
      2,
      'source-1',
      { kind: 'version', version: 3 },
      expect.any(AbortSignal),
    );

    await act(async () => {
      secondRead.resolve(newResult);
      await secondRead.promise;
    });
    await waitFor(() =>
      expect(mocks.loadQueryResults).toHaveBeenCalledWith(
        newResult.columns,
        newResult.rows,
      ),
    );

    await act(async () => {
      firstRead.resolve(oldResult);
      await firstRead.promise;
    });
    expect(mocks.loadQueryResults).not.toHaveBeenCalledWith(
      oldResult.columns,
      oldResult.rows,
    );
  });

  it('loads rows before requesting history from the serialized engine', async () => {
    const pendingRead = deferred<typeof newResult>();
    mocks.read.mockReturnValueOnce(pendingRead.promise);

    render(<LakehouseView tabId="lakehouse-1" />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    expect(mocks.history).not.toHaveBeenCalled();

    await act(async () => {
      pendingRead.resolve(newResult);
      await pendingRead.promise;
    });
    await waitFor(() =>
      expect(mocks.history).toHaveBeenCalledWith(
        'source-1',
        expect.any(AbortSignal),
      ),
    );
  });

  it('deletes asOf when Latest is committed', async () => {
    mocks.root = makeRoot({ kind: 'version', version: 3 });
    render(<LakehouseView tabId="lakehouse-1" />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Latest mock' }));
    expect(mocks.root.tabs['lakehouse-1'].asOf).toBeUndefined();
  });

  it('persists a selected version and reloads that historical result', async () => {
    const view = render(<LakehouseView tabId="lakehouse-1" />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Version 7 mock' }));
    expect(mocks.root.tabs['lakehouse-1'].asOf).toEqual({
      kind: 'version',
      version: 7,
    });

    view.rerender(<LakehouseView tabId="lakehouse-1" />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    expect(mocks.read).toHaveBeenLastCalledWith(
      'source-1',
      { kind: 'version', version: 7 },
      expect.any(AbortSignal),
    );
  });

  it('reads an Iceberg tab at its stored snapshot, not at latest', async () => {
    // The snapshot branch is the ONLY time-travel path an Iceberg source can
    // take — the backend rejects `version` refs for Iceberg — so without this
    // the branch could be deleted and every other test would still pass while
    // Iceberg tabs silently rendered the latest commit.
    mocks.root = makeRoot({
      kind: 'snapshot',
      snapshotId: '7989807407367529971',
    });

    render(<LakehouseView tabId="lakehouse-1" />);

    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    expect(mocks.read).toHaveBeenCalledWith(
      'source-1',
      { kind: 'snapshot', snapshotId: '7989807407367529971' },
      expect.any(AbortSignal),
    );
  });

  it('does not render a cleaned-up spreadsheet generation', async () => {
    const staleReload = deferred<void>();
    const staleSheet = {
      reloadDimensions: vi.fn(() => staleReload.promise),
      render: vi.fn(),
      cleanup: vi.fn(),
    };
    const currentSheet = {
      reloadDimensions: vi.fn().mockResolvedValue(undefined),
      render: vi.fn(),
      cleanup: vi.fn(),
    };
    mocks.initialize
      .mockResolvedValueOnce(staleSheet)
      .mockResolvedValueOnce(currentSheet);
    mocks.read.mockReturnValue(new Promise(() => undefined));

    const view = render(<LakehouseView tabId="lakehouse-1" />);
    await waitFor(() => expect(staleSheet.reloadDimensions).toHaveBeenCalled());

    mocks.theme = 'dark';
    view.rerender(<LakehouseView tabId="lakehouse-1" />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(currentSheet.render).toHaveBeenCalledTimes(1));

    await act(async () => {
      staleReload.resolve(undefined);
      await staleReload.promise;
    });

    expect(staleSheet.cleanup).toHaveBeenCalledTimes(1);
    expect(staleSheet.render).not.toHaveBeenCalled();
  });

  it('clears a transient canvas error after a current reload succeeds', async () => {
    const view = render(<LakehouseView tabId="lakehouse-1" />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.renderSheet).toHaveBeenCalled());

    const nextRead = deferred<typeof newResult>();
    mocks.read.mockReturnValueOnce(nextRead.promise);
    mocks.reloadDimensions.mockRejectedValueOnce(new Error('clear failed'));
    mocks.root = makeRoot({ kind: 'version', version: 3 });
    view.rerender(<LakehouseView tabId="lakehouse-1" />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'clear failed',
    );

    await act(async () => {
      nextRead.resolve(newResult);
      await nextRead.promise;
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('initializes the grid once the document finishes loading', async () => {
    mocks.loading = true;
    const view = render(<LakehouseView tabId="lakehouse-1" />);
    expect(mocks.initialize).not.toHaveBeenCalled();

    mocks.loading = false;
    view.rerender(<LakehouseView tabId="lakehouse-1" />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.renderSheet).toHaveBeenCalledTimes(1));
  });
});
