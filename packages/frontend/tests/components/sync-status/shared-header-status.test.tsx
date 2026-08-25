/**
 * The share-link layouts build their own top bar instead of using
 * `SiteHeader`, so they are the one place the sync chip can silently go
 * missing when a new shared document type is added. Extracting the badge the
 * five layouts already duplicated gives that one seam, and these tests pin it.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/sync-status/sync-status-chip', () => ({
  SyncStatusChip: () => <span>sync-chip</span>,
}));

import { SharedHeaderStatus } from '@/app/shared/shared-header-status';

describe('SharedHeaderStatus', () => {
  it('marks a viewer-role link as read-only and shows no sync chip', () => {
    // A viewer cannot produce local changes, so a sync state would report a
    // connection whose loss costs them nothing.
    render(<SharedHeaderStatus readOnly />);

    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.queryByText('sync-chip')).toBeNull();
  });

  it('shows the sync chip to an editor-role visitor', () => {
    // An editor-role share link can strand work exactly like an owned editor,
    // and reaches none of SiteHeader's wiring.
    render(<SharedHeaderStatus readOnly={false} />);

    expect(screen.getByText('sync-chip')).toBeTruthy();
    expect(screen.queryByText('View only')).toBeNull();
  });
});
