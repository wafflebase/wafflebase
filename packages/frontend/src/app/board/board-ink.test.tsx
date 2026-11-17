import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InsertKind, SlidesEditor } from "@wafflebase/slides";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DEFAULT_INK_STATE,
  HIGHLIGHTER_ALPHA,
  INK_WIDTHS,
  armInkPen,
  createInkTool,
  inkStroke,
  isInkArmed,
  parseInkState,
} from "./board-ink";
import { BoardInkControls } from "./board-ink-controls";
import { boardToolForKey, handleBoardToolKey, BOARD_SHORTCUTS } from "./board-shortcuts";

const key = (k: string, shiftKey = false) => ({
  key: k,
  shiftKey,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
});

describe("ink tool keys", () => {
  it("maps M, Shift+M and Shift+E", () => {
    expect(boardToolForKey(key("m"))).toEqual({ kind: "ink", pen: "marker" });
    expect(boardToolForKey(key("M", true))).toEqual({ kind: "ink", pen: "highlighter" });
    expect(boardToolForKey(key("E", true))).toEqual({ kind: "insert", insert: "eraser" });
    // Plain E stays free; Shift on other letters is still not a tool.
    expect(boardToolForKey(key("e"))).toBeNull();
    expect(boardToolForKey(key("T", true))).toBeNull();
  });

  it("arms the pen on an idle board and stands down on a selection", () => {
    const make = (selection: string[]) => ({
      editor: {
        isTextEditing: () => false,
        isCropping: () => false,
        getSelection: () => selection,
        setInsertMode: vi.fn(),
      },
      readOnly: false,
      fit: vi.fn(),
      zoomStep: vi.fn(),
      zoomTo: vi.fn(),
      fitSelection: vi.fn(),
      setHand: vi.fn(),
      dropSticky: vi.fn(),
      armInk: vi.fn(),
      isBoardTarget: () => true,
    });
    const idle = make([]);
    expect(handleBoardToolKey(new KeyboardEvent("keydown", { key: "M", shiftKey: true }), idle)).toBe(true);
    expect(idle.armInk).toHaveBeenCalledWith("highlighter");
    expect(handleBoardToolKey(new KeyboardEvent("keydown", { key: "E", shiftKey: true }), idle)).toBe(true);
    expect(idle.editor.setInsertMode).toHaveBeenCalledWith("eraser");
    const selected = make(["sticky"]);
    expect(handleBoardToolKey(new KeyboardEvent("keydown", { key: "m" }), selected)).toBe(false);
    expect(selected.armInk).not.toHaveBeenCalled();
  });

  it("lists the ink keys on the shortcut sheet", () => {
    const keys = BOARD_SHORTCUTS.flatMap((s) => s.keys);
    expect(keys).toEqual(expect.arrayContaining(["M", "Shift+M", "Shift+E"]));
  });
});

describe("ink state", () => {
  beforeEach(() => window.localStorage.clear());

  it("strokes: opaque round marker, translucent wide highlighter", () => {
    expect(inkStroke(DEFAULT_INK_STATE)).toEqual({
      color: { kind: "srgb", value: "#1E1E1E" },
      width: INK_WIDTHS.marker.medium,
      cap: "round",
    });
    const hl = inkStroke({ ...DEFAULT_INK_STATE, pen: "highlighter" });
    expect(hl.color).toEqual({ kind: "srgb", value: "#FFC53D", alpha: HIGHLIGHTER_ALPHA });
    expect(hl.width).toBeGreaterThan(INK_WIDTHS.marker.thick);
  });

  it("parses stored state field by field and survives garbage", () => {
    expect(parseInkState(null)).toEqual(DEFAULT_INK_STATE);
    expect(parseInkState("{not json")).toEqual(DEFAULT_INK_STATE);
    const parsed = parseInkState(
      JSON.stringify({ pen: "highlighter", marker: { color: "#0090FF", width: "huge" } }),
    );
    expect(parsed.pen).toBe("highlighter");
    expect(parsed.marker).toEqual({ color: "#0090FF", width: "medium" });
    expect(parsed.highlighter).toEqual(DEFAULT_INK_STATE.highlighter);
  });

  it("remembers the last choice across tools (localStorage)", () => {
    const a = createInkTool();
    a.setStyle("marker", { color: "#E5484D", width: "thick" });
    a.setPen("highlighter");
    const b = createInkTool();
    expect(b.get().pen).toBe("highlighter");
    expect(b.get().marker).toEqual({ color: "#E5484D", width: "thick" });
  });

  it("armInkPen picks the pen and arms freehand", () => {
    const ink = createInkTool(DEFAULT_INK_STATE);
    const editor = { setInsertMode: vi.fn() };
    armInkPen(editor, ink, "highlighter");
    expect(ink.get().pen).toBe("highlighter");
    expect(editor.setInsertMode).toHaveBeenCalledWith("freeform");
    expect(isInkArmed("freeform")).toBe(true);
    expect(isInkArmed("eraser")).toBe(true);
    expect(isInkArmed("rect")).toBe(false);
  });
});

describe("BoardInkControls", () => {
  function setup(mode: InsertKind | null = null) {
    const editor = { setInsertMode: vi.fn() } as unknown as SlidesEditor & {
      setInsertMode: ReturnType<typeof vi.fn>;
    };
    const ink = createInkTool(DEFAULT_INK_STATE);
    const view = render(
      <TooltipProvider>
        <BoardInkControls editor={editor} ink={ink} insertMode={mode} />
      </TooltipProvider>,
    );
    return { editor, ink, view };
  }

  it("arms the marker and the eraser from their toggles", async () => {
    const { editor } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Marker" }));
    expect(editor.setInsertMode).toHaveBeenCalledWith("freeform");
    await userEvent.click(screen.getByRole("button", { name: "Eraser" }));
    expect(editor.setInsertMode).toHaveBeenCalledWith("eraser");
  });

  it("chooses colour and width before drawing, and arms that pen", async () => {
    const { editor, ink } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Pen, colour and width" }));
    await userEvent.click(screen.getByRole("button", { name: "Blue" }));
    expect(ink.get().marker.color).toBe("#0090FF");
    await userEvent.click(screen.getByRole("button", { name: "Thick" }));
    expect(ink.get().marker.width).toBe("thick");
    expect(editor.setInsertMode).toHaveBeenCalledWith("freeform");
  });

  it("shows the highlighter once it is the pen", () => {
    const { ink } = setup("freeform");
    act(() => ink.setPen("highlighter"));
    expect(screen.getByRole("button", { name: "Highlighter" }).getAttribute("aria-pressed")).toBe("true");
  });
});
