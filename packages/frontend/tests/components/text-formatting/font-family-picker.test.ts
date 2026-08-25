// @vitest-environment jsdom
/**
 * Tests for the shared FontFamilyPicker dropdown.
 *
 * Asserts:
 *   - the trigger label shows the resolved value,
 *   - undefined (mixed-selection) renders the em-dash placeholder,
 *   - clicking a menu item fires `onChange` with the catalog family,
 *   - opening the menu observes the rows but loads no font,
 *   - a row scrolling into view loads exactly that family (issue #727).
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

/*
 * The full ~1,900-family library, stubbed. The picker pulls it whenever a
 * recent family is missing from the curated catalog, because that is the only
 * place its `weights` can be found — see the recents test at the bottom.
 * Hoisted by Vitest, so every test in this file gets the stub; only that one
 * triggers a load.
 */
// The family name is inlined rather than shared with `FAKE_RECENT` below:
// `vi.mock` is hoisted above every declaration in this file, so a factory
// closing over a module-level const reads it in its temporal dead zone.
vi.mock(
  "../../../src/components/text-formatting/font-catalog-full-loader.ts",
  () => ({
    loadFullFontCatalog: () =>
      Promise.resolve([
        {
          label: "Wafflebase Fake Recent",
          family: "Wafflebase Fake Recent",
          group: "Display",
          webFont: true,
          // A single 700 cut, like the real `Sunflower`: css2 answers a
          // :wght@400 request for such a family with an HTTP 400 error page.
          weights: "700",
        },
      ]),
  }),
);
const FAKE_RECENT = "Wafflebase Fake Recent";

import { TooltipProvider } from "../../../src/components/ui/tooltip.tsx";
import { FontFamilyPicker } from "../../../src/components/text-formatting/font-family-picker.tsx";
import { ensureFontLink } from "../../../src/components/text-formatting/font-catalog.ts";

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

// jsdom ships no IntersectionObserver either, and the picker's preview
// loader is built on one. This stub records the callback and the
// observed rows instead of firing, so a test can drive an intersection
// explicitly — jsdom never lays anything out, so a real observer would
// have nothing to report. `more-fonts-dialog.test.ts` documents the same
// gap and simply lets its observer no-op.
interface StubObserver {
  callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;
  observed: Element[];
}
const observers: StubObserver[] = [];

(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
  class {
    private readonly rec: StubObserver;
    constructor(callback: StubObserver["callback"]) {
      this.rec = { callback, observed: [] };
      observers.push(this.rec);
    }
    observe(el: Element): void {
      this.rec.observed.push(el);
    }
    unobserve(el: Element): void {
      const i = this.rec.observed.indexOf(el);
      if (i >= 0) this.rec.observed.splice(i, 1);
    }
    disconnect(): void {
      this.rec.observed.length = 0;
    }
  };

function fontLinks(): HTMLLinkElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>("link[data-wafflebase-font]"),
  );
}

/** Subsetted preview links, marked separately so the full-load path
 *  cannot dedupe against them. */
function previewLinks(): HTMLLinkElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(
      "link[data-wafflebase-font-preview]",
    ),
  );
}

