// @vitest-environment jsdom
/**
 * Tests for the shared LineSpacingPicker dropdown.
 *
 * Asserts:
 *   - clicking a preset menu item fires `onChange` with the unitless
 *     multiplier (e.g. 2.0).
 *
 * Radix portals the dropdown content into `document.body`, and Radix
 * DropdownMenu does NOT open on a synthetic `.click()` in jsdom — it
 * needs a full `pointerdown` -> `pointerup` -> `click` sequence (see
 * `font-family-picker.test.ts`). The same pattern is used here.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { createElement as h, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TooltipProvider } from "../../../src/components/ui/tooltip.tsx";
import { LineSpacingPicker } from "../../../src/components/text-formatting/line-spacing-picker.tsx";

// Opt into React's act() testing environment so state flushes are applied
// synchronously and React doesn't warn about unconfigured act().
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("LineSpacingPicker", () => {
  test("emits the preset value on click", () => {
    const onChange = vi.fn();
    const el = render(h(LineSpacingPicker, { value: 1.5, onChange }));
    // Radix DropdownMenu opens on pointer events, not synthetic .click(),
    // so dispatch a full pointerdown -> pointerup -> click sequence.
    const trigger = el.querySelector(
      '[aria-label="Line spacing"]',
    ) as HTMLElement;
    act(() => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      trigger.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      trigger.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const items = [...document.body.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]')];
    const double = items.find((n) => n.textContent?.includes("2.0")) as
      | HTMLElement
      | undefined;
    expect(double).toBeTruthy();
    act(() => {
      double!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      double!.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      double!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(onChange).toHaveBeenCalledWith(2.0);
  });

  test("renders 1.5 preset label without trailing zero", () => {
    const el = render(
      h(LineSpacingPicker, { value: 1.0, onChange: () => {} }),
    );
    const trigger = el.querySelector(
      '[aria-label="Line spacing"]',
    ) as HTMLElement;
    act(() => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      trigger.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      trigger.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const items = [...document.body.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]')];
    const has150 = items.some((n) => n.textContent === "1.50");
    const has15 = items.some((n) => n.textContent === "1.5");
    expect(has150).toBe(false);
    expect(has15).toBe(true);
  });
});
