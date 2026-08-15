/**
 * Regression tests for issue #715 on the docs header/footer slim toolbar.
 *
 * The slim toolbar deliberately does not use the shared `TextFormatGroup`
 * (no lists, no link, no styles dropdown), so it carries its own copy of the
 * B/I/U toggle logic — and therefore needs its own copy of the regression
 * test. The stubbed editor makes the caret style and the range summary
 * disagree, which is the shape a backward (right-to-left) selection produces:
 * the caret sits at the range's start and resolves the run *preceding* the
 * selection. The toggles must follow the range.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DocsFormattingToolbar } from '@/app/docs/docs-formatting-toolbar';
import type { EditorAPI } from '@wafflebase/docs';

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

type Summary = ReturnType<EditorAPI['getRangeStyleSummary']>;

/** Minimal EditorAPI stub — only what the slim header/footer toolbar calls. */
function makeEditor(
  caretStyle: Record<string, unknown>,
  summary: Partial<Summary>,
): EditorAPI {
  return {
    focus: vi.fn(),
    applyStyle: vi.fn(),
    applyBlockStyle: vi.fn(),
    getSelectionStyle: vi.fn(() => caretStyle),
    getRangeStyleSummary: vi.fn(() => summary),
    getBlockStyle: vi.fn(() => ({})),
    onCursorMove: vi.fn(() => () => {}),
    insertPageNumber: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    getDocStyles: vi.fn(() => ({})),
    setDocStyles: vi.fn(),
  } as unknown as EditorAPI;
}

function mount(editor: EditorAPI, context: 'header' | 'footer' = 'header') {
  render(
    <TooltipProvider>
      <DocsFormattingToolbar editor={editor} editContext={context} />
    </TooltipProvider>,
  );
}

const CASES = [
  { label: 'Bold', key: 'bold' },
  { label: 'Italic', key: 'italic' },
  { label: 'Underline', key: 'underline' },
] as const;

describe('DocsFormattingToolbar header/footer toggles (issue #715)', () => {
  for (const { label, key } of CASES) {
    it(`${label} applies when the range is unstyled but the caret run is styled`, () => {
      const editor = makeEditor({ [key]: true }, { [key]: false } as Summary);
      mount(editor);

      fireEvent.click(screen.getByLabelText(label));

      expect(editor.applyStyle).toHaveBeenCalledWith({ [key]: true });
    });

    it(`${label} removes when the range is uniformly styled`, () => {
      const editor = makeEditor({ [key]: false }, { [key]: true } as Summary);
      mount(editor);

      fireEvent.click(screen.getByLabelText(label));

      expect(editor.applyStyle).toHaveBeenCalledWith({ [key]: false });
    });

    it(`${label} applies when the range is mixed`, () => {
      const editor = makeEditor({ [key]: true }, { [key]: 'mixed' } as Summary);
      mount(editor);

      fireEvent.click(screen.getByLabelText(label));

      expect(editor.applyStyle).toHaveBeenCalledWith({ [key]: true });
    });

    it(`${label} applies when the range carries no value at all`, () => {
      const editor = makeEditor({ [key]: true }, {} as Summary);
      mount(editor, 'footer');

      fireEvent.click(screen.getByLabelText(label));

      expect(editor.applyStyle).toHaveBeenCalledWith({ [key]: true });
    });

    // The button's own state has to come from the same source as its click,
    // or it renders "on" while clicking it turns the style on.
    it(`${label} renders pressed only when the whole range carries it`, () => {
      const editor = makeEditor({ [key]: true }, { [key]: true } as Summary);
      mount(editor);

      expect(screen.getByLabelText(label).getAttribute('aria-pressed')).toBe('true');
    });

    it(`${label} renders unpressed for a mixed range, caret style notwithstanding`, () => {
      const editor = makeEditor({ [key]: true }, { [key]: 'mixed' } as Summary);
      mount(editor);

      expect(screen.getByLabelText(label).getAttribute('aria-pressed')).toBe('false');
    });
  }
});
