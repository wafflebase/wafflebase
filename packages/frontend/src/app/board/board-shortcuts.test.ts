import { describe, it, expect } from "vitest";
import { boardToolForKey, isTextEntryTarget, BOARD_SHORTCUTS, BOARD_SHORTCUT_CATEGORIES } from "./board-shortcuts";

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
