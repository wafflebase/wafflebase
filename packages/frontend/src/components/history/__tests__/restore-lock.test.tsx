import { act, render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryPanel } from '../history-panel';
import { RevisionPreviewOverlay } from '../revision-preview';
import { useRevisionHistory } from '../use-revision-history';

const listRevisions = vi.fn();
const createRevision = vi.fn();
const restoreRevision = vi.fn();
const getRevision = vi.fn();

vi.mock('@yorkie-js/react', () => ({
  useRevisions: () => ({
    listRevisions,
    createRevision,
    restoreRevision,
    getRevision,
  }),
}));

/**
 * Every tab is external, so the preview loads and parses but mounts no Canvas
 * engine — jsdom cannot paint one. Same fixture `revision-preview.test.tsx`
 * uses for the tests that are about the preview shell rather than its content.
 */
const EXTERNAL_ONLY_SNAPSHOT = JSON.stringify({
  tabs: { 'tab-1': { id: 'tab-1', name: 'Postgres', type: 'datasource' } },
  tabOrder: ['tab-1'],
  sheets: {},
});

const rev = (id: string, label: string, iso: string) => ({
  id,
  label,
  description: '',
  snapshot: EXTERNAL_ONLY_SNAPSHOT,
  createdAt: new Date(iso),
});

/** Resolves once `restoreRevision` is entered; never settles on its own. */
let restoreEntered: Promise<void>;
let settleRestore: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  listRevisions.mockResolvedValue([
    rev('r1', 'Launch copy', '2026-09-02T10:00:00Z'),
    rev('r2', 'Second pass', '2026-09-02T09:00:00Z'),
  ]);
  getRevision.mockResolvedValue(rev('r1', 'Launch copy', '2026-09-02T10:00:00Z'));
  createRevision.mockResolvedValue(rev('safety', 'Before restore', '2026-09-02T11:00:00Z'));

  // `restoreRevision` hangs, so the first restore stays in flight for as long
  // as the test needs — the window in which the second one must be refused.
  let entered: () => void = () => {};
  restoreEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  settleRestore = () => {};
  restoreRevision.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        settleRestore = resolve;
        entered();
      }),
  );
});

/**
 * Both entry points at once, exactly as an editor renders them: the panel is
 * mounted on `historyOpen` alone, so it stays live and clickable underneath an
 * open preview (that is deliberate — it is how a user switches versions while
 * previewing).
 */
function renderBoth() {
  return render(
    <>
      <HistoryPanel userId={42} onClose={vi.fn()} onPreview={vi.fn()} />
      <RevisionPreviewOverlay
        revisionId="r1"
        type="sheet"
        userId={42}
        onClose={vi.fn()}
      />
    </>,
  );
}

const rowRestoreButtons = () =>
  screen.getAllByRole('button', { name: /^restore$/i });
const bannerRestoreButton = () =>
  screen.getByRole('button', { name: /restore this version|restoring/i });

// Each entry point owns its own `useRevisionHistory` instance and its own
// `isRestoring` state, so component-local guards cannot see each other. Two
// interleaved safety-revision-then-restore sequences leave the document at
// whichever `restoreRevision` landed last.
describe('restore serialization across entry points', () => {
  it('refuses a panel restore while the preview banner has one in flight', async () => {
    renderBoth();
    await waitFor(() => expect(rowRestoreButtons()).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

    await userEvent.click(bannerRestoreButton());
    await act(async () => {
      await restoreEntered;
    });
    expect(restoreRevision).toHaveBeenCalledTimes(1);

    // Try to start a second one anyway, the whole way through the dialog.
    await userEvent.click(rowRestoreButtons()[1]);
    const confirm = screen.queryByRole('button', {
      name: /^restore this version$/i,
    });
    if (confirm) await userEvent.click(confirm);

    expect(restoreRevision).toHaveBeenCalledTimes(1);
    expect(restoreRevision).toHaveBeenCalledWith('r1');

    // And the panel's own controls must reflect the preview's restore.
    for (const button of rowRestoreButtons()) expect(button).toBeDisabled();

    await act(async () => {
      settleRestore();
    });
    await waitFor(() => expect(rowRestoreButtons()[0]).not.toBeDisabled());
  });

  it('refuses a preview restore while a panel row has one in flight', async () => {
    renderBoth();
    await waitFor(() => expect(rowRestoreButtons()).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

    await userEvent.click(rowRestoreButtons()[1]);
    await userEvent.click(
      screen.getByRole('button', { name: /^restore this version$/i }),
    );
    await act(async () => {
      await restoreEntered;
    });
    expect(restoreRevision).toHaveBeenCalledTimes(1);
    expect(restoreRevision).toHaveBeenCalledWith('r2');

    await userEvent.click(bannerRestoreButton());
    expect(restoreRevision).toHaveBeenCalledTimes(1);
    expect(bannerRestoreButton()).toBeDisabled();

    await act(async () => {
      settleRestore();
    });
    await waitFor(() => expect(bannerRestoreButton()).not.toBeDisabled());
  });

  // Disabling a button is not the mechanism — a handler captured before the
  // re-render would still read a stale `false`. The refusal has to hold when
  // `restore` is called directly.
  it('rejects a second restore call from a separate hook instance', async () => {
    const first = renderHook(() =>
      useRevisionHistory({ enabled: false, userId: 42 }),
    );
    const second = renderHook(() =>
      useRevisionHistory({ enabled: false, userId: 42 }),
    );

    const inFlight = first.result.current.restore('r1');
    await act(async () => {
      await restoreEntered;
    });

    // Settled into a value either way, so an unserialized second sequence
    // shows up as an extra RPC below rather than as a timeout here.
    const refused = second.result.current
      .restore('r2')
      .then(() => 'resolved', (err: Error) => err.message);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(restoreRevision).toHaveBeenCalledTimes(1);
    // The refused call must not have created a second safety revision either.
    expect(createRevision).toHaveBeenCalledTimes(1);
    await expect(refused).resolves.toMatch(/already in progress/i);

    await act(async () => {
      settleRestore();
      await inFlight;
    });

    // The lock is released, so the next restore runs normally.
    restoreRevision.mockResolvedValue(undefined);
    await act(() => second.result.current.restore('r2'));
    expect(restoreRevision).toHaveBeenCalledTimes(2);
  });
});
