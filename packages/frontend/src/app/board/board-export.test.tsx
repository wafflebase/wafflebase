import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Element, SlidesEditor, SlidesStore } from "@wafflebase/slides";
import { TooltipProvider } from "@/components/ui/tooltip";

const { exportBoard } = vi.hoisted(() => ({
  exportBoard: vi.fn(async (opts: unknown) => void opts),
}));
vi.mock("./board-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./board-export")>();
  return { ...actual, exportBoard };
});

import { BOARD_EXPORT_PAD, boardExportRegion } from "./board-export";
import { BoardExportMenu } from "./board-export-menu";

const el = (id: string, x: number, y: number, w = 100, h = 100) =>
  ({ id, type: "shape", frame: { x, y, w, h, rotation: 0 }, data: { kind: "rect" } }) as unknown as Element;
const elements = [el("a", 0, 0), el("b", 1000, 500, 200, 50)];

describe("boardExportRegion", () => {
  it("covers every element, padded", () => {
    expect(boardExportRegion(elements)).toEqual({
      x: -BOARD_EXPORT_PAD,
      y: -BOARD_EXPORT_PAD,
      w: 1200 + 2 * BOARD_EXPORT_PAD,
      h: 550 + 2 * BOARD_EXPORT_PAD,
    });
  });

  it("covers only the selection when ids are given", () => {
    expect(boardExportRegion(elements, ["b"])).toEqual({
      x: 1000 - BOARD_EXPORT_PAD,
      y: 500 - BOARD_EXPORT_PAD,
      w: 200 + 2 * BOARD_EXPORT_PAD,
      h: 50 + 2 * BOARD_EXPORT_PAD,
    });
  });

  it("is undefined for an empty board", () => {
    expect(boardExportRegion([])).toBeUndefined();
  });
});

describe("BoardExportMenu", () => {
  function setup(selection: string[]) {
    const doc = { slides: [{ elements }] };
    const store = { read: () => doc } as unknown as SlidesStore;
    const editor = {
      getSelection: () => selection,
      onSelectionChange: () => () => {},
    } as unknown as SlidesEditor;
    render(
      <TooltipProvider>
        <BoardExportMenu store={store} editor={editor} title="Retro" />
      </TooltipProvider>,
    );
    return doc;
  }

  it("exports the whole board as PNG", async () => {
    exportBoard.mockClear();
    const doc = setup([]);
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Download as PNG" }));
    await vi.waitFor(() => expect(exportBoard).toHaveBeenCalled());
    expect(exportBoard).toHaveBeenCalledWith({ doc, format: "png", title: "Retro", ids: undefined });
  });

  it("wears the dock's floating surface and a fingertip floor", () => {
    setup([]);
    const button = screen.getByRole("button", { name: "Download" });
    // Foreground, not muted: a muted icon all but vanished on the white plane.
    expect(button.className).toContain("text-foreground");
    expect(button.className).not.toContain("text-muted-foreground");
    expect(button.className).toContain("shadow-md");
    expect(button.className).toContain("pointer-coarse:size-11");
  });

  it("disables selection export with nothing selected", async () => {
    setup([]);
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(
      screen.getByRole("menuitem", { name: "Download selection as PNG" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("exports only the top-level selection as PDF", async () => {
    exportBoard.mockClear();
    setup(["b", "nested-member"]);
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Download selection as PDF" }));
    await vi.waitFor(() => expect(exportBoard).toHaveBeenCalled());
    expect(exportBoard).toHaveBeenCalledWith(
      expect.objectContaining({ format: "pdf", ids: ["b"] }),
    );
  });
});
