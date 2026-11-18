import { describe, it, expect, vi } from "vitest";
import {
  boardToolForKey,
  handleBoardToolKey,
  isTextEntryTarget,
  BOARD_SHORTCUTS,
  BOARD_SHORTCUT_CATEGORIES,
  zoomChordForKey,
} from "./board-shortcuts";

const key = (k: string, mods: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods,
});

describe("boardToolForKey", () => {
  it("maps FigJam's single-key tools", () => {
    expect(boardToolForKey(key("v"))).toEqual({ kind: "select" });
    expect(boardToolForKey(key("h"))).toEqual({ kind: "hand" });
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

  it("makes Shift+S the section tool, and plain S still the sticky", () => {
    expect(boardToolForKey(key("S", { shiftKey: true }))).toEqual({ kind: "section" });
    expect(boardToolForKey(key("s"))).toEqual({ kind: "sticky" });
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
  function setup(opts: { selection?: string[]; textEditing?: boolean; cropping?: boolean; readOnly?: boolean } = {}) {
    const editor = {
      isTextEditing: vi.fn(() => opts.textEditing ?? false),
      isCropping: vi.fn(() => opts.cropping ?? false),
      getSelection: vi.fn(() => opts.selection ?? []),
      setInsertMode: vi.fn(),
    };
    const outside = document.createElement("button");
    const ctx = {
      editor,
      readOnly: opts.readOnly ?? false,
      fit: vi.fn(),
      zoomStep: vi.fn(),
      zoomTo: vi.fn(),
      fitSelection: vi.fn(),
      setHand: vi.fn(),
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

  it("arms the section tool on Shift+S and drops it for any other tool or Esc", () => {
    const setSection = vi.fn();
    const ctx = { ...setup(), setSection };
    expect(handleBoardToolKey(press("S", { shiftKey: true }), ctx)).toBe(true);
    expect(setSection).toHaveBeenLastCalledWith(true);
    expect(ctx.editor.setInsertMode).toHaveBeenLastCalledWith(null);
    expect(handleBoardToolKey(press("r"), ctx)).toBe(true);
    expect(setSection).toHaveBeenLastCalledWith(false);
    setSection.mockClear();
    handleBoardToolKey(press("Escape"), ctx);
    expect(setSection).toHaveBeenCalledWith(false);
  });

  it("arms the laser on Shift+K; V, another tool or Esc drops laser and lasso", () => {
    const setLaser = vi.fn();
    const setLasso = vi.fn();
    const ctx = { ...setup(), setLaser, setLasso };
    expect(handleBoardToolKey(press("K", { shiftKey: true }), ctx)).toBe(true);
    expect(setLaser).toHaveBeenLastCalledWith(true);
    expect(ctx.editor.setInsertMode).not.toHaveBeenCalled();
    // Plain k is not a tool.
    expect(handleBoardToolKey(press("k"), ctx)).toBe(false);
    expect(handleBoardToolKey(press("v"), ctx)).toBe(true);
    expect(setLaser).toHaveBeenLastCalledWith(false);
    expect(setLasso).toHaveBeenLastCalledWith(false);
    setLasso.mockClear();
    handleBoardToolKey(press("Escape"), ctx);
    expect(setLasso).toHaveBeenCalledWith(false);
    // With a selection Shift+K stays type-to-edit.
    const busy = { ...setup({ selection: ["a"] }), setLaser };
    setLaser.mockClear();
    expect(handleBoardToolKey(press("K", { shiftKey: true }), busy)).toBe(false);
    expect(setLaser).not.toHaveBeenCalled();
  });

  it("leaves Shift+S to type-to-edit while something is selected", () => {
    const setSection = vi.fn();
    const ctx = { ...setup({ selection: ["sticky-1"] }), setSection };
    expect(handleBoardToolKey(press("S", { shiftKey: true }), ctx)).toBe(false);
    expect(setSection).not.toHaveBeenCalled();
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

  it("arms the hand tool on H and drops it on any other tool", () => {
    const ctx = setup();
    expect(handleBoardToolKey(press("h"), ctx)).toBe(true);
    expect(ctx.setHand).toHaveBeenLastCalledWith(true);
    expect(handleBoardToolKey(press("t"), ctx)).toBe(true);
    expect(ctx.setHand).toHaveBeenLastCalledWith(false);
  });

  it("disarms the hand on Esc without consuming it", () => {
    const ctx = setup({ selection: ["a"] });
    const e = press("Escape");
    expect(handleBoardToolKey(e, ctx)).toBe(false);
    expect(ctx.setHand).toHaveBeenCalledWith(false);
    expect(e.defaultPrevented).toBe(false);
  });

  it("gives a viewer no tools", () => {
    const ctx = setup({ readOnly: true });
    expect(handleBoardToolKey(press("h"), ctx)).toBe(false);
    expect(handleBoardToolKey(press("t"), ctx)).toBe(false);
  });

  it("steps the zoom on Mod+= / Mod+-, repeat included, and blocks page zoom", () => {
    const ctx = setup({ selection: ["a"] });
    const zin = press("=", { code: "Equal", metaKey: true });
    expect(handleBoardToolKey(zin, ctx)).toBe(true);
    expect(zin.defaultPrevented).toBe(true);
    expect(ctx.zoomStep).toHaveBeenLastCalledWith(1);
    expect(handleBoardToolKey(press("-", { code: "Minus", ctrlKey: true, repeat: true }), ctx)).toBe(true);
    expect(ctx.zoomStep).toHaveBeenLastCalledWith(-1);
  });

  it("keeps a consumed view key from reaching type-to-edit", () => {
    const ctx = setup({ selection: ["sticky-1"] });
    const e = press("@", { code: "Digit2", shiftKey: true, bubbles: true });
    const later = vi.fn();
    document.body.addEventListener("keydown", later);
    document.body.addEventListener("keydown", (ev) => handleBoardToolKey(ev, ctx), { capture: true, once: true });
    document.body.dispatchEvent(e);
    document.body.removeEventListener("keydown", later);
    expect(ctx.fitSelection).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
  });

  it("zooms to 100% on Mod+0 and to the selection on Shift+2", () => {
    const ctx = setup({ readOnly: true });
    expect(handleBoardToolKey(press("0", { code: "Digit0", metaKey: true }), ctx)).toBe(true);
    expect(ctx.zoomTo).toHaveBeenCalledWith(1);
    expect(handleBoardToolKey(press("@", { code: "Digit2", shiftKey: true }), ctx)).toBe(true);
    expect(ctx.fitSelection).toHaveBeenCalledTimes(1);
  });

  it("lets every other Mod chord through untouched", () => {
    const ctx = setup({ selection: ["a"] });
    for (const [k, code] of [["a", "KeyA"], ["z", "KeyZ"], ["s", "KeyS"], ["c", "KeyC"], ["/", "Slash"]]) {
      const e = press(k, { code, metaKey: true, bubbles: true });
      const stop = vi.spyOn(e, "stopPropagation");
      expect(handleBoardToolKey(e, ctx)).toBe(false);
      expect(e.defaultPrevented).toBe(false);
      expect(stop).not.toHaveBeenCalled();
    }
    expect(ctx.zoomStep).not.toHaveBeenCalled();
    expect(ctx.zoomTo).not.toHaveBeenCalled();
  });

  it("leaves zoom chords to a text edit", () => {
    const ctx = setup({ textEditing: true });
    expect(handleBoardToolKey(press("=", { code: "Equal", metaKey: true }), ctx)).toBe(false);
    expect(ctx.zoomStep).not.toHaveBeenCalled();
  });

  it("stands down during an image crop", () => {
    const ctx = setup({ cropping: true, selection: ["img"] });
    expect(handleBoardToolKey(press("=", { code: "Equal", metaKey: true }), ctx)).toBe(false);
    expect(handleBoardToolKey(press("@", { code: "Digit2", shiftKey: true }), ctx)).toBe(false);
    expect(ctx.fitSelection).not.toHaveBeenCalled();
  });
});

describe("zoomChordForKey", () => {
  const chord = (k: string, code: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
    zoomChordForKey({ key: k, code, metaKey: false, ctrlKey: false, altKey: false, ...mods });

  it("needs Mod and no Alt", () => {
    expect(chord("=", "Equal")).toBeNull();
    expect(chord("=", "Equal", { metaKey: true, altKey: true })).toBeNull();
  });

  it("matches shifted and numpad variants", () => {
    expect(chord("+", "Equal", { ctrlKey: true })).toBe("in");
    expect(chord("+", "NumpadAdd", { ctrlKey: true })).toBe("in");
    expect(chord("_", "Minus", { metaKey: true })).toBe("out");
    expect(chord("0", "Numpad0", { metaKey: true })).toBe("reset");
  });
});
