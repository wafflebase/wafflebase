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
vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

import { toast } from 'sonner';
import { HttpError } from '@/api/http-error';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HeaderPanelToggle, SiteHeader } from '../site-header';

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

  // Peers' renames arrive live, so the `title` prop can change while this
  // user has the input open. Their draft wins until the input closes.
  it('keeps the draft when a peer renames mid-edit, then follows the new title', async () => {
    const onRename = vi.fn();
    const { rerender } = render(
      <SiteHeader title="Budget" editable onRename={onRename} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Budget"' }));
    await userEvent.type(screen.getByLabelText('Document title'), ' draft');

    rerender(<SiteHeader title="Peer title" editable onRename={onRename} />);
    expect(screen.getByLabelText('Document title')).toHaveValue('Budget draft');

    await userEvent.keyboard('{Escape}');
    await userEvent.click(
      screen.getByRole('button', { name: 'Rename "Peer title"' }),
    );
    expect(screen.getByLabelText('Document title')).toHaveValue('Peer title');
    expect(onRename).not.toHaveBeenCalled();
  });

  // The other half of the same race: an input that is open but untouched holds
  // no draft worth protecting, so it must follow a peer's rename rather than
  // commit the title it happened to be opened with straight back over it.
  it('follows a peer rename into an open input nobody has typed into', async () => {
    const onRename = vi.fn();
    const { rerender } = render(
      <SiteHeader title="Budget" editable onRename={onRename} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Budget"' }));
    rerender(<SiteHeader title="Peer title" editable onRename={onRename} />);

    expect(screen.getByLabelText('Document title')).toHaveValue('Peer title');

    // Blur is the commit path a click elsewhere takes; it must revert nothing.
    await userEvent.tab();
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Peer title')).toBeInTheDocument();
  });

  // `onRename` is asynchronous (`useDocumentRename` PATCHes the row) and the
  // input closes before it resolves. A refused rename must not reject into
  // nobody, and must not leave the old title snapping back unexplained.
  it('reports a refused rename instead of rejecting unhandled', async () => {
    vi.mocked(toast.error).mockClear();
    const onRename = vi
      .fn()
      .mockRejectedValue(
        new HttpError('You can only view this document.', 403),
      );
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      render(<SiteHeader title="Budget" editable onRename={onRename} />);

      await userEvent.click(
        screen.getByRole('button', { name: 'Rename "Budget"' }),
      );
      const input = screen.getByLabelText('Document title');
      await userEvent.clear(input);
      await userEvent.type(input, 'Renamed{Enter}');

      await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toContain('Renamed');
      expect(vi.mocked(toast.error).mock.calls[0]?.[1]).toMatchObject({
        description: 'You can only view this document.',
      });
      // The title is a prop; a refused PATCH leaves the row unchanged.
      expect(screen.getByText('Budget')).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  // A network failure or a 5xx carries developer text (`Failed to fetch`, a
  // stack trace). The toast says what to do instead.
  it('does not show developer text from a failed rename', async () => {
    vi.mocked(toast.error).mockClear();
    const onRename = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SiteHeader title="Budget" editable onRename={onRename} />);

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Budget"' }));
    const input = screen.getByLabelText('Document title');
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Enter}');

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    const options = vi.mocked(toast.error).mock.calls[0]?.[1] as {
      description?: string;
    };
    expect(options.description).not.toContain('Failed to fetch');
    expect(options.description).toMatch(/try again/i);
  });

  // Reopening after a peer rename must start from the peer's title, not from
  // the draft state the previous session left behind.
  it('commits nothing on Enter when the input was never typed into', async () => {
    const onRename = vi.fn();
    const { rerender } = render(
      <SiteHeader title="Budget" editable onRename={onRename} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Budget"' }));
    rerender(<SiteHeader title="Peer title" editable onRename={onRename} />);
    await userEvent.keyboard('{Enter}');

    expect(onRename).not.toHaveBeenCalled();
  });
});

describe('SiteHeader title semantics', () => {
  // The rename control used to be the `<h1>` itself with `role="button"`,
  // which removed the page's only heading from heading navigation.
  it('keeps the title a level-one heading named by the title when editable', () => {
    render(<SiteHeader title="Budget" editable onRename={vi.fn()} />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Budget' });
    const button = screen.getByRole('button', { name: 'Rename "Budget"' });
    expect(heading.contains(button)).toBe(true);
  });

  it('is a plain heading when not editable', () => {
    render(<SiteHeader title="Budget" />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Budget' });
    expect(heading.querySelector('button')).toBeNull();
  });

  it('opens the rename input from the keyboard', async () => {
    render(<SiteHeader title="Budget" editable onRename={vi.fn()} />);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Rename "Budget"' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByLabelText('Document title')).toHaveFocus();
  });
});

describe('SiteHeader action slots', () => {
  const slotOrder = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-header-slot]')).map((el) =>
      el.getAttribute('data-header-slot'),
    );

  // Each editor used to hand-build its own row, so the same controls came in
  // a different order per document type (slides put Export before History,
  // docs after it). The order is the header's, whatever order the caller
  // writes the object in.
  it('renders the slots in one fixed order regardless of how they are passed', () => {
    const { container } = render(
      <SiteHeader
        title="Deck"
        actions={{
          presence: <span>presence</span>,
          share: <span>share</span>,
          export: <span>export</span>,
          history: <span>history</span>,
          comments: <span>comments</span>,
          primary: <span>present</span>,
        }}
      />,
    );

    expect(slotOrder(container)).toEqual([
      'primary',
      'comments',
      'history',
      'export',
      'share',
      'presence',
    ]);
  });

  it('leaves an absent capability out without moving the others', () => {
    const { container } = render(
      <SiteHeader
        title="Board"
        actions={{
          share: <span>share</span>,
          history: <span>history</span>,
          presence: <span>presence</span>,
        }}
      />,
    );

    expect(slotOrder(container)).toEqual(['history', 'share', 'presence']);
  });
});

describe('HeaderPanelToggle', () => {
  it('names its action after the panel state and reports it pressed', async () => {
    const onPressedChange = vi.fn();
    const Icon = () => <svg />;
    const { rerender } = render(
      <TooltipProvider>
        <HeaderPanelToggle
          icon={Icon}
          label="comments"
          pressed={false}
          onPressedChange={onPressedChange}
        />
      </TooltipProvider>,
    );

    const closed = screen.getByRole('button', { name: 'Show comments' });
    expect(closed).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(closed);
    expect(onPressedChange).toHaveBeenCalledWith(true);

    rerender(
      <TooltipProvider>
        <HeaderPanelToggle
          icon={Icon}
          label="comments"
          pressed
          onPressedChange={onPressedChange}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Hide comments' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
