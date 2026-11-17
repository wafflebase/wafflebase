/**
 * `ToolbarOverflow` folds the slides toolbar's contextual tail into a ⋮
 * More menu when the row is too narrow. jsdom has no layout, so the
 * integration cases stub the three measurements the component reads —
 * `offsetLeft` / `offsetWidth` per child (from a `data-w` width) and the
 * strip's `clientWidth` — and assert the DOM contract: which children
 * carry `data-toolbar-folded` in the strip and in the menu, and whether
 * the More button shows.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToolbarOverflow } from "./toolbar-overflow";
import { computeFoldIndex, isHiddenInMenu } from "./toolbar-overflow-layout";

describe("computeFoldIndex", () => {
  const items = [
    { right: 40, separator: false },
    { right: 80, separator: false },
    { right: 90, separator: true },
    { right: 130, separator: false },
    { right: 170, separator: false },
  ];

  it("folds nothing when the content fits once More goes away", () => {
    // 170 > 150 with More shown, but More's 28px come back without it.
    expect(computeFoldIndex(items, 150, 28)).toBeNull();
  });

  it("folds from the first child past the edge", () => {
    expect(computeFoldIndex(items, 135, 28)).toBe(4);
  });

  it("never leaves a separator at the end of the strip", () => {
    expect(computeFoldIndex(items, 100, 28)).toBe(2);
  });

  it("folds everything when nothing fits", () => {
    expect(computeFoldIndex(items, 10, 28)).toBe(0);
  });

  it("folds nothing in a layout-less environment", () => {
    const zero = items.map((i) => ({ ...i, right: 0 }));
    expect(computeFoldIndex(zero, 0, 0)).toBeNull();
  });
});

describe("isHiddenInMenu", () => {
  const seps = [false, false, true, false, true, false];

  it("hides what the strip still shows and the separators that lead the menu", () => {
    const hidden = seps.map((_, i) => isHiddenInMenu(seps, 2, i));
    expect(hidden).toEqual([true, true, true, false, false, false]);
  });
});

// ---------------------------------------------------------------------------
// Integration with stubbed geometry
// ---------------------------------------------------------------------------

let stripWidth = 0;
const MORE_WIDTH = 28;
const originals = new Map<string, PropertyDescriptor | undefined>();

function widthOf(el: HTMLElement): number {
  if (el.getAttribute("aria-label") === "More toolbar options") return MORE_WIDTH;
  return Number(el.dataset.w ?? 0);
}

beforeAll(() => {
  const proto = HTMLElement.prototype;
  const stub = (name: string, get: (this: HTMLElement) => number) => {
    originals.set(name, Object.getOwnPropertyDescriptor(proto, name));
    Object.defineProperty(proto, name, { configurable: true, get });
  };
  stub("offsetWidth", function () {
    return widthOf(this);
  });
  stub("offsetLeft", function () {
    let left = 0;
    for (let s = this.previousElementSibling; s; s = s.previousElementSibling) {
      left += widthOf(s as HTMLElement);
    }
    return left;
  });
  stub("clientWidth", function () {
    return this.dataset.testid === "toolbar-contextual" ? stripWidth : 0;
  });
});

afterAll(() => {
  for (const [name, desc] of originals) {
    if (desc) Object.defineProperty(HTMLElement.prototype, name, desc);
  }
});

function Section() {
  return (
    <>
      <button data-w="40">A</button>
      <button data-w="40">B</button>
      <div data-slot="separator" data-w="10" />
      <button data-w="40">C</button>
      <button data-w="40">D</button>
    </>
  );
}

async function renderOverflow(width: number, keepTextEdit = false) {
  stripWidth = width;
  const utils = render(
    <TooltipProvider>
      <div>
        <ToolbarOverflow resetKey="idle" keepTextEdit={keepTextEdit}>
          <Section />
        </ToolbarOverflow>
      </div>
    </TooltipProvider>,
  );
  await act(async () => {});
  return utils;
}

const MORE_IDLE = "data-toolbar-more-idle";

function moreButton(): HTMLElement {
  return screen.getByRole("button", { name: "More toolbar options", hidden: true });
}

function folded(container: Element): string[] {
  return Array.from(container.children)
    .filter((c) => c.hasAttribute("data-toolbar-folded"))
    .map((c) => c.textContent || c.getAttribute("data-slot") || "");
}

describe("ToolbarOverflow", () => {
  it("shows every control and hides More when the strip fits", async () => {
    await renderOverflow(150);
    expect(folded(screen.getByTestId("toolbar-contextual"))).toEqual([]);
    expect(moreButton()).toHaveAttribute(MORE_IDLE);
  });

  it("folds the tail into a More menu that holds exactly the folded controls", async () => {
    await renderOverflow(100);
    expect(folded(screen.getByTestId("toolbar-contextual"))).toEqual([
      "separator",
      "C",
      "D",
    ]);
    const more = moreButton();
    expect(more).not.toHaveAttribute(MORE_IDLE);

    await userEvent.click(more);
    const menu = await screen.findByTestId("toolbar-overflow-menu");
    expect(folded(menu)).toEqual(["A", "B", "separator"]);
    // The folded controls are live in the menu, not copies of labels.
    expect(menu.querySelectorAll("button:not([data-toolbar-folded])")).toHaveLength(2);
  });

  it("unfolds when the row widens again", async () => {
    await renderOverflow(100);
    stripWidth = 150;
    // A content change is one of the re-measure triggers; jsdom has no
    // ResizeObserver to deliver the width change itself.
    await act(async () => {
      screen.getByText("D").append("");
    });
    expect(folded(screen.getByTestId("toolbar-contextual"))).toEqual([]);
  });

  it("shows More in the same DOM write that folds, without a React render", async () => {
    await renderOverflow(150);
    expect(moreButton()).toHaveAttribute(MORE_IDLE);
    stripWidth = 100;
    // Deliberately outside `act`: only the MutationObserver's measure pass
    // runs before the assertions, so React has not re-rendered yet.
    screen.getByText("D").append("");
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(folded(screen.getByTestId("toolbar-contextual"))).toEqual([
      "separator",
      "C",
      "D",
    ]);
    expect(moreButton()).not.toHaveAttribute(MORE_IDLE);
    await act(async () => {});
  });

  it("keeps a text edit alive through the More trigger and menu", async () => {
    await renderOverflow(100, true);
    const more = moreButton();
    expect(more).toHaveAttribute("data-text-edit-keepalive");
    await userEvent.click(more);
    const menu = await screen.findByTestId("toolbar-overflow-menu");
    expect(menu.closest("[data-slot='popover-content']")).toHaveAttribute(
      "data-text-edit-keepalive",
    );
  });

  it("does not mark the trigger or menu as keepalive outside a text edit", async () => {
    await renderOverflow(100);
    const more = moreButton();
    expect(more).not.toHaveAttribute("data-text-edit-keepalive");
    await userEvent.click(more);
    const menu = await screen.findByTestId("toolbar-overflow-menu");
    const content = menu.closest("[data-slot='popover-content']");
    expect(content).not.toBeNull();
    expect(content).not.toHaveAttribute("data-text-edit-keepalive");
  });
});
