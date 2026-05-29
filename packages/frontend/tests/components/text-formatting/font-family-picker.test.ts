// @vitest-environment jsdom
/**
 * Tests for the shared FontFamilyPicker dropdown.
 *
 * Asserts:
 *   - the trigger label shows the resolved value,
 *   - undefined (mixed-selection) renders the em-dash placeholder,
 *   - clicking a menu item fires `onChange` with the catalog family.
 *
 * Radix portals the dropdown content into `document.body`, so menu items
 * are queried there (not inside the test host).
 *
 * JSX is avoided (matching the package's `tests/**\/*.test.ts` runner) by
 * building elements with `React.createElement`.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { createElement as h, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TooltipProvider } from "../../../src/components/ui/tooltip.tsx";
import { FontFamilyPicker } from "../../../src/components/text-formatting/font-family-picker.tsx";

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

describe("FontFamilyPicker", () => {
  test("shows the resolved value in the trigger", () => {
    const el = render(
      h(FontFamilyPicker, { value: "Georgia", onChange: () => {} }),
    );
    expect(el.querySelector('[aria-label="Font"]')!.textContent).toContain(
      "Georgia",
    );
  });

  test("renders em-dash label when value is undefined (mixed selection)", () => {
    const el = render(
      h(FontFamilyPicker, { value: undefined, onChange: () => {} }),
    );
    const trigger = el.querySelector('[aria-label="Font"]')!;
    expect(trigger.textContent).toContain("—");
  });

  test("fires onChange with the catalog family on item click", () => {
    const onChange = vi.fn();
    const el = render(h(FontFamilyPicker, { value: "Arial", onChange }));
    // Radix DropdownMenu opens on pointer events, not synthetic .click(),
    // so dispatch a full pointerdown -> pointerup -> click sequence.
    const trigger = el.querySelector('[aria-label="Font"]') as HTMLElement;
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
    const item = [
      ...document.body.querySelectorAll('[role="menuitem"]'),
    ].find((n) => n.textContent === "Georgia") as HTMLElement | undefined;
    expect(item).toBeTruthy();
    act(() => {
      item!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      item!.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      item!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(onChange).toHaveBeenCalledWith("Georgia");
  });
});
