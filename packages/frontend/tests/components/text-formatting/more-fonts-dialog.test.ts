// @vitest-environment jsdom
/**
 * Smoke tests for MoreFontsDialog. Radix Dialog portals into
 * document.body, so content is queried there. jsdom ships no
 * IntersectionObserver and lays nothing out, so the stub below records
 * the observed rows and lets a test drive an intersection explicitly —
 * mirroring `font-family-picker.test.ts`. JSX is avoided to match the
 * package's `*.test.ts` runner.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { createElement as h, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { MoreFontsDialog } from "../../../src/components/text-formatting/more-fonts-dialog.tsx";
import type { FontEntry } from "../../../src/components/text-formatting/font-catalog.ts";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

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

function previewLinks(): HTMLLinkElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(
      "link[data-wafflebase-font-preview]",
    ),
  );
}

const CATALOG: FontEntry[] = [
  { label: "Roboto", family: "Roboto", group: "Sans-serif", webFont: true, scripts: ["latin"] },
  { label: "Merriweather", family: "Merriweather", group: "Serif", webFont: true, scripts: ["latin"] },
  // `weights: "700"` stands in for a family that ships no 400 cut (the
  // real one is `Sunflower`): the preview must request 700, not 400.
  { label: "Lobster", family: "Lobster", group: "Display", webFont: true, weights: "700", scripts: ["latin"] },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ui: ReactElement): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  for (const link of previewLinks()) link.remove();
  observers.length = 0;
});

function rowFamilies(): string[] {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>("[data-font-row]"),
  ).map((el) => el.dataset.fontRow ?? "");
}

function clickCategory(name: string): void {
  const chip = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>("button"),
  ).find((b) => b.textContent === name);
  if (!chip) throw new Error(`category chip not found: ${name}`);
  act(() => chip.click());
}

describe("MoreFontsDialog", () => {
  test("renders a row per catalog family when open", () => {
    render(
      h(MoreFontsDialog, {
        open: true,
        onOpenChange: () => {},
        value: undefined,
        onPick: () => {},
        catalog: CATALOG,
      }),
    );
    expect(rowFamilies()).toEqual(["Roboto", "Merriweather", "Lobster"]);
  });

  test("category chip narrows the list", () => {
    render(
      h(MoreFontsDialog, {
        open: true,
        onOpenChange: () => {},
        value: undefined,
        onPick: () => {},
        catalog: CATALOG,
      }),
    );
    clickCategory("Serif");
    expect(rowFamilies()).toEqual(["Merriweather"]);
  });

  test("clicking a row requests close (onOpenChange false)", () => {
    const onOpenChange = vi.fn();
    render(
      h(MoreFontsDialog, {
        open: true,
        onOpenChange,
        value: undefined,
        onPick: () => {},
        catalog: CATALOG,
      }),
    );
    const row = document.body.querySelector<HTMLElement>('[data-font-row="Lobster"]');
    act(() => row!.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // #963: a row scrolling into view pulls only the glyphs it paints. The
  // row <button> carries the fontFamily, so the group-name span inherits
  // it — subsetting the label alone would split "Display" onto the
  // fallback face.
  test("an in-view row previews a subset covering label and group name", () => {
    render(
      h(MoreFontsDialog, {
        open: true,
        onOpenChange: () => {},
        value: undefined,
        onPick: () => {},
        catalog: CATALOG,
      }),
    );
    const observer = observers.at(-1)!;
    const row = observer.observed.find(
      (node) => (node as HTMLElement).dataset.fontRow === "Lobster",
    );
    expect(row).toBeTruthy();

    act(() => observer.callback([{ target: row!, isIntersecting: true }]));

    const links = previewLinks();
    expect(links).toHaveLength(1);
    expect(links[0].dataset.wafflebaseFontPreview).toBe("Lobster");
    const href = new URL(links[0].getAttribute("href")!);
    const text = href.searchParams.get("text") ?? "";
    for (const ch of "LobsterDisplay") expect(text).toContain(ch);
    // Weight comes from the row's entry, never a hardcoded 400.
    expect(href.searchParams.get("family")).toBe("Lobster:wght@700");
  });
});
