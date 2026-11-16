import { describe, it, expect, vi } from "vitest";
import {
  boardToolForKey,
  handleBoardToolKey,
  isTextEntryTarget,
  BOARD_SHORTCUTS,
  BOARD_SHORTCUT_CATEGORIES,
} from "./board-shortcuts";

const key = (k: string, mods: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods,
});

describe("boardToolForKey", () => {
  it("maps FigJam's single-key tools", () => {
    expect(boardToolForKey(key("v"))).toEqual({ kind: "select" });
    expect(boardToolForKey(key("t"))).toEqual({ kind: "insert", insert: "text" });
    expect(boardToolForKey(key("s"))).toEqual({ kind: "sticky" });
    expect(boardToolForKey(key("r"))).toEqual({ kind: "insert", insert: "rect" });
    expect(boardToolForKey(key("o"))).toEqual({ kind: "insert", insert: "ellipse" });
    expect(boardToolForKey(key("l"))).toEqual({ kind: "insert", insert: "connector:line" });
    expect(boardToolForKey(key("x"))).toEqual({ kind: "insert", insert: "connector:elbow" });
  });

  it("is case-insensitive without Shift (Caps Lock)", () => {
    expect(boardToolForKey(key("T"))).toEqual({ kind: "insert", insert: "text" });
  });

  it("makes Shift+L the arrow and no other shifted key a tool", () => {
    expect(boardToolForKey(key("L", { shiftKey: true }))).toEqual({ kind: "insert", insert: "connector:arrow" });
    expect(boardToolForKey(key("T", { shiftKey: true }))).toBeNull();
  });

  it("leaves Mod / Ctrl / Alt combos to their own shortcuts", () => {
    expect(boardToolForKey(key("s", { metaKey: true }))).toBeNull();
    expect(boardToolForKey(key("v", { ctrlKey: true }))).toBeNull();
    expect(boardToolForKey(key("t", { altKey: true }))).toBeNull();
  });

  it("ignores everything else", () => {
    expect(boardToolForKey(key("q"))).toBeNull();
    expect(boardToolForKey(key("Enter"))).toBeNull();
  });
});

describe("isTextEntryTarget", () => {
  it("claims text fields and editable regions", () => {
    expect(isTextEntryTarget(document.createElement("input"))).toBe(true);
    expect(isTextEntryTarget(document.createElement("textarea"))).toBe(true);
    // jsdom does not implement `isContentEditable`; stub what a browser reports.
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isTextEntryTarget(div)).toBe(true);
  });

  it("does not claim a focused toolbar button", () => {
    expect(isTextEntryTarget(document.createElement("button"))).toBe(false);
  });

  it("claims anything inside an open menu or dialog", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    menu.appendChild(item);
    expect(isTextEntryTarget(item)).toBe(true);
  });

  it("claims anything inside a dialog, a confirm included", () => {
    for (const role of ["dialog", "alertdialog"]) {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", role);
      const button = document.createElement("button");
      dialog.appendChild(button);
      expect(isTextEntryTarget(button)).toBe(true);
    }
  });

  it("is false for no target", () => {
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe("BOARD_SHORTCUTS", () => {
  it("files every entry under a category the sheet renders", () => {
    for (const entry of BOARD_SHORTCUTS) {
      expect(BOARD_SHORTCUT_CATEGORIES).toContain(entry.category);
    }
  });
});

describe("handleBoardToolKey", () => {
  function setup(opts: { selection?: string[]; textEditing?: boolean; readOnly?: boolean } = {}) {
    const editor = {
      isTextEditing: vi.fn(() => opts.textEditing ?? false),
      getSelection: vi.fn(() => opts.selection ?? []),
      setInsertMode: vi.fn(),
    };
    const outside = document.createElement("button");
    const ctx = {
      editor,
      readOnly: opts.readOnly ?? false,
      fit: vi.fn(),
      dropSticky: vi.fn(),
      isBoardTarget: (t: EventTarget | null) => t !== outside,
      outside,
    };
    return ctx;
  }
  const press = (key: string, init: KeyboardEventInit = {}, target?: EventTarget) => {
    const e = new KeyboardEvent("keydown", { key, cancelable: true, ...init });
    if (target) Object.defineProperty(e, "target", { value: target });
    return e;
  };

  it("arms tools and drops a sticky on an idle board", () => {
    const ctx = setup();
    expect(handleBoardToolKey(press("t"), ctx)).toBe(true);
    expect(ctx.editor.setInsertMode).toHaveBeenCalledWith("text");
    expect(handleBoardToolKey(press("v"), ctx)).toBe(true);
    expect(ctx.editor.setInsertMode).toHaveBeenCalledWith(null);
    const s = press("s");
    expect(handleBoardToolKey(s, ctx)).toBe(true);
    expect(ctx.dropSticky).toHaveBeenCalledTimes(1);
    expect(s.defaultPrevented).toBe(true);
  });

  it("leaves letters to type-to-edit while something is selected", () => {
    const ctx = setup({ selection: ["sticky-1"] });
    const e = press("t");
    expect(handleBoardToolKey(e, ctx)).toBe(false);
    expect(ctx.editor.setInsertMode).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("stands down during a text edit, in a field, and in a dialog", () => {
    expect(handleBoardToolKey(press("s"), setup({ textEditing: true }))).toBe(false);
    const ctx = setup();
    expect(handleBoardToolKey(press("s", {}, document.createElement("input")), ctx)).toBe(false);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    const button = document.createElement("button");
    dialog.appendChild(button);
    expect(handleBoardToolKey(press("s", {}, button), ctx)).toBe(false);
    expect(ctx.dropSticky).not.toHaveBeenCalled();
  });

  it("works with a toolbar button focused", () => {
    const ctx = setup();
    expect(handleBoardToolKey(press("s", {}, document.createElement("button")), ctx)).toBe(true);
    expect(ctx.dropSticky).toHaveBeenCalledTimes(1);
  });

  it("ignores keystrokes aimed at chrome outside the board", () => {
    const ctx = setup();
    expect(handleBoardToolKey(press("s", {}, ctx.outside), ctx)).toBe(false);
    expect(handleBoardToolKey(press("!", { code: "Digit1", shiftKey: true }, ctx.outside), ctx)).toBe(false);
    expect(ctx.dropSticky).not.toHaveBeenCalled();
    expect(ctx.fit).not.toHaveBeenCalled();
  });

  it("ignores auto-repeat and keys someone else already handled", () => {
    const ctx = setup();
    expect(handleBoardToolKey(press("s", { repeat: true }), ctx)).toBe(false);
    const taken = press("s");
    taken.preventDefault();
    expect(handleBoardToolKey(taken, ctx)).toBe(false);
    expect(ctx.dropSticky).not.toHaveBeenCalled();
  });

  it("refuses tools read-only but still fits on Shift+1, even with a selection", () => {
    const ctx = setup({ readOnly: true, selection: ["a"] });
    expect(handleBoardToolKey(press("s"), ctx)).toBe(false);
    expect(handleBoardToolKey(press("!", { code: "Digit1", shiftKey: true }), ctx)).toBe(true);
    expect(ctx.fit).toHaveBeenCalledTimes(1);
  });
});