/** Radix DropdownMenu opens on pointer events, not a synthetic .click(). */
function openMenu(trigger: HTMLElement): void {
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
  // Every test here opens the menu, which arms the preview loader, so
  // the injected <link> elements have to be cleared between them.
  for (const link of [...fontLinks(), ...previewLinks()]) link.remove();
  observers.length = 0;
  // The Recent section is localStorage-backed and shared across tests.
  localStorage.removeItem("wafflebase:recent-fonts");
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

  // Previews load per visible row, never as a batch on open. The whole
  // catalog is ~1.1 MB of CSS, most of it the Korean families that sort
  // first, so "just eager-load everything" is the regression this pins.
  test("opening the menu observes rows without loading any font", () => {
    const el = render(
      h(FontFamilyPicker, { value: "Arial", onChange: () => {} }),
    );
    openMenu(el.querySelector('[aria-label="Font"]') as HTMLElement);

    // Without this the assertion below would pass vacuously if the
    // observer were never wired up at all.
    expect(observers.at(-1)!.observed.length).toBeGreaterThan(0);
    expect(fontLinks()).toHaveLength(0);
    expect(previewLinks()).toHaveLength(0);
  });

  // The fix for #727: a row becoming visible is what loads its face, so
  // scrolling and keyboard navigation paint real previews instead of
  // leaving everything but the 8 eager families in a fallback. Since
  // #963 the face it loads is subsetted to the row's own label.
  test("a row scrolling into view previews exactly that family", () => {
    const el = render(
      h(FontFamilyPicker, { value: "Arial", onChange: () => {} }),
    );
    openMenu(el.querySelector('[aria-label="Font"]') as HTMLElement);

    // A web font that is NOT in the eager bootstrap set — the eager
    // eight and the system faces are deliberate no-ops.
    const observer = observers.at(-1)!;
    const row = observer.observed.find(
      (node) => (node as HTMLElement).dataset.fontRow === "Open Sans",
    );
    expect(row).toBeTruthy();

    act(() => observer.callback([{ target: row!, isIntersecting: true }]));

    // A preview costs a subset, not the family: no full link is injected.
    expect(fontLinks()).toHaveLength(0);
    const links = previewLinks();
    expect(links).toHaveLength(1);
    expect(links[0].dataset.wafflebaseFontPreview).toBe("Open Sans");
    expect(links[0].getAttribute("href")).toContain(
      `text=${encodeURIComponent("Open Sas")}`,
    );
  });

  // The risk the split marker exists for (#963): a family the user only
  // ever scrolled past must still load in full when they pick it —
  // `ensureFontLink`'s dedupe must not resolve against the subset.
  test("selecting a previewed-only family still loads the full family", async () => {
    const el = render(
      h(FontFamilyPicker, { value: "Arial", onChange: ensureFontLink }),
    );
    openMenu(el.querySelector('[aria-label="Font"]') as HTMLElement);

    const observer = observers.at(-1)!;
    const row = observer.observed.find(
      (node) => (node as HTMLElement).dataset.fontRow === "Open Sans",
    )!;
    act(() => observer.callback([{ target: row, isIntersecting: true }]));
    expect(previewLinks()).toHaveLength(1);

    act(() => {
      for (const type of ["pointerdown", "pointerup"] as const) {
        row.dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, button: 0 }),
        );
      }
      row.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const full = fontLinks();
    expect(full).toHaveLength(1);
    expect(full[0].dataset.wafflebaseFont).toBe("Open Sans");
    expect(full[0].getAttribute("href")).not.toContain("text=");
  });

  /*
   * A RECENT FROM OUTSIDE THE CURATED CATALOG. `addRecentFont` stores bare
   * family names, so a font picked out of the 1,900-entry library resurfaces in
   * the Recent section with no catalog entry behind it — and previewing it at
   * the default `wght@400` is exactly the failure the weight lookup exists to
   * avoid, because css2 answers a 400 request for a family that ships no 400
   * with an HTML error page and the row stays in a fallback face forever.
   * The picker pulls the full library for the weights and holds the row back
   * until they arrive.
   */
  test("a recent outside the curated catalog previews at a weight it ships", async () => {
    localStorage.setItem(
      "wafflebase:recent-fonts",
      JSON.stringify([FAKE_RECENT]),
    );
    const el = render(
      h(FontFamilyPicker, { value: "Arial", onChange: () => {} }),
    );
    openMenu(el.querySelector('[aria-label="Font"]') as HTMLElement);

    // Not yet observable: with no weights, a preview now would be permanent
    // and wrong (the observer unobserves on first hit).
    const rowOf = (o: StubObserver) =>
      o.observed.find(
        (node) => (node as HTMLElement).dataset.fontRow === FAKE_RECENT,
      );
    expect(rowOf(observers.at(-1)!)).toBeUndefined();

    // Let the stubbed full-catalog import settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const observer = observers.at(-1)!;
    const row = rowOf(observer);
    expect(row).toBeTruthy();
    act(() => observer.callback([{ target: row!, isIntersecting: true }]));

    const href = previewLinks()[0]?.getAttribute("href") ?? "";
    expect(href).toContain(`${encodeURIComponent(FAKE_RECENT)}:wght@700`);
    expect(href).not.toContain("wght@400");
  });
});
