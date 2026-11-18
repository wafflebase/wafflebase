import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InsertKind, SlidesEditor } from "@wafflebase/slides";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SHAPE_PICKER_CATEGORIES } from "../slides/shape-picker-helpers";
import { BoardToolDock } from "./board-tool-dock";
import { createHandTool } from "./board-hand";
import { createDrawingTools } from "./board-drawing-extras";
import { BOARD_SHAPES } from "./board-shapes";
import { BOARD_OVERLAY_ATTR } from "./fit-insets";

/** An idle editor whose insert mode can be driven from the test. */
function fakeEditor() {
  let mode: InsertKind | null = null;
  const listeners = new Set<() => void>();
  return {
    getInsertMode: () => mode,
    setInsertMode: vi.fn((next: InsertKind | null) => {
      mode = next;
      listeners.forEach((l) => l());
    }),
    onInsertModeChange: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as SlidesEditor & { setInsertMode: ReturnType<typeof vi.fn> };
}

/**
 * Renders the dock into a host of the given width (`clientWidth` is what
 * the layout reads; jsdom lays nothing out, so it is pinned here).
 */
function renderDock(
  editor: SlidesEditor = fakeEditor(),
  {
    hand = createHandTool(),
    drawingTools = createDrawingTools(),
    hostWidth,
  }: {
    hand?: ReturnType<typeof createHandTool>;
    drawingTools?: ReturnType<typeof createDrawingTools>;
    hostWidth?: number;
  } = {},
) {
  const host = document.createElement("div");
  if (hostWidth !== undefined) {
    Object.defineProperty(host, "clientWidth", { value: hostWidth });
  }
  document.body.appendChild(host);
  render(
    <TooltipProvider>
      <BoardToolDock editor={editor} hand={hand} drawingTools={drawingTools} />
    </TooltipProvider>,
    { container: host },
  );
  return { editor, hand, drawingTools };
}

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("BoardToolDock", () => {
  it("is a labelled toolbar that fits avoid and focus release covers", () => {
    renderDock();
    const dock = screen.getByRole("toolbar", { name: "Board tools" });
    expect(dock.hasAttribute(BOARD_OVERLAY_ATTR)).toBe(true);
    expect(dock.hasAttribute("data-canvas-toolbar")).toBe(true);
    expect(dock.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("holds the insert tools", () => {
    renderDock();
    for (const name of [
      "Select",
      "Lasso select",
      "Hand",
      "Sticky note",
      "Sticky note color",
      "Text box",
      "Shape",
      "Line",
      "Marker",
      "Eraser",
      "Section",
      "Insert image",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("names the shortcut in a tool's tooltip", async () => {
    renderDock();
    await userEvent.hover(screen.getByRole("button", { name: "Text box" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain("Text box (T)");
  });

  it("moves focus between tools with the arrow keys", async () => {
    renderDock();
    const select = screen.getByRole("button", { name: "Select" });
    // Tab in, as a keyboard user would: focus that arrives without a Tab is
    // handed back to the canvas (issue #882), which is the point of it.
    await userEvent.tab();
    expect(document.activeElement).toBe(select);
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Lasso select" }));
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(select);
    // The last ENABLED tool: this dock has no image inserter or sections,
    // so Insert image and Section are disabled and skipped.
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Eraser" }));
  });
});

describe("BoardToolDock hand toggle", () => {
  it("arms the hand and takes Select's pressed state", async () => {
    const { hand } = renderDock();
    expect(pressed("Select")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Hand" }));
    expect(hand.get()).toBe(true);
    expect(pressed("Hand")).toBe("true");
    expect(pressed("Select")).toBe("false");
  });

  it("follows hand state changed elsewhere (the H key, Esc)", () => {
    const { hand } = renderDock();
    act(() => hand.set(true));
    expect(pressed("Hand")).toBe("true");
    act(() => hand.set(false));
    expect(pressed("Hand")).toBe("false");
    expect(pressed("Select")).toBe("true");
  });

  it("disarms the hand when Select is clicked", async () => {
    const editor = fakeEditor();
    const { hand } = renderDock(editor);
    act(() => hand.set(true));
    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(hand.get()).toBe(false);
    expect(editor.setInsertMode).toHaveBeenCalledWith(null);
  });
});

describe("BoardToolDock lasso and laser", () => {
  it("puts the lasso right after Select", () => {
    renderDock();
    const buttons = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(buttons.indexOf("Lasso select")).toBe(buttons.indexOf("Select") + 1);
  });

  it("arms the lasso, and either drawing tool takes Select's pressed state", async () => {
    const { drawingTools } = renderDock();
    await userEvent.click(screen.getByRole("button", { name: "Lasso select" }));
    expect(drawingTools.lasso.get()).toBe(true);
    expect(pressed("Select")).toBe("false");
    act(() => drawingTools.lasso.set(false));
    expect(pressed("Select")).toBe("true");
    act(() => drawingTools.laser.set(true));
    expect(pressed("Select")).toBe("false");
  });

  it("disarms the laser and the lasso when Select is clicked", async () => {
    const { drawingTools } = renderDock();
    act(() => drawingTools.laser.set(true));
    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(drawingTools.laser.get()).toBe(false);
    act(() => drawingTools.lasso.set(true));
    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(drawingTools.lasso.get()).toBe(false);
  });
});

describe("BoardToolDock pickers", () => {
  it("names the line tools in whiteboard words", async () => {
    renderDock();
    await userEvent.click(screen.getByRole("button", { name: "Line" }));
    for (const name of ["Line", "Arrow", "Connector", "Curved"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // No freehand entry: the dedicated Marker tool (M) is the board's one
    // way to draw.
    for (const name of ["Scribble", "Elbow connector", "Curved connector"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("opens the shape picker on the curated board shapes, with the rest one click in", async () => {
    const editor = fakeEditor();
    renderDock(editor);
    await userEvent.click(screen.getByRole("button", { name: "Shape" }));
    for (const { label } of BOARD_SHAPES) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    // A full-catalogue-only shape is not offered until "More shapes…".
    expect(screen.queryByRole("button", { name: "Heptagon" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "More shapes…" }));
    expect(screen.getByRole("button", { name: "Heptagon" })).toBeTruthy();
    const total = SHAPE_PICKER_CATEGORIES.reduce((n, c) => n + c.kinds.length, 0);
    expect(total).toBeGreaterThan(BOARD_SHAPES.length);

    await userEvent.click(screen.getByRole("button", { name: "Heptagon" }));
    expect(editor.setInsertMode).toHaveBeenCalledWith("heptagon");
  });

  it("arms a curated shape", async () => {
    const editor = fakeEditor();
    renderDock(editor);
    await userEvent.click(screen.getByRole("button", { name: "Shape" }));
    await userEvent.click(screen.getByRole("button", { name: "Speech bubble" }));
    expect(editor.setInsertMode).toHaveBeenCalledWith("wedgeRoundRectCallout");
  });
});

describe("BoardToolDock split tools and commands", () => {
  it("builds the Sticky and Marker chevrons from one primitive, each with a tooltip", async () => {
    renderDock();
    for (const name of ["Sticky note color", "Pen, colour and width"]) {
      const chevron = screen.getByRole("button", { name });
      expect(chevron.hasAttribute("data-split-chevron")).toBe(true);
      expect(chevron.className).toContain("w-5");
    }
    await userEvent.hover(screen.getByRole("button", { name: "Sticky note color" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain("Sticky note color");
  });

  it("gives one-shot commands no pressed state", () => {
    renderDock();
    // A sticky is dropped at once and an image is picked from a dialog;
    // neither has an armed state for a screen reader to announce.
    expect(pressed("Sticky note")).toBeNull();
    expect(pressed("Insert image")).toBeNull();
  });

  it("marks the menu-opening Shape and Line with a corner caret", () => {
    renderDock();
    const caretOf = (name: string) =>
      screen.getByRole("button", { name }).nextElementSibling?.hasAttribute("data-menu-caret");
    expect(caretOf("Shape")).toBe(true);
    expect(caretOf("Line")).toBe(true);
    // A plain tool does not get one.
    expect(caretOf("Text box")).toBeFalsy();
  });
});

describe("BoardToolDock on a narrow board", () => {
  it("keeps the dock's group separators inside More", async () => {
    renderDock(fakeEditor(), { hostWidth: 375 });
    await userEvent.click(screen.getByRole("button", { name: "More tools" }));
    const more = screen.getByRole("dialog", { name: "More tools" });
    // lasso hand | line | eraser | section image
    expect(more.querySelectorAll('[data-slot="separator"]')).toHaveLength(3);
  });

  it("folds the rarer tools under More", async () => {
    renderDock(fakeEditor(), { hostWidth: 375 });
    for (const name of ["Select", "Sticky note", "Text box", "Shape", "Marker"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    const folded = ["Lasso select", "Hand", "Line", "Eraser", "Section", "Insert image"];
    for (const name of folded) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    await userEvent.click(screen.getByRole("button", { name: "More tools" }));
    for (const name of folded) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("closes More once a tool in it is armed, and marks More as live", async () => {
    const { hand } = renderDock(fakeEditor(), { hostWidth: 375 });
    await userEvent.click(screen.getByRole("button", { name: "More tools" }));
    await userEvent.click(screen.getByRole("button", { name: "Hand" }));
    expect(hand.get()).toBe(true);
    expect(screen.queryByRole("button", { name: "Hand" })).toBeNull();
    expect(screen.getByRole("button", { name: "More tools" }).className).toContain("bg-selected");
  });

  it("marks More as live while the folded lasso is armed", () => {
    const { drawingTools } = renderDock(fakeEditor(), { hostWidth: 375 });
    act(() => drawingTools.lasso.set(true));
    expect(screen.getByRole("button", { name: "More tools" }).className).toContain("bg-selected");
  });

  it("pins itself bottom-left, clear of the minimap toggle", () => {
    renderDock(fakeEditor(), { hostWidth: 375 });
    const dock = screen.getByRole("toolbar", { name: "Board tools" });
    expect(dock.className).toContain("left-3");
    expect(dock.style.maxWidth).toBe("calc(100% - 84px)");
  });
});
