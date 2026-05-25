// @vitest-environment jsdom
/**
 * Regression tests for the slides text-box toolbar focus fix.
 *
 * Bug: clicking a text-formatting toolbar control stole focus from the
 * text-box's hidden <textarea>, which committed + detached the editor on
 * blur BEFORE the control's onClick ran — so the action (e.g. bullet
 * list) never applied and edit mode collapsed.
 *
 * Two mechanisms guard against this, asserted here at the React layer:
 *   1. Direct buttons/toggles `preventDefault()` their mousedown so the
 *      textarea never blurs.
 *   2. Dropdown triggers/content carry `data-text-edit-keepalive` so the
 *      editor's blur handler keeps the box mounted while the menu is open
 *      (the editor-side half is covered in
 *      packages/docs/test/view/text-box-editor.test.ts).
 *
 * JSX is avoided (matching the package's `tests/**\/*.test.ts` runner) by
 * building elements with `React.createElement`.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { createElement as h, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TooltipProvider } from "../../../src/components/ui/tooltip.tsx";
import {
  TextParagraphGroup,
  TextFormatGroup,
  TextStyleGroup,
} from "../../../src/components/text-formatting/index.ts";
import type { TextFormattingEditor } from "../../../src/components/text-formatting/types.ts";

// Opt into React's act() testing environment so state flushes are applied
// synchronously and React doesn't warn about unconfigured act().
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

/** Dispatch a cancelable mousedown and report whether default was prevented. */
function mousedownPrevented(el: Element): boolean {
  const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}

function clickEl(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("TextParagraphGroup — direct buttons preventDefault mousedown", () => {
  for (const label of [
    "Bulleted list",
    "Numbered list",
    "Increase indent",
    "Decrease indent",
  ]) {
    test(`${label} button prevents mousedown (keeps editor focus)`, () => {
      const el = render(h(TextParagraphGroup, { editor: makeEditor() }));
      const btn = el.querySelector(`[aria-label="${label}"]`)!;
      expect(btn).not.toBeNull();
      expect(mousedownPrevented(btn)).toBe(true);
    });
  }

  test("Bulleted list still applies on click despite preventDefault", () => {
    const editor = makeEditor();
    const el = render(h(TextParagraphGroup, { editor }));
    const btn = el.querySelector(`[aria-label="Bulleted list"]`)!;
    // preventDefault on mousedown must not cancel the click action.
    mousedownPrevented(btn);
    clickEl(btn);
    expect(editor.toggleList).toHaveBeenCalledWith("unordered");
  });

  test("alignment dropdown trigger carries data-text-edit-keepalive", () => {
    const el = render(h(TextParagraphGroup, { editor: makeEditor() }));
    const trigger = el.querySelector(`[aria-label="Text alignment"]`)!;
    expect(trigger.hasAttribute("data-text-edit-keepalive")).toBe(true);
  });
});

describe("TextFormatGroup — toggles/buttons preventDefault, color triggers keepalive", () => {
  for (const label of ["Bold", "Italic", "Underline", "Strikethrough", "Insert link"]) {
    test(`${label} prevents mousedown`, () => {
      const el = render(h(TextFormatGroup, { editor: makeEditor() }));
      const btn = el.querySelector(`[aria-label="${label}"]`)!;
      expect(btn).not.toBeNull();
      expect(mousedownPrevented(btn)).toBe(true);
    });
  }

  for (const label of ["Text color", "Highlight color"]) {
    test(`${label} trigger carries data-text-edit-keepalive`, () => {
      const el = render(h(TextFormatGroup, { editor: makeEditor() }));
      const trigger = el.querySelector(`[aria-label="${label}"]`)!;
      expect(trigger.hasAttribute("data-text-edit-keepalive")).toBe(true);
    });
  }
});

describe("TextStyleGroup — block-style dropdown trigger keepalive", () => {
  test("style trigger carries data-text-edit-keepalive", () => {
    const el = render(h(TextStyleGroup, { editor: makeEditor() }));
    const trigger = el.querySelector(`[aria-label="Text style"]`)!;
    expect(trigger.hasAttribute("data-text-edit-keepalive")).toBe(true);
  });
});
