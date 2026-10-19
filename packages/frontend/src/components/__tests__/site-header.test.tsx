/**
 * The header title is an editing control: clicking it opens an input whose
 * commit renames the LIVE document. A host withholds it by revoking
 * `editable` — a revision preview does, because neither `PreviewSurface`
 * (which covers) nor `EditingChrome` (which removes) reaches this header's
 * left half.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: () => null,
}));
vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: () => null,
}));
vi.mock('@/components/sync-status/sync-status-chip', () => ({
  SyncStatusChip: () => null,
}));

import { SiteHeader } from '../site-header';

describe('SiteHeader rename', () => {
  it('opens the title input on click when editable', async () => {
    const onRename = vi.fn();
    render(<SiteHeader title="Budget" editable onRename={onRename} />);

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Budget"' }));
    const input = screen.getByLabelText('Document title');
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Enter}');

    expect(onRename).toHaveBeenCalledWith('Renamed');
  });

  // Not merely inert: no button role, no pointer affordance, nothing for a
  // screen reader or the keyboard to reach.
  it('offers no way into the input when not editable', async () => {
    render(<SiteHeader title="Budget" onRename={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Rename "Budget"' })).toBeNull();
    await userEvent.click(screen.getByText('Budget'));
    expect(screen.queryByLabelText('Document title')).toBeNull();
  });

  // The race the `editable` prop alone does not close: the input was already
  // open when the host revoked it (a preview opening from the keyboard, with
  // no blur to commit on). Revoking closes it rather than leaving the one
  // control the host meant to remove on screen.
  it('closes an open input when a host revokes editable, committing nothing', async () => {
    const onRename = vi.fn();
    const { rerender } = render(
      <SiteHeader title="Budget" editable onRename={onRename} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Budget"' }));
    await userEvent.type(screen.getByLabelText('Document title'), ' 2026');

    rerender(<SiteHeader title="Budget" editable={false} />);

    expect(screen.queryByLabelText('Document title')).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
    // And the title is still shown — withheld means not editable, not gone.
    expect(screen.getByText('Budget')).toBeInTheDocument();
  });
});
