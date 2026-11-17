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
import { useCanvasFocusRelease } from "@/components/toolbar-focus-release";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

  it("keeps the menu open when a control inside it is clicked", async () => {
    // The real toolbar row is a canvas toolbar with the focus-release hook
    // mounted (#882). The menu must not count as part of it: releasing
    // focus from a control in the menu would move focus out of the
    // popover and dismiss it after a single click.
    function FocusRelease() {
      useCanvasFocusRelease();
      return null;
    }
    stripWidth = 100;
    render(
      <TooltipProvider>
        <FocusRelease />
        <div data-canvas-toolbar="">
          <ToolbarOverflow resetKey="idle">
            <Section />
          </ToolbarOverflow>
        </div>
      </TooltipProvider>,
    );
    await act(async () => {});
    await userEvent.click(moreButton());
    const menu = await screen.findByTestId("toolbar-overflow-menu");
    const control = Array.from(menu.querySelectorAll("button")).find(
      (b) => b.textContent === "C",
    )!;
    await userEvent.click(control);
    // The release is deferred one task.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByTestId("toolbar-overflow-menu")).not.toBeNull();
    expect(document.activeElement).toBe(control);
  });

  it("stays open while a folded picker's own portalled popup is used", async () => {
    // A folded picker renders its menu in a separate Radix portal, outside
    // the More popover; a click there is not an outside click for More.
    function PickerSection() {
      return (
        <>
          <button data-w="40">A</button>
          <button data-w="40">B</button>
          <Popover modal>
            <PopoverTrigger data-w="40">Picker</PopoverTrigger>
            <PopoverContent>
              <button>Option</button>
            </PopoverContent>
          </Popover>
        </>
      );
    }
    stripWidth = 80;
    render(
      <TooltipProvider>
        <div>
          <ToolbarOverflow resetKey="idle">
            <PickerSection />
          </ToolbarOverflow>
        </div>
      </TooltipProvider>,
    );
    await act(async () => {});
    await userEvent.click(moreButton());
    const menu = await screen.findByTestId("toolbar-overflow-menu");
    const picker = Array.from(menu.querySelectorAll("button")).find(
      (b) => b.textContent === "Picker",
    )!;
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("button", { name: "Option" }));
    expect(screen.queryByTestId("toolbar-overflow-menu")).not.toBeNull();
  });

  it("moves focus into the menu when it is opened from the keyboard", async () => {
    await renderOverflow(100);
    const more = moreButton();
    more.focus();
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByTestId("toolbar-overflow-menu");
    expect(menu.closest("[data-slot='popover-content']")).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it("leaves focus on the trigger when it is opened by a click", async () => {
    await renderOverflow(100);
    const more = moreButton();
    await userEvent.click(more);
    await screen.findByTestId("toolbar-overflow-menu");
    expect(document.activeElement).toBe(more);
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
