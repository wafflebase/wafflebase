// @vitest-environment jsdom
/**
 * Coverage for the `showRemoveLink` opt-in on `TextFormatGroup` (issue
 * #1051).
 *
 * Since Clear formatting deliberately preserves hyperlinks, this button is
 * the *only* way to drop one on the Slides and Board surfaces — they have
 * no link popover. A flag that is never passed, or a click that never
 * reaches `removeLink()`, would leave those surfaces with no removal path
 * at all, and neither failure shows up as a type error (the prop is
 * optional and the frontend has no `tsc` gate).
 *
 * JSX is avoided (matching the package's `tests/**\/*.test.ts` runner) by
 * building elements with `React.createElement`, the same harness
 * `text-format-toggles.test.ts` uses.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { createElement as h, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TooltipProvider } from "../../../src/components/ui/tooltip.tsx";
import { TextFormatGroup } from "../../../src/components/text-formatting/index.ts";
import type { TextFormattingEditor } from "../../../src/components/text-formatting/types.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function makeEditor(): TextFormattingEditor {
  return {
    focus: vi.fn(),
    getSelectionStyle: vi.fn(() => ({})),
    getRangeStyleSummary: vi.fn(() => ({})),
    applyStyle: vi.fn(),
    clearInlineFormatting: vi.fn(),
    applyBlockStyle: vi.fn(),
    getBlockType: vi.fn(() => ({ type: "paragraph" as const })),
    setBlockType: vi.fn(),
    toggleList: vi.fn(),
    indent: vi.fn(),
    outdent: vi.fn(),
    requestLink: vi.fn(),
    removeLink: vi.fn(),
    // Not on `TextFormattingEditor`, but the slides text-edit section's
    // font pickers subscribe through it (`useResolvedFontSize`).
    onCursorMove: vi.fn(() => () => {}),
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

function removeLinkButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[aria-label="Remove link"]');
}

describe("TextFormatGroup — Remove link button (issue #1051)", () => {
  test("is not rendered by default", () => {
    // Docs opts out: it offers Remove link from the link popover, so a
    // toolbar duplicate would be redundant there.
    const container = render(h(TextFormatGroup, { editor: makeEditor() }));
    expect(removeLinkButton(container)).toBeNull();
    // …while the sibling Insert link button, which defaults on, is there —
    // so the assertion above is about this button, not a dead selector.
    expect(container.querySelector('[aria-label="Insert link"]')).toBeTruthy();
  });

  test("is rendered when showRemoveLink is passed", () => {
    const container = render(
      h(TextFormatGroup, { editor: makeEditor(), showRemoveLink: true }),
    );
    expect(removeLinkButton(container)).toBeTruthy();
  });

  test("clicking it drops the link and returns focus to the editor", () => {
    const editor = makeEditor();
    const container = render(h(TextFormatGroup, { editor, showRemoveLink: true }));

    act(() => {
      removeLinkButton(container)!.click();
    });

    expect(editor.removeLink).toHaveBeenCalledTimes(1);
    // Focus goes back to the canvas editor, or the caret is left in the
    // toolbar and the next keystroke goes nowhere.
    expect(editor.focus).toHaveBeenCalled();
    // Removing a link must not also clear the run's formatting — they are
    // separate commands (#1051).
    expect(editor.clearInlineFormatting).not.toHaveBeenCalled();
  });

  test("is enabled whenever an editor is mounted, and disabled without one", () => {
    // Deliberately not gated on `getLinkAtCursor()`: the toolbar does not
    // re-render on caret moves, so such a gate would go stale exactly when
    // the caret entered a link.
    const withEditor = render(
      h(TextFormatGroup, { editor: makeEditor(), showRemoveLink: true }),
    );
    expect(removeLinkButton(withEditor)!.disabled).toBe(false);
    act(() => root!.unmount());
    root = null;
    host?.remove();
    host = null;

    const withoutEditor = render(
      h(TextFormatGroup, { editor: null, showRemoveLink: true }),
    );
    expect(removeLinkButton(withoutEditor)!.disabled).toBe(true);
  });

  test("the Slides text-edit toolbar opts in", async () => {
    // The prop is optional, so a `showRemoveLink` that was never passed
    // (or misspelled) fails silently — no type error, no runtime error,
    // just a surface with no way to remove a link. Assert the opt-in at
    // the call site rather than trusting the flag's default.
    const { TextEditSection } = await import(
      "../../../src/app/slides/toolbar/text-edit-section.tsx"
    );
    const textEditor = makeEditor();
    const container = render(
      h(TextEditSection, {
        state: {
          kind: "text-edit",
          elementId: "el-1",
          textEditor,
        } as unknown as Parameters<typeof TextEditSection>[0]["state"],
        editor: null,
      }),
    );

    expect(removeLinkButton(container)).toBeTruthy();
    act(() => {
      removeLinkButton(container)!.click();
    });
    expect(textEditor.removeLink).toHaveBeenCalledTimes(1);
  }, 20_000);
});
