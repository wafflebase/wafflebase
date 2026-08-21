import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimeTravelSlider } from '@/app/spreadsheet/time-travel-slider';
import type { LakehouseHistoryEntry } from '@/types/lakehouse';

vi.mock('@/components/ui/slider', () => ({
  Slider: ({
    onValueChange,
    onValueCommit,
  }: {
    onValueChange: (value: number[]) => void;
    onValueCommit: (value: number[]) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onValueChange([0])}>
        Preview first
      </button>
      <button type="button" onClick={() => onValueCommit([0])}>
        Commit first
      </button>
    </div>
  ),
}));

const history: LakehouseHistoryEntry[] = [
  {
    ref: { kind: 'snapshot', snapshotId: '20' },
    timestamp: '2026-07-02T00:00:00.000Z',
    operation: 'overwrite',
  },
  {
    ref: { kind: 'snapshot', snapshotId: '10' },
    timestamp: '2026-07-01T00:00:00.000Z',
    operation: 'append',
  },
];

describe('TimeTravelSlider', () => {
  it('keeps drag preview local and trusts the API history order', () => {
    const onCommit = vi.fn();
    render(
      <TimeTravelSlider
        history={history}
        value={undefined}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview first' }));
    expect(screen.getByText(/overwrite/)).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Commit first' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      kind: 'snapshot',
      snapshotId: '20',
    });
  });

  it('clears the committed point through the Latest affordance', () => {
    const onCommit = vi.fn();
    render(
      <TimeTravelSlider
        history={history}
        value={{ kind: 'snapshot', snapshotId: '10' }}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(undefined);
  });

  it('shows an out-of-window ref instead of claiming the latest state', () => {
    const onCommit = vi.fn();
    render(
      <TimeTravelSlider
        history={history}
        value={{ kind: 'snapshot', snapshotId: '1' }}
        onCommit={onCommit}
      />,
    );

    expect(
      screen.getByRole('status', {
        name: 'Snapshot 1 · outside loaded history',
      }),
    ).toBeTruthy();
    expect(screen.queryByText('Latest')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preview first' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(undefined);
  });

  it('does not call a pinned commit "outside loaded history" while history is still loading', () => {
    // History is fetched only after the first read completes, so on mount a
    // tab pinned to a commit has `history: []`. Reporting that as "outside
    // loaded history" tells a collaborator their shared time-travel point is
    // out of range when nothing has loaded yet — and it stays on screen
    // permanently for a source whose /history call fails.
    render(
      <TimeTravelSlider
        history={[]}
        value={{ kind: 'snapshot', snapshotId: '1' }}
        loading
        onCommit={vi.fn()}
      />,
    );

    expect(screen.queryByText(/outside loaded history/)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Snapshot 1');
  });

  it('still reports a commit outside a history that HAS loaded', () => {
    render(
      <TimeTravelSlider
        history={history}
        value={{ kind: 'snapshot', snapshotId: 'missing' }}
        onCommit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('status', {
        name: 'Snapshot missing · outside loaded history',
      }),
    ).toBeTruthy();
  });

  it('uses the ref as the label when a history timestamp is absent', () => {
    render(
      <TimeTravelSlider
        history={[
          {
            ref: { kind: 'version', version: 7 },
            operation: 'append',
          },
        ]}
        value={undefined}
        onCommit={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview first' }));
    expect(screen.getByText('Version 7 · append')).toBeTruthy();
  });

  it('can describe the fixed metadata boundary for direct Iceberg sources', () => {
    render(
      <TimeTravelSlider
        history={history}
        value={undefined}
        latestLabel="Latest in configured metadata"
        onCommit={() => undefined}
      />,
    );

    expect(
      screen.getAllByText('Latest in configured metadata'),
    ).toHaveLength(2);
  });
});
