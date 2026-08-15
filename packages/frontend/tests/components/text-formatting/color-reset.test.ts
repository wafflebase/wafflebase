// @vitest-environment jsdom
/**
 * Regression test for issue #728 — "Reset" in the text-color picker used to
 * apply `{ color: "" }`. An empty string is a legal `string`, so it was
 * stored as a real attribute and painted as an invalid canvas color (which
 * leaves the previous fill in place — the selection highlight). Clearing a
 * style means passing `undefined`, which the store turns into an attribute
 * removal.
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

function makeEditor(): TextFormattingEditor {
  return {
    focus: vi.fn(),
    getSelectionStyle: vi.fn(() => ({})),
    applyStyle: vi.fn(),
    applyBlockStyle: vi.fn(),
    getBlockType: vi.fn(() => ({ type: "paragraph" as const })),
    setBlockType: vi.fn(),
    toggleList: vi.fn(),
    indent: vi.fn(),
    outdent: vi.fn(),
    requestLink: vi.fn(),
  };
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

function clickEl(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Open the popover behind `triggerLabel` and click its none/reset control. */
function clickResetIn(triggerLabel: string, editor: TextFormattingEditor): void {
  render(h(TextFormatGroup, { editor }));
  const trigger = document.querySelector(`[aria-label="${triggerLabel}"]`)!;
  expect(trigger).not.toBeNull();
  clickEl(trigger);
  // The palette renders into a portal, so query the whole document.
  const reset = document.querySelector("[data-none-control]")!;
  expect(reset).not.toBeNull();
  clickEl(reset);
}

/**
 * Assert the single `applyStyle` call cleared exactly `key`.
 *
 * `toHaveBeenCalledWith({ key: undefined })` would NOT do: vitest's recursive
 * equality treats an explicitly-`undefined` property as equal to an absent one
 * (`expect({}).toEqual({ color: undefined })` passes), and "present with value
 * `undefined`" is the whole point — the store's clear path keys off the
 * property being there (`'color' in style`) to emit an attribute *removal*.
 * So we assert on the own keys and the value separately.
 */
function expectClearedOnly(
  editor: TextFormattingEditor,
  key: "color" | "backgroundColor",
): void {
  const calls = vi.mocked(editor.applyStyle).mock.calls;
  expect(calls).toHaveLength(1);
  const style = calls[0][0] as Record<string, unknown>;
  expect(Object.prototype.hasOwnProperty.call(style, key)).toBe(true);
  expect(Object.keys(style)).toEqual([key]);
  expect(style[key]).toBeUndefined();
}

describe("TextFormatGroup color reset (issue #728)", () => {
  test("Text color reset clears the key instead of writing an empty string", () => {
    const editor = makeEditor();
    clickResetIn("Text color", editor);
    expectClearedOnly(editor, "color");
  });

  test("Highlight color reset clears the key instead of writing an empty string", () => {
    const editor = makeEditor();
    clickResetIn("Highlight color", editor);
    expectClearedOnly(editor, "backgroundColor");
  });
});
