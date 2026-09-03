import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from '../history-panel';

const restore = vi.fn();
const nameCurrentVersion = vi.fn();
const refresh = vi.fn();
let hookState: Record<string, unknown>;

vi.mock('../use-revision-history', () => ({
  useRevisionHistory: () => hookState,
}));

const baseState = {
  isLoading: false,
  error: null,
  refresh,
  nameCurrentVersion,
  restore,
  days: [
    {
      dayKey: '2026-09-02',
      entries: [
        {
          id: 'n1',
          label: 'Launch copy',
          createdAt: new Date('2026-09-02T10:00:00Z'),
          meta: { kind: 'named', by: 42 },
        },
        {
          id: 'a1',
          label: 'snapshot-503',
          createdAt: new Date('2026-09-02T09:00:00Z'),
          meta: { kind: 'automatic' },
        },
      ],
    },
  ],
};

const renderPanel = (refreshKey?: number) =>
  render(
    <HistoryPanel
      userId={42}
      onClose={vi.fn()}
      onPreview={vi.fn()}
      refreshKey={refreshKey}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` clears calls, not implementations, so a rejection set by
  // one test would leak into the next.
  restore.mockResolvedValue(undefined);
  nameCurrentVersion.mockResolvedValue(undefined);
});

describe('HistoryPanel', () => {
  it('shows a named version by its name', () => {
    hookState = { ...baseState };
    renderPanel();
    expect(screen.getByText('Launch copy')).toBeInTheDocument();
  });

  // Yorkie's automatic revisions have no author and a machine label. Showing
  // either would be inventing information.
  it('shows an automatic version without its raw label or an author', () => {
    hookState = { ...baseState };
    renderPanel();
    expect(screen.queryByText('snapshot-503')).not.toBeInTheDocument();
    expect(screen.getByText(/Automatic/i)).toBeInTheDocument();
  });

  it('asks for confirmation before restoring and says comments ride along', async () => {
    hookState = { ...baseState };
    renderPanel();
    await userEvent.click(screen.getAllByRole('button', { name: /restore/i })[0]);
    expect(screen.getByText(/comments/i)).toBeInTheDocument();
    expect(restore).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^restore this version$/i }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith('n1'));
  });

  // A restore is a safety revision followed by a restore. Two of those
  // sequences interleaved leave the document at whichever `restoreRevision`
  // happened to land last — not the version the user picked.
  it('refuses a second restore while one is in flight', async () => {
    hookState = { ...baseState };
    let settle: () => void = () => {};
    restore.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    renderPanel();
    const rowButtons = () =>
      screen.getAllByRole('button', { name: /^restore$/i });

    await userEvent.click(rowButtons()[0]);
    await userEvent.click(
      screen.getByRole('button', { name: /^restore this version$/i }),
    );
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));

    // Try to start the second one anyway, the whole way through the dialog.
    await userEvent.click(rowButtons()[1]);
    const confirm = screen.queryByRole('button', {
      name: /^restore this version$/i,
    });
    if (confirm) await userEvent.click(confirm);
    expect(restore).toHaveBeenCalledTimes(1);

    for (const button of rowButtons()) expect(button).toBeDisabled();

    await act(async () => {
      settle();
    });
    await waitFor(() =>
      expect(rowButtons()[0]).not.toBeDisabled(),
    );
  });

  it('renders a load failure as an error, not as an empty timeline', () => {
    hookState = { ...baseState, days: [], error: new Error('denied') };
    renderPanel();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/no versions yet/i)).not.toBeInTheDocument();
  });

  it('shows the empty state only when the load succeeded with nothing', () => {
    hookState = { ...baseState, days: [], error: null };
    renderPanel();
    expect(screen.getByText(/no versions yet/i)).toBeInTheDocument();
  });

  // A restore that failed and said nothing is the worst thing a
  // restore-the-document feature can do: the user believes it worked.
  it('reports a failed restore instead of failing silently', async () => {
    hookState = { ...baseState };
    restore.mockRejectedValue(new Error('permission denied'));
    renderPanel();
    await userEvent.click(screen.getAllByRole('button', { name: /restore/i })[0]);
    await userEvent.click(
      screen.getByRole('button', { name: /^restore this version$/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/couldn't restore this version: permission denied/i),
      ).toBeInTheDocument(),
    );
  });

  // "Name current version" was the last action here that could fail in
  // silence: no `catch`, so the promise rejected unhandled, the spinner
  // cleared, the label stayed in the box and the user was told nothing.
  // `createRevision` rejects for every user on a deployment that registered
  // `CreateRevision` on the auth webhook, which is exactly the mistake the
  // backend README warns against.
  it('reports a failed "Name current version" instead of failing silently', async () => {
    hookState = { ...baseState };
    nameCurrentVersion.mockRejectedValue(new Error('permission denied'));
    renderPanel();
    await userEvent.type(
      screen.getByLabelText(/name current version/i),
      'Launch copy',
    );
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/couldn't name this version: permission denied/i),
      ).toBeInTheDocument(),
    );
  });

  it('clears the box and reports nothing when naming succeeds', async () => {
    hookState = { ...baseState };
    nameCurrentVersion.mockResolvedValue(undefined);
    renderPanel();
    const input = screen.getByLabelText(/name current version/i);
    await userEvent.type(input, 'Launch copy');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.queryByText(/couldn't name this version/i)).not.toBeInTheDocument();
  });

  // The preview overlay owns a second `useRevisionHistory` instance, so a
  // restore started from the preview refreshes that one and leaves this list
  // stale — without the "Before restore" entry the restore just created.
  it('re-reads its list when the editor bumps refreshKey', async () => {
    hookState = { ...baseState };
    const { rerender } = renderPanel(0);
    expect(refresh).not.toHaveBeenCalled(); // the hook already fetched on mount

    rerender(
      <HistoryPanel
        userId={42}
        onClose={vi.fn()}
        onPreview={vi.fn()}
        refreshKey={1}
      />,
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  // Docs mounts the panel with no `onPreview` at all (its snapshots can't
  // be parsed — see snapshot-adapters.ts). A user must be able to tell
  // preview isn't available here without clicking to find out, so the
  // button stays visible but disabled with a reason, not a dead click.
  it('disables Preview with a reason when the document type has no preview surface', () => {
    hookState = { ...baseState };
    render(<HistoryPanel userId={42} onClose={vi.fn()} />);
    const previewButtons = screen.getAllByRole('button', { name: /preview/i });
    for (const button of previewButtons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleName(/preview.*not available/i);
    }
  });
});
