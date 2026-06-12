// @vitest-environment jsdom
/**
 * Tests for the shared FontSizePicker numeric input + spinner.
 *
 * Asserts:
 *   - the current value renders in the input,
 *   - undefined value renders an empty input (mixed selection),
 *   - the ± buttons increment/decrement and commit via onChange,
 *   - commits clamp to [FONT_SIZE_MIN, FONT_SIZE_MAX] and are skipped when
 *     the clamped value matches the current value (no spurious onChange),
 *   - typing then pressing Enter commits the typed value.
 *
 * The preset Radix dropdown is intentionally not exercised here — the ± /
 * Enter paths give us confidence in the commit policy without depending on
 * Radix's pointer-only open behaviour in jsdom.
 *
 * JSX is avoided (matching the package's `tests/**\/*.test.ts` runner) by
 * building elements with `React.createElement`.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { createElement as h, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TooltipProvider } from "../../../src/components/ui/tooltip.tsx";
import { FontSizePicker } from "../../../src/components/text-formatting/font-size-picker.tsx";

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

describe("FontSizePicker", () => {
  test("shows the current size in the input", () => {
    const el = render(
      h(FontSizePicker, { value: 14, onChange: () => {} }),
    );
    expect(
      (el.querySelector('input[aria-label="Font size"]') as HTMLInputElement)
        .value,
    ).toBe("14");
  });

  test("shows empty input when value is undefined", () => {
    const el = render(
      h(FontSizePicker, { value: undefined, onChange: () => {} }),
    );
    expect(
      (el.querySelector('input[aria-label="Font size"]') as HTMLInputElement)
        .value,
    ).toBe("");
  });

  test("+ button increments and commits", () => {
    const onChange = vi.fn();
    const el = render(h(FontSizePicker, { value: 12, onChange }));
    act(() => {
      (
        el.querySelector(
          '[aria-label="Increase font size"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(onChange).toHaveBeenCalledWith(13);
  });

  test("− button decrements and commits", () => {
    const onChange = vi.fn();
    const el = render(h(FontSizePicker, { value: 12, onChange }));
    act(() => {
      (
        el.querySelector(
          '[aria-label="Decrease font size"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(onChange).toHaveBeenCalledWith(11);
  });

  test("+ button is a no-op when value is undefined and input is empty (mixed selection)", () => {
    // Regression: previously `value ?? Number("")` collapsed to 0 and ±
    // committed FONT_SIZE_MIN, silently flattening every run in a mixed
    // selection to the minimum size.
    const onChange = vi.fn();
    const el = render(
      h(FontSizePicker, { value: undefined, onChange }),
    );
    act(() => {
      (
        el.querySelector(
          '[aria-label="Increase font size"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("clamps to 1..400 on commit", () => {
    const onChange = vi.fn();
    const el = render(h(FontSizePicker, { value: 1, onChange }));
    act(() => {
      (
        el.querySelector(
          '[aria-label="Decrease font size"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("Enter commits the typed value", () => {
    const onChange = vi.fn();
    const el = render(h(FontSizePicker, { value: 12, onChange }));
    const input = el.querySelector(
      'input[aria-label="Font size"]',
    ) as HTMLInputElement;
    act(() => {
      input.value = "24";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onChange).toHaveBeenCalledWith(24);
  });
});
