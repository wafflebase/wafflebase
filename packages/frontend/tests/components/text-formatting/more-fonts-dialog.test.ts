// @vitest-environment jsdom
/**
 * Smoke tests for MoreFontsDialog. Radix Dialog portals into
 * document.body, so content is queried there. IntersectionObserver is
 * absent in jsdom; the dialog guards on it, so preview lazy-loading is a
 * no-op here and the list still renders. JSX is avoided to match the
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

const CATALOG: FontEntry[] = [
  { label: "Roboto", family: "Roboto", group: "Sans-serif", webFont: true, scripts: ["latin"] },
  { label: "Merriweather", family: "Merriweather", group: "Serif", webFont: true, scripts: ["latin"] },
  { label: "Lobster", family: "Lobster", group: "Display", webFont: true, scripts: ["latin"] },
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
});
