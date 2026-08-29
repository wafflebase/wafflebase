/**
 * The Page Setup dialog — the surface `docs-pagination.md` deferred.
 *
 * What matters here is the unit conversion (the model stores CSS px at
 * 96 dpi, the dialog talks inches), that the form is seeded from the live
 * document every time it opens, and that a setup which would leave no room
 * for content can never be applied.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PAPER_SIZES, type EditorAPI, type PageSetup } from '@wafflebase/docs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DocsPageSetupDialog } from '@/app/docs/docs-page-setup-dialog';
import { DocsFormattingToolbar } from '@/app/docs/docs-formatting-toolbar';

// jsdom ships no matchMedia; the toolbar reads it through `useIsMobile()`.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function makeEditor(setup: PageSetup) {
  const editor = {
    getPageSetup: vi.fn(() => structuredClone(setup)),
    setPageSetup: vi.fn(),
    focus: vi.fn(),
  };
  return editor as typeof editor & EditorAPI;
}

const LETTER_DEFAULT: PageSetup = {
  paperSize: PAPER_SIZES.LETTER,
  orientation: 'portrait',
  margins: { top: 96, bottom: 96, left: 96, right: 96 },
};

function mount(editor: EditorAPI, open = true) {
  const onOpenChange = vi.fn();
  render(
    <DocsPageSetupDialog editor={editor} open={open} onOpenChange={onOpenChange} />,
  );
  return { onOpenChange };
}

const marginInput = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;

const apply = () => screen.getByRole('button', { name: 'Apply' });

describe('DocsPageSetupDialog', () => {
  it('seeds the margins from the document, converted to inches', () => {
    mount(
      makeEditor({
        paperSize: PAPER_SIZES.A4,
        orientation: 'landscape',
        margins: { top: 96, bottom: 48, left: 72, right: 24 },
      }),
    );

    expect(marginInput('Top').value).toBe('1');
    expect(marginInput('Bottom').value).toBe('0.5');
    expect(marginInput('Left').value).toBe('0.75');
    expect(marginInput('Right').value).toBe('0.25');
    expect(screen.getByLabelText('Landscape')).toBeTruthy();
  });

  it('applies inches back as px, leaving untouched fields alone', () => {
    const editor = makeEditor(LETTER_DEFAULT);
    const { onOpenChange } = mount(editor);

    fireEvent.change(marginInput('Top'), { target: { value: '1.5' } });
    fireEvent.click(apply());

    expect(editor.setPageSetup).toHaveBeenCalledWith({
      paperSize: PAPER_SIZES.LETTER,
      orientation: 'portrait',
      margins: { top: 144, bottom: 96, left: 96, right: 96 },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('applies a zero margin', () => {
    const editor = makeEditor(LETTER_DEFAULT);
    mount(editor);

    fireEvent.change(marginInput('Left'), { target: { value: '0' } });
    fireEvent.click(apply());

    expect(editor.setPageSetup.mock.calls[0][0].margins.left).toBe(0);
  });

  it('switches orientation without touching the paper size', () => {
    const editor = makeEditor(LETTER_DEFAULT);
    mount(editor);

    fireEvent.click(screen.getByLabelText('Landscape'));
    fireEvent.click(apply());

    expect(editor.setPageSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        orientation: 'landscape',
        paperSize: PAPER_SIZES.LETTER,
      }),
    );
  });

  it('refuses margins that would leave no room for content', () => {
    const editor = makeEditor(LETTER_DEFAULT);
    mount(editor);

    // Letter is 816 px (8.5 in) wide, so 5 in + 5 in has nothing left over.
    fireEvent.change(marginInput('Left'), { target: { value: '5' } });
    fireEvent.change(marginInput('Right'), { target: { value: '5' } });

    expect(screen.getByRole('alert').textContent).toMatch(/room for content/i);
    expect((apply() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(apply());
    expect(editor.setPageSetup).not.toHaveBeenCalled();
  });

  it('measures the room against the orientation the user picked', () => {
    const editor = makeEditor(LETTER_DEFAULT);
    mount(editor);

    // 5 in + 5 in fits across a landscape Letter (11 in) but not a portrait
    // one (8.5 in) — the check has to follow the radio, not the stored value.
    fireEvent.change(marginInput('Left'), { target: { value: '5' } });
    fireEvent.change(marginInput('Right'), { target: { value: '5' } });
    expect((apply() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Landscape'));

    expect(screen.queryByRole('alert')).toBeNull();
    expect((apply() as HTMLButtonElement).disabled).toBe(false);
  });

  it('refuses a negative or unparseable margin', () => {
    const editor = makeEditor(LETTER_DEFAULT);
    mount(editor);

    fireEvent.change(marginInput('Top'), { target: { value: '-1' } });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect((apply() as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['an emptied field', ''],
    ['whitespace only', '   '],
    ['a hex literal', '0x60'],
  ])('refuses %s rather than applying it as a margin', (_label, value) => {
    // `Number("")` is 0 and `Number("0x60")` is 96 — both finite and
    // non-negative, so a bare finiteness check would apply 0" and 96"
    // margins respectively, with the Apply button never going disabled.
    const editor = makeEditor(LETTER_DEFAULT);
    mount(editor);

    fireEvent.change(marginInput('Top'), { target: { value } });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect((apply() as HTMLButtonElement).disabled).toBe(true);
  });

  it('re-reads the document each time it opens, so it cannot go stale', () => {
    const editor = makeEditor(LETTER_DEFAULT);
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <DocsPageSetupDialog editor={editor} open={false} onOpenChange={onOpenChange} />,
    );

    // A collaborator drags the ruler while the dialog is closed.
    editor.getPageSetup.mockReturnValue({
      ...LETTER_DEFAULT,
      margins: { ...LETTER_DEFAULT.margins, top: 192 },
    });
    rerender(
      <DocsPageSetupDialog editor={editor} open onOpenChange={onOpenChange} />,
    );

    expect(marginInput('Top').value).toBe('2');
  });

  it('cancels without writing anything', () => {
    const editor = makeEditor(LETTER_DEFAULT);
    const { onOpenChange } = mount(editor);

    fireEvent.change(marginInput('Top'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(editor.setPageSetup).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('is reachable from the docs toolbar', () => {
    const editor = {
      ...makeEditor(LETTER_DEFAULT),
      applyStyle: vi.fn(),
      applyBlockStyle: vi.fn(),
      getSelectionStyle: vi.fn(() => ({})),
      getRangeStyleSummary: vi.fn(() => ({})),
      getBlockStyle: vi.fn(() => ({})),
      getBlockType: vi.fn(() => 'paragraph'),
      onCursorMove: vi.fn(() => () => {}),
      undo: vi.fn(),
      redo: vi.fn(),
      getDocStyles: vi.fn(() => ({})),
      setDocStyles: vi.fn(),
      getStore: vi.fn(() => ({})),
      hasCopiedFormat: () => false,
      onCopiedFormatChange: () => () => {},
    } as unknown as EditorAPI;

    render(
      <TooltipProvider>
        <DocsFormattingToolbar editor={editor} />
      </TooltipProvider>,
    );
    expect(screen.queryByLabelText('Top')).toBeNull();

    fireEvent.click(screen.getByLabelText('Page setup'));

    expect(marginInput('Top').value).toBe('1');
  });
});
