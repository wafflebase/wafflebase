import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from '../history-panel';

const restore = vi.fn();
const nameCurrentVersion = vi.fn();
let hookState: Record<string, unknown>;

vi.mock('../use-revision-history', () => ({
  useRevisionHistory: () => hookState,
}));

const baseState = {
  isLoading: false,
  error: null,
  refresh: vi.fn(),
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

const renderPanel = () =>
  render(<HistoryPanel userId={42} onClose={vi.fn()} onPreview={vi.fn()} />);

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
