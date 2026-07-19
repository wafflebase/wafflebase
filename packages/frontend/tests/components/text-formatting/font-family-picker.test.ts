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

// jsdom does not ship ResizeObserver, but Radix Popper inspects sizes
// during certain interaction paths (e.g. the menu staying open across
// a keydown). A no-op shim keeps the menu lifecycle running.
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
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

  test("fires onChange with the catalog family on item click", async () => {
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
      ...document.body.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]'),
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
    // onChange now fires from Radix's `onCloseAutoFocus`, which runs
    // inside FocusScope's `setTimeout(0)` cleanup. Yield to flush that
    // macrotask before asserting.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onChange).toHaveBeenCalledWith("Georgia");
  });

  // Dismissing the menu without picking (Esc / outside-click) must
  // leave `onChange` unfired — otherwise we'd spuriously re-apply a
  // pending family on every cancel.
  test("does not fire onChange when the menu is dismissed without a pick", async () => {
    const onChange = vi.fn();
    const el = render(h(FontFamilyPicker, { value: "Arial", onChange }));
    const trigger = el.querySelector('[aria-label="Font"]') as HTMLElement;
    act(() => {
      for (const type of ["pointerdown", "pointerup"] as const) {
        trigger.dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, button: 0 }),
        );
      }
      trigger.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    // Simulate Esc inside the menu — Radix closes without selection.
    const content = document.body.querySelector('[role="menu"]') as HTMLElement;
    expect(content).toBeTruthy();
    act(() => {
      content.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  // Regression: the docs collapsed-caret font-face flow expects the
  // editor's hidden textarea to remain focused after the user picks a
  // family. The picker must defer onChange until after Radix's
  // FocusScope cleanup so the caller's `editor.focus()` lands last and
  // sticks — otherwise the next typed character never reaches the
  // editor. We assert this by checking that, when onChange runs, the
  // menu DOM is already torn down (proving FocusScope teardown ran
  // first).
  test("invokes onChange after Radix has torn down the menu", async () => {
    let menuStillMountedDuringOnChange: boolean | null = null;
    const onChange = vi.fn(() => {
      menuStillMountedDuringOnChange =
        document.body.querySelector('[role="menuitem"],[role="menuitemcheckbox"]') !== null;
    });
    const el = render(h(FontFamilyPicker, { value: "Arial", onChange }));
    const trigger = el.querySelector('[aria-label="Font"]') as HTMLElement;
    act(() => {
      for (const type of ["pointerdown", "pointerup"] as const) {
        trigger.dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, button: 0 }),
        );
      }
      trigger.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const item = [
      ...document.body.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]'),
    ].find((n) => n.textContent === "Georgia") as HTMLElement | undefined;
    expect(item).toBeTruthy();
    act(() => {
      for (const type of ["pointerdown", "pointerup"] as const) {
        item!.dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, button: 0 }),
        );
      }
      item!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onChange).toHaveBeenCalledWith("Georgia");
    expect(menuStillMountedDuringOnChange).toBe(false);
  });

  // Same regression but driven by keyboard activation (Enter on a
  // focused menu item). Radix DropdownMenuItem dispatches a click on
  // its element when Enter/Space is pressed, so the `onClick` handler
  // still fires; this test pins that behaviour so the deferred-commit
  // path keeps working for keyboard users.
  test("commits the keyboard-selected item from onCloseAutoFocus", async () => {
    const onChange = vi.fn();
    const el = render(h(FontFamilyPicker, { value: "Arial", onChange }));
    const trigger = el.querySelector('[aria-label="Font"]') as HTMLElement;
    act(() => {
      for (const type of ["pointerdown", "pointerup"] as const) {
        trigger.dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, button: 0 }),
        );
      }
      trigger.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const item = [
      ...document.body.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]'),
    ].find((n) => n.textContent === "Georgia") as HTMLElement | undefined;
    expect(item).toBeTruthy();
    act(() => {
      item!.focus();
      item!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onChange).toHaveBeenCalledWith("Georgia");
  });
});
