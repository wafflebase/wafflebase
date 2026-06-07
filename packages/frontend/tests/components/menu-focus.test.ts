// @vitest-environment jsdom
/**
 * Unit tests for the shared color-palette menu focus helpers.
 *
 * The hook gates focus restoration on "did the user click a swatch?" so
 * outside-click / Esc don't steal focus from the user's actual click
 * target. Asserts:
 *   - swatch click → onSwatchClose runs, preventDefault called
 *   - close without swatch click → onSwatchClose does NOT run,
 *     preventDefault NOT called (Radix's natural focus-to-trigger stands)
 *   - the swatch-clicked flag is consumed (next close without a swatch
 *     click is treated as non-swatch)
 *
 * Builds elements with `React.createElement` to match the package's
 * `tests/**\/*.test.ts` runner (no JSX).
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { createElement as h, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  releaseFocusToBody,
  useMenuCloseHandlers,
  type MenuCloseHandlers,
} from "../../src/components/menu-focus";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function captureHandlers(onSwatchClose: () => void): {
  handlers: MenuCloseHandlers;
} {
  const result = { handlers: undefined as unknown as MenuCloseHandlers };
  function Probe() {
    const handlers = useMenuCloseHandlers(onSwatchClose);
    // Capture latest handlers each render so the test can call them.
    useEffect(() => {
      result.handlers = handlers;
    });
    result.handlers = handlers;
    return null;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(h(Probe));
  });
  return result as { handlers: MenuCloseHandlers };
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

function makeCloseEvent(): Event {
  return new Event("closeAutoFocus", { cancelable: true });
}

describe("useMenuCloseHandlers", () => {
  test("swatch click then close runs onSwatchClose and preventDefaults", () => {
    const onSwatchClose = vi.fn();
    const captured = captureHandlers(onSwatchClose);

    act(() => captured.handlers.markSwatchClicked());
    const e = makeCloseEvent();
    act(() => captured.handlers.onCloseAutoFocus(e));

    expect(onSwatchClose).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  test("close without swatch click skips onSwatchClose and lets default run", () => {
    const onSwatchClose = vi.fn();
    const captured = captureHandlers(onSwatchClose);

    const e = makeCloseEvent();
    act(() => captured.handlers.onCloseAutoFocus(e));

    expect(onSwatchClose).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  test("swatch-clicked flag is consumed after one close", () => {
    const onSwatchClose = vi.fn();
    const captured = captureHandlers(onSwatchClose);

    act(() => captured.handlers.markSwatchClicked());
    const first = makeCloseEvent();
    act(() => captured.handlers.onCloseAutoFocus(first));
    expect(onSwatchClose).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    // Re-open then dismiss via outside-click (no swatch click) — the flag
    // from the previous swatch-close must not bleed through.
    const second = makeCloseEvent();
    act(() => captured.handlers.onCloseAutoFocus(second));
    expect(onSwatchClose).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });
});

describe("releaseFocusToBody", () => {
  test("blurs the currently focused element", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    releaseFocusToBody();
    expect(document.activeElement).toBe(document.body);
    button.remove();
  });

  test("no-op when document.body itself is the active element", () => {
    // The default state in jsdom — nothing focusable focused.
    expect(document.activeElement).toBe(document.body);
    expect(() => releaseFocusToBody()).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });
});
