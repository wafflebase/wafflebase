/**
 * The slots that change shape on a phone: Slides' Slideshow button splits
 * into a row button and a More-menu row, and the export menus become rows of
 * the More menu — whose content unmounts on close, so an export started there
 * must keep its in-flight guard somewhere that outlives it.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => true,
}));
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
  toast: { error: vi.fn(), success: vi.fn() },
}));
// An export that has not finished: the menu closes while it runs.
const pdfExport = vi.hoisted(() => vi.fn());
vi.mock('@/app/slides/pdf-actions', () => ({
  exportSlidesPdfAndDownload: pdfExport,
}));
vi.mock('@/app/slides/pptx-actions', () => ({
  exportSlidesPptxAndDownload: vi.fn(),
}));
vi.mock('@/app/docs/docx-actions', () => ({ exportDocxAndDownload: vi.fn() }));
vi.mock('@/app/docs/pdf-actions', () => ({ exportPdfAndDownload: vi.fn() }));
vi.mock('@/app/docs/text-actions', () => ({
  exportMarkdownAndDownload: vi.fn(),
  exportTextAndDownload: vi.fn(),
}));

import { TooltipProvider } from '@/components/ui/tooltip';
import { SiteHeader } from '../site-header';
import { PresentButton } from '@/app/slides/slides-present-button';
import { SlidesExportButton } from '@/app/slides/slides-export-button';
import { DocsExportButton } from '@/app/docs/docs-export-button';
import type { SlidesStore } from '@wafflebase/slides';

const store = { read: () => ({}) } as unknown as SlidesStore;

function renderSlidesHeader({
  onStart = vi.fn(),
  exportStore = store as SlidesStore | null,
} = {}) {
  render(
    <TooltipProvider>
      <SiteHeader
        title="Deck"
        actions={{
          primary: <PresentButton disabled={false} onStart={onStart} />,
          export: (
            <SlidesExportButton store={exportStore} title="Deck" disabled={false} />
          ),
          share: <span>share</span>,
        }}
      />
    </TooltipProvider>,
  );
  return { onStart };
}

const openMore = () =>
  userEvent.click(screen.getByRole('button', { name: 'More document actions' }));

describe('PresentButton on a phone', () => {
  it('keeps one square play button in the row that presents from the current slide', async () => {
    const { onStart } = renderSlidesHeader();

    expect(screen.queryByRole('button', { name: 'Present options' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Slideshow' }));
    expect(onStart).toHaveBeenCalledWith('current');
  });

  it('moves "Present from beginning" into the More menu', async () => {
    const { onStart } = renderSlidesHeader();

    await openMore();
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /Present from beginning/ }),
    );
    expect(onStart).toHaveBeenCalledWith('first');
  });
});

describe('Export in the phone More menu', () => {
  it('lists the formats as rows under an Export label', async () => {
    renderSlidesHeader();

    await openMore();
    expect(await screen.findByText('Export')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'PDF (.pdf)' })).toBeEnabled();
    expect(
      screen.getByRole('menuitem', { name: 'PowerPoint (.pptx)' }),
    ).toBeInTheDocument();
  });

  // With no trigger to disable in the menu, the rows carry it.
  it('disables the rows while the deck is not loaded', async () => {
    renderSlidesHeader({ exportStore: null });

    await openMore();
    expect(
      await screen.findByRole('menuitem', { name: 'PDF (.pdf)' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps an export in flight after the menu that started it closes', async () => {
    pdfExport.mockReturnValue(new Promise(() => {}));
    renderSlidesHeader();

    await openMore();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'PDF (.pdf)' }));
    expect(pdfExport).toHaveBeenCalledTimes(1);

    // The trigger says so, and reopening offers no second start.
    const more = screen.getByRole('button', { name: 'More document actions' });
    expect(more).toHaveAttribute('aria-busy', 'true');
    await openMore();
    expect(
      await screen.findByRole('menuitem', { name: 'PDF (.pdf)' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('releases the guard once the export settles', async () => {
    let finish!: () => void;
    pdfExport.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    renderSlidesHeader();

    await openMore();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'PDF (.pdf)' }));
    const more = screen.getByRole('button', { name: 'More document actions' });
    expect(more).toHaveAttribute('aria-busy', 'true');

    await act(async () => finish());
    expect(more).not.toHaveAttribute('aria-busy');
    await openMore();
    expect(
      await screen.findByRole('menuitem', { name: 'PDF (.pdf)' }),
    ).not.toHaveAttribute('aria-disabled');
  });

  it('groups the Docs formats under their label, disabled until the editor mounts', async () => {
    render(
      <TooltipProvider>
        <SiteHeader
          title="Plan"
          actions={{
            export: <DocsExportButton editor={null} title="Plan" />,
            share: <span>share</span>,
          }}
        />
      </TooltipProvider>,
    );

    await openMore();
    const group = await screen.findByRole('group', { name: 'Export' });
    const rows = within(group).getAllByRole('menuitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Word (.docx)',
      'PDF (.pdf)',
      'Markdown (.md)',
      'Plain text (.txt)',
    ]);
    for (const row of rows) expect(row).toHaveAttribute('aria-disabled', 'true');
  });
});
