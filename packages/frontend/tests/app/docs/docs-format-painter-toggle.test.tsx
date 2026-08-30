/**
 * The docs toolbar's format-painter toggle.
 *
 * It must not carry any behaviour of its own — every press routes to an
 * `EditorAPI` entry point the keyboard shortcuts already drive — and its lit
 * state must be read back from the editor, so a format picked up with
 * `Mod+Shift+C` lights the button too.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

/**
 * Stub with a real format-painter buffer behind it, so the toggle is tested
 * against the contract (`hasCopiedFormat` + `onCopiedFormatChange`) rather
 * than against a frozen return value.
 *
 * `selectionPresent: false` models the editor's other real answer: with
 * nothing selected `pasteFormat()` writes nothing and reports `false`.
 */
function makeEditor({ selectionPresent = true }: { selectionPresent?: boolean } = {}) {
  let held = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((cb) => cb());

  const editor = {
    focus: vi.fn(),
    applyStyle: vi.fn(),
    applyBlockStyle: vi.fn(),
    getSelectionStyle: vi.fn(() => ({})),
    getRangeStyleSummary: vi.fn(() => ({})),
    getBlockStyle: vi.fn(() => ({})),
    onCursorMove: vi.fn(() => () => {}),
    undo: vi.fn(),
    redo: vi.fn(),
    getDocStyles: vi.fn(() => ({})),
    setDocStyles: vi.fn(),
    getStore: vi.fn(() => ({})),
    getBlockType: vi.fn(() => 'paragraph'),
    getListType: vi.fn(() => null),
    getPageSetup: vi.fn(() => ({
      paperSize: { name: 'Letter', width: 816, height: 1056 },
      orientation: 'portrait' as const,
      margins: { top: 96, bottom: 96, left: 96, right: 96 },
    })),
    setPageSetup: vi.fn(),
    copyFormat: vi.fn(() => {
      held = true;
      notify();
    }),
    pasteFormat: vi.fn(() => held && selectionPresent),
    clearCopiedFormat: vi.fn(() => {
      if (!held) return;
      held = false;
      notify();
    }),
    hasCopiedFormat: () => held,
    onCopiedFormatChange: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    /** Test hook: the keyboard shortcut path, which the toolbar never calls. */
    _pickUpFromKeyboard: () => {
      held = true;
      notify();
    },
  };
  return editor as typeof editor & EditorAPI;
}

function mount(editor: EditorAPI) {
  render(
    <TooltipProvider>
      <DocsFormattingToolbar editor={editor} />
    </TooltipProvider>,
  );
  return screen.getByLabelText('Format painter');
}

describe('DocsFormattingToolbar format painter', () => {
  it('starts unpressed and picks the format up on the first press', () => {
    const editor = makeEditor();
    const button = mount(editor);

    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);

    expect(editor.copyFormat).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('applies to the selection and lets the format go on the second press', () => {
    const editor = makeEditor();
    const button = mount(editor);

    fireEvent.click(button);
    fireEvent.click(button);

    expect(editor.pasteFormat).toHaveBeenCalledTimes(1);
    expect(editor.clearCopiedFormat).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-pressed')).toBe('false');

    // Order is the whole behaviour, and both calls happen either way: a
    // release-then-paste implementation would find an empty buffer and paint
    // nothing, while still satisfying the two call counts above. Pin it from
    // both sides — the paste ran first, and it ran with a format still held.
    expect(editor.pasteFormat.mock.invocationCallOrder[0]).toBeLessThan(
      editor.clearCopiedFormat.mock.invocationCallOrder[0],
    );
    expect(editor.pasteFormat).toHaveReturnedWith(true);
  });

  it('cancels the held format when the second press has nothing to paint', () => {
    // The documented way to put the painter down: press it again with no
    // selection. Nothing is written, and the button must not stay lit — a
    // toggle stuck "on" over a buffer the user meant to drop.
    const editor = makeEditor({ selectionPresent: false });
    const button = mount(editor);

    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(button);

    expect(editor.pasteFormat).toHaveReturnedWith(false);
    expect(editor.clearCopiedFormat).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(editor.hasCopiedFormat()).toBe(false);
  });

  it('returns focus to the editor so the selection stays usable', () => {
    const editor = makeEditor();
    const button = mount(editor);

    fireEvent.click(button);

    expect(editor.focus).toHaveBeenCalled();
  });

  it('lights up for a format picked up with the keyboard shortcut', () => {
    const editor = makeEditor();
    const button = mount(editor);

    act(() => editor._pickUpFromKeyboard());

    expect(button.getAttribute('aria-pressed')).toBe('true');
    // The button did nothing itself — the state came off the editor.
    expect(editor.copyFormat).not.toHaveBeenCalled();
  });

  it('is disabled without an editor', () => {
    render(
      <TooltipProvider>
        <DocsFormattingToolbar editor={null} />
      </TooltipProvider>,
    );
    expect(
      (screen.getByLabelText('Format painter') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

/**
 * The painter is the only toolbar control that reaches a *new* `EditorAPI`
 * member at **mount**: `hasCopiedFormat` / `onCopiedFormatChange`, from an
 * effect. Every other member this PR added is reached from a click handler
 * (`copyFormat` / `pasteFormat` / `clearCopiedFormat`) or behind an `open`
 * guard (`getPageSetup` / `setPageSetup`, seeded only when the Page Setup
 * dialog opens), where a missing method costs one press. In the effect it
 * throws during render and takes the whole toolbar — and so the document
 * screen — down with it.
 *
 * That is reachable rather than theoretical: this package runs no `tsc` (its
 * only type gate is `eslint`), every `EditorAPI` double in these suites is
 * built with `as unknown as EditorAPI` so the compiler never checks it, and
 * `EditorAPI` is exported from `@wafflebase/docs`, so an out-of-tree adapter
 * can be a version behind.
 *
 * The stub is the full one above with exactly the seven new members removed,
 * so this pins *this* change's blast radius and nothing else.
 */
describe('DocsFormattingToolbar with an editor that predates this PR', () => {
  function makeLegacyEditor(): EditorAPI {
    const editor = makeEditor() as unknown as Record<string, unknown>;
    for (const added of [
      'copyFormat',
      'pasteFormat',
      'clearCopiedFormat',
      'hasCopiedFormat',
      'onCopiedFormatChange',
      'getPageSetup',
      'setPageSetup',
    ]) {
      delete editor[added];
    }
    return editor as unknown as EditorAPI;
  }

  it('mounts the body toolbar instead of throwing', () => {
    expect(() => mount(makeLegacyEditor())).not.toThrow();
  });

  it('renders the painter disabled and unpressed', () => {
    const button = mount(makeLegacyEditor()) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('does nothing when the disabled painter is clicked', () => {
    const button = mount(makeLegacyEditor());
    expect(() => fireEvent.click(button)).not.toThrow();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
});
