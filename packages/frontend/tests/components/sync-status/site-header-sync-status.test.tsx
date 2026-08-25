/**
 * `SiteHeader` is shared by shells that have no Yorkie document at all — the
 * documents list (`app/Layout.tsx`) and the static-file viewer
 * (`app/files/file-shell.tsx`). `useDocument()` throws outside a
 * `DocumentProvider`, so the sync chip has to be opt-in rather than always-on,
 * and these tests pin both halves of that.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// SiteHeader's own furniture, stubbed so the header can render standalone.
vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: () => <button type="button">sidebar</button>,
}));
vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: () => null,
}));
vi.mock('@/components/sync-status/sync-status-chip', () => ({
  SyncStatusChip: () => <span>sync-chip</span>,
}));

import { SiteHeader } from '@/components/site-header';

describe('SiteHeader sync status', () => {
  it('renders no sync chip by default', () => {
    // The documents list mounts this with no document in scope. Mounting the
    // chip here would throw "useDocument must be used within a
    // DocumentProvider" and take the whole page down.
    render(<SiteHeader title="My documents" />);

    expect(screen.queryByText('sync-chip')).toBeNull();
  });

  it('renders the sync chip when the shell opts in', () => {
    render(<SiteHeader title="Untitled" syncStatus />);

    expect(screen.getByText('sync-chip')).toBeTruthy();
  });
});
