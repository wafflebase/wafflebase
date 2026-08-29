/**
 * The docs Export menu.
 *
 * Markdown and plain text join Word and PDF; every entry has to reach the
 * download through the same `runExport` path, so a failure raises a toast
 * rather than an unhandled rejection.
 *
 * Radix DropdownMenu does not open on a synthetic `.click()` in jsdom — it
 * needs the full pointerdown -> pointerup -> click sequence (the same dance
 * `tests/components/text-formatting/line-spacing-picker.test.ts` documents).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { EditorAPI } from '@wafflebase/docs';

const downloadBlob = vi.fn();

vi.mock('@/app/docs/export-utils', async () => {
  const actual = await vi.importActual<typeof import('@/app/docs/export-utils')>(
    '@/app/docs/export-utils',
  );
  return { ...actual, downloadBlob };
});

const { DocsExportButton } = await import('@/app/docs/docs-export-button');

const DOC = {
  blocks: [
    { id: 'p', type: 'paragraph', inlines: [{ text: 'hello', style: {} }], style: {} },
  ],
};

function makeEditor() {
  return {
    getStore: () => ({ getDocument: () => DOC }),
  } as unknown as EditorAPI;
}

function openMenu() {
  const trigger = screen.getByLabelText('Export document');
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    fireEvent(
      trigger,
      new PointerEvent(type, { bubbles: true, cancelable: true, button: 0 }),
    );
  }
}

describe('DocsExportButton', () => {
  beforeEach(() => downloadBlob.mockClear());

  it('offers Word, PDF, Markdown and plain text', async () => {
    render(
      <TooltipProvider>
        <DocsExportButton editor={makeEditor()} title="Report" />
      </TooltipProvider>,
    );
    openMenu();

    await screen.findByText('Word (.docx)');
    expect(screen.getByText('PDF (.pdf)')).toBeTruthy();
    expect(screen.getByText('Markdown (.md)')).toBeTruthy();
    expect(screen.getByText('Plain text (.txt)')).toBeTruthy();
  });

  it('downloads a .md file from the Markdown entry', async () => {
    render(
      <TooltipProvider>
        <DocsExportButton editor={makeEditor()} title="Report" />
      </TooltipProvider>,
    );
    openMenu();

    fireEvent.click(await screen.findByText('Markdown (.md)'));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    const [blob, name] = downloadBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe('Report.md');
    expect(blob.type).toBe('text/markdown;charset=utf-8');
  });

  it('downloads a .txt file from the plain-text entry', async () => {
    render(
      <TooltipProvider>
        <DocsExportButton editor={makeEditor()} title="Report" />
      </TooltipProvider>,
    );
    openMenu();

    fireEvent.click(await screen.findByText('Plain text (.txt)'));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    const [blob, name] = downloadBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe('Report.txt');
    expect(blob.type).toBe('text/plain;charset=utf-8');
  });
});
