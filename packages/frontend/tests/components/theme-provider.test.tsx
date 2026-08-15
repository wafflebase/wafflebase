import { act, render, screen } from "@testing-library/react";
import { useContext } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ThemeProvider,
  ThemeProviderContext,
} from "@/components/theme-provider";

// jsdom ships no matchMedia, and the provider reads it during render to
// resolve `"system"`. A light-preferring stub keeps these tests about the
// storage guards.
const noMatch = {
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
} as unknown as MediaQueryList;

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => noMatch,
  });
});

afterAll(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

/**
 * Reads the provider's state and exposes `setTheme` through a button, so a
 * test can drive the same path the Settings switch does.
 */
function Probe() {
  const { theme, setTheme } = useContext(ThemeProviderContext);
  return (
    <button data-testid="probe" onClick={() => setTheme("dark")}>
      {theme}
    </button>
  );
}

function mount() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove("light", "dark");
});

describe("ThemeProvider storage guards", () => {
  it("still renders its subtree when reading storage throws", () => {
    // Safari private mode / blocked third-party storage / a sandboxed iframe
    // throw SecurityError on access, and this read runs during render of the
    // provider that wraps every route.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => mount()).not.toThrow();

    // Falls back to the default theme rather than blanking the app.
    expect(screen.getByTestId("probe").textContent).toBe("system");
  });

  it("keeps the chosen theme for the session when writing storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    mount();

    act(() => screen.getByTestId("probe").click());

    expect(screen.getByTestId("probe").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("persists the theme when storage works", () => {
    mount();

    act(() => screen.getByTestId("probe").click());

    expect(localStorage.getItem("vite-ui-theme")).toBe("dark");
  });

  it("restores a persisted theme on mount", () => {
    localStorage.setItem("vite-ui-theme", "dark");

    mount();

    expect(screen.getByTestId("probe").textContent).toBe("dark");
  });

  it("ignores a junk stored value instead of applying it as a class", () => {
    // The key is shared with the whole origin, so it can hold anything. A
    // value with a space throws InvalidCharacterError out of classList.add,
    // which would blank every route.
    localStorage.setItem("vite-ui-theme", "not a theme");

    expect(() => mount()).not.toThrow();

    expect(screen.getByTestId("probe").textContent).toBe("system");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("ignores an empty stored value", () => {
    // classList.add("") throws SyntaxError, so the empty string needs the same
    // rejection as any other unrecognized value.
    localStorage.setItem("vite-ui-theme", "");

    expect(() => mount()).not.toThrow();

    expect(screen.getByTestId("probe").textContent).toBe("system");
  });
});
