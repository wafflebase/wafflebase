// @vitest-environment jsdom
/**
 * Regression tests for issue #715 — the B/I/U/S toggles decided whether to
 * add or remove a style from `getSelectionStyle()`, which samples a single
 * caret position. With a backward (right-to-left) selection the caret sits at
 * the range's *start* and resolves to the run *preceding* the selection, so
 * the toggle inverted the wrong value: after clearing bold from a sub-range
 * of a bold run, clicking Bold again was a silent no-op forever.
 *
 * The mocks below encode exactly that disagreement — the caret style says
 * "bold" (the preceding run) while the range summary says "not bold" (the
 * selection) — and assert the toggles follow the range.
 *
 * JSX is avoided (matching the package's `tests/**\/*.test.ts` runner) by
 * building elements with `React.createElement`.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { createElement as h, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TooltipProvider } from "../../../src/components/ui/tooltip.tsx";
import { TextFormatGroup } from "../../../src/components/text-formatting/index.ts";
import type { TextFormattingEditor } from "../../../src/components/text-formatting/types.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Summary = ReturnType<TextFormattingEditor["getRangeStyleSummary"]>;

/**
 * An editor whose caret style and range summary disagree — the shape a
 * backward selection produces.
 */
function makeEditor(
  caretStyle: Record<string, unknown>,
  summary: Summary,
): TextFormattingEditor {
  return {
    focus: vi.fn(),
    getSelectionStyle: vi.fn(() => caretStyle),
    getRangeStyleSummary: vi.fn(() => summary),
    applyStyle: vi.fn(),
    clearInlineFormatting: vi.fn(),
    applyBlockStyle: vi.fn(),
    getBlockType: vi.fn(() => ({ type: "paragraph" as const })),
    setBlockType: vi.fn(),
    toggleList: vi.fn(),
    indent: vi.fn(),
    outdent: vi.fn(),
    requestLink: vi.fn(),
  } as unknown as TextFormattingEditor;
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
  { label: "Strikethrough", key: "strikethrough" },
] as const;

describe("TextFormatGroup toggles (issue #715)", () => {
  for (const { label, key } of CASES) {
    test(`${label} applies when the range is unstyled but the caret run is styled`, () => {
      // Backward selection: caret style reports the preceding (styled) run,
      // the range summary reports the (unstyled) selection.
      const editor = makeEditor({ [key]: true }, { [key]: false } as Summary);
      const container = render(h(TextFormatGroup, { editor }));

      click(toggle(container, label));

      expect(editor.applyStyle).toHaveBeenCalledWith({ [key]: true });
    });

    test(`${label} removes when the range is uniformly styled`, () => {
      const editor = makeEditor({ [key]: false }, { [key]: true } as Summary);
      const container = render(h(TextFormatGroup, { editor }));

      click(toggle(container, label));

      expect(editor.applyStyle).toHaveBeenCalledWith({ [key]: false });
    });

    test(`${label} applies when the range is mixed`, () => {
      const editor = makeEditor({ [key]: true }, { [key]: "mixed" } as Summary);
      const container = render(h(TextFormatGroup, { editor }));

      click(toggle(container, label));

      expect(editor.applyStyle).toHaveBeenCalledWith({ [key]: true });
    });

    test(`${label} button state follows the range, not the caret`, () => {
      const unstyledRange = render(
        h(TextFormatGroup, {
          editor: makeEditor({ [key]: true }, { [key]: false } as Summary),
        }),
      );
      expect(toggle(unstyledRange, label).getAttribute("aria-pressed")).toBe(
        "false",
      );
    });

    test(`${label} button is unpressed for a mixed range`, () => {
      const mixedRange = render(
        h(TextFormatGroup, {
          editor: makeEditor({ [key]: true }, { [key]: "mixed" } as Summary),
        }),
      );
      expect(toggle(mixedRange, label).getAttribute("aria-pressed")).toBe(
        "false",
      );
    });

    test(`${label} button is pressed for a uniformly styled range`, () => {
      const styledRange = render(
        h(TextFormatGroup, {
          editor: makeEditor({ [key]: false }, { [key]: true } as Summary),
        }),
      );
      expect(toggle(styledRange, label).getAttribute("aria-pressed")).toBe(
        "true",
      );
    });
  }
});
