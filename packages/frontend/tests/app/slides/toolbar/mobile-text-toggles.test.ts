// @vitest-environment jsdom
/**
 * Regression tests for issue #715 on the slides *mobile* toolbar.
 *
 * `TextEditMobileBar` deliberately carries its own B/I/U trio rather than the
 * shared `TextFormatGroup` (that one lives in the Format sheet below it), so
 * it carries its own copy of the toggle logic — and therefore needs its own
 * copy of the regression test.
 *
 * The stubbed text editor makes the caret style and the range summary
 * disagree, which is the shape a backward (right-to-left) selection produces:
 * the caret sits at the range's start and resolves the run *preceding* the
 * selection. Both the applied style and the pressed state must follow the
 * range.
 *
 * JSX is avoided (matching the package's `tests/**\/*.test.ts` runner) by
 * building elements with `React.createElement`.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { createElement as h, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TooltipProvider } from "../../../../src/components/ui/tooltip.tsx";
import { MobileSlidesToolbar } from "../../../../src/app/slides/toolbar/mobile-toolbar.tsx";
import type { SlidesTextBoxEditor } from "@wafflebase/slides";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Summary = ReturnType<SlidesTextBoxEditor["getRangeStyleSummary"]>;

/** jsdom ships no matchMedia; Radix's Sheet reads it. */
if (typeof window.matchMedia !== "function") {
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
 * A text editor whose caret style and range summary disagree — the shape a
 * backward selection produces.
 */
function makeTextEditor(
  caretStyle: Record<string, unknown>,
  summary: Summary,
): SlidesTextBoxEditor {
  return {
    isEditing: () => true,
    focus: vi.fn(),
    detach: vi.fn(),
    commit: vi.fn(),
    container: document.createElement("div"),
    getSelectionStyle: vi.fn(() => caretStyle),
    getRangeStyleSummary: vi.fn(() => summary),
    applyStyle: vi.fn(),
    clearInlineFormatting: vi.fn(),
    applyBlockStyle: vi.fn(),
    getBlockType: () => ({ type: "paragraph" as const }),
    setBlockType: vi.fn(),
    toggleList: vi.fn(),
    indent: vi.fn(),
    outdent: vi.fn(),
    insertLink: vi.fn(),
    removeLink: vi.fn(),
    getLinkAtCursor: () => undefined,
    requestLink: vi.fn(),
    stepSelectionFontSize: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    onCursorMove: () => () => {},
  } as unknown as SlidesTextBoxEditor;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ui: ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(h(TooltipProvider, null, ui));
  });
  return host;
}

function mount(textEditor: SlidesTextBoxEditor): HTMLElement {
  return render(
    h(MobileSlidesToolbar, {
      editor: null,
      store: null,
      state: { kind: "text-edit" as const, elementId: "el1", textEditor },
      onImagePick: () => {},
    }),
  );
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

function toggle(container: HTMLElement, label: string): HTMLElement {
  const el = container.querySelector(`[aria-label="${label}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

function click(el: HTMLElement): void {
  act(() => {
    el.click();
  });
}

const CASES = [
  { label: "Bold", key: "bold" },
  { label: "Italic", key: "italic" },
  { label: "Underline", key: "underline" },
] as const;

describe("slides mobile text toggles (issue #715)", () => {
  for (const { label, key } of CASES) {
    test(`${label} applies when the range is unstyled but the caret run is styled`, () => {
      const editor = makeTextEditor({ [key]: true }, { [key]: false } as Summary);
      const container = mount(editor);

      click(toggle(container, label));

      expect(editor.applyStyle).toHaveBeenCalledWith({ [key]: true });
    });

    test(`${label} removes when the range is uniformly styled`, () => {
      const editor = makeTextEditor({ [key]: false }, { [key]: true } as Summary);
      const container = mount(editor);

      click(toggle(container, label));

      expect(editor.applyStyle).toHaveBeenCalledWith({ [key]: false });
    });

    test(`${label} applies when the range is mixed`, () => {
      const editor = makeTextEditor(
        { [key]: true },
        { [key]: "mixed" } as Summary,
      );
      const container = mount(editor);

      click(toggle(container, label));

      expect(editor.applyStyle).toHaveBeenCalledWith({ [key]: true });
    });

    test(`${label} button state follows the range, not the caret`, () => {
      const container = mount(
        makeTextEditor({ [key]: true }, { [key]: false } as Summary),
      );

      expect(toggle(container, label).getAttribute("aria-pressed")).toBe("false");
    });

    test(`${label} button is unpressed for a mixed range`, () => {
      const container = mount(
        makeTextEditor({ [key]: false }, { [key]: "mixed" } as Summary),
      );

      expect(toggle(container, label).getAttribute("aria-pressed")).toBe("false");
    });

    test(`${label} button is pressed for a uniformly styled range`, () => {
      const container = mount(
        makeTextEditor({ [key]: false }, { [key]: true } as Summary),
      );

      expect(toggle(container, label).getAttribute("aria-pressed")).toBe("true");
    });
  }
});
