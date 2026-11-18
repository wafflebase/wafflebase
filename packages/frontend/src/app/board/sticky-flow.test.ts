import { describe, it, expect, vi, afterEach } from "vitest";
import type { Element, Frame, SlidesEditor } from "@wafflebase/slides";
import { SYNTHETIC_SLIDE_ID } from "@wafflebase/board";
import { YorkieBoardStore } from "./yorkie-board-store";
import { makeYorkieBoardDoc, makeShapeInit } from "./__testkit__";
import { STICKY_GAP, buildStickyInit, isStickyElement } from "./sticky";
import { createSection } from "./board-sections";
import {
  addAdjacentSticky,
  handleStickyFlowKey,
  pasteTextAsStickies,
  type StickyFlowContext,
  type StickyFlowKeyContext,
} from "./sticky-flow";

const VISIBLE = { x: -1000, y: -1000, w: 2000, h: 2000, rotation: 0 };

function setup() {
  const store = new YorkieBoardStore(makeYorkieBoardDoc());
  const editor = {
    setSelection: vi.fn(),
    enterTextEditing: vi.fn(),
  } as unknown as SlidesEditor;
  const reveal = vi.fn();
  const ctx: StickyFlowContext = {
    store,
    editor,
    readElements: () => store.read().slides[0].elements,
    visible: () => VISIBLE,
    reveal,
    author: () => "Ada",
  };
  return { store, editor, ctx, reveal };
}

const els = (store: YorkieBoardStore): Element[] => store.read().slides[0].elements;

describe("addAdjacentSticky", () => {
  it("adds a same-colour, same-size sticky to the right, then selects and edits it", () => {
    const { store, editor, ctx } = setup();
    let src = "";
    store.batch(() => {
      src = store.addElement(
        SYNTHETIC_SLIDE_ID,
        buildStickyInit("#C7E5FF", { x: 0, y: 0 }, { size: { w: 120, h: 120 }, fontSize: 32 }),
      );
    });
    const id = addAdjacentSticky(ctx, src, "right")!;
    const added = els(store).find((e) => e.id === id)!;
    expect(added.frame).toMatchObject({ x: 60 + STICKY_GAP, y: -60, w: 120, h: 120 });
    expect(added.type === "shape" && added.data.fill).toEqual({ kind: "srgb", value: "#C7E5FF" });
    expect(added.type === "shape" && added.data.text?.blocks[0].inlines[0].style.fontSize).toBe(32);
    expect((added as unknown as { data: { author?: string } }).data.author).toBe("Ada");
    expect(isStickyElement(added)).toBe(true);
    expect(editor.setSelection).toHaveBeenCalledWith([id]);
    expect(editor.enterTextEditing).toHaveBeenCalledWith(id);
  });

  it("is one undo unit", () => {
    const { store, ctx } = setup();
    let src = "";
    store.batch(() => {
      src = store.addElement(SYNTHETIC_SLIDE_ID, buildStickyInit("#FFF8B8", { x: 0, y: 0 }));
    });
    addAdjacentSticky(ctx, src, "down");
    expect(els(store)).toHaveLength(2);
    store.undo();
    expect(els(store)).toHaveLength(1);
  });

  it("does nothing for a non-sticky source", () => {
    const { store, ctx } = setup();
    let src = "";
    store.batch(() => {
      src = store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
    });
    expect(addAdjacentSticky(ctx, src, "right")).toBeNull();
    expect(els(store)).toHaveLength(1);
  });

  it("reveals a sticky that has to land off a full screen", () => {
    const { store, ctx, reveal } = setup();
    // The screen shows the source sticky and nothing more.
    ctx.visible = () => ({ x: 800, y: -100, w: 200, h: 200, rotation: 0 });
    let src = "";
    store.batch(() => {
      src = store.addElement(SYNTHETIC_SLIDE_ID, buildStickyInit("#FFF8B8", { x: 900, y: 0 }));
    });
    addAdjacentSticky(ctx, src, "right");
    expect(reveal).toHaveBeenCalledTimes(1);
  });
});

describe("addAdjacentSticky inside a section", () => {
  it("steps off stickies, not off the section that contains them", () => {
    const { store, ctx } = setup();
    createSection(store, { x: -400, y: -400, w: 1200, h: 800 }, { title: "Ideas" });
    let src = "";
    store.batch(() => {
      src = store.addElement(SYNTHETIC_SLIDE_ID, buildStickyInit("#FFF8B8", { x: 0, y: 0 }));
    });
    const id = addAdjacentSticky(ctx, src, "right")!;
    const source = els(store).find((e) => e.id === src)!;
    const added = els(store).find((e) => e.id === id)!;
    // The neighbouring cell, still inside the section.
    expect(added.frame.x).toBe(source.frame.x + source.frame.w + STICKY_GAP);
    expect(added.frame.y).toBe(source.frame.y);
  });
});

describe("pasteTextAsStickies", () => {
  it("makes one selected sticky per line in a single batch", () => {
    const { store, editor, ctx } = setup();
    const { ids } = pasteTextAsStickies(ctx, "one\ntwo\nthree\nfour");
    expect(ids).toHaveLength(4);
    const texts = els(store).map((e) =>
      e.type === "shape" ? e.data.text?.blocks[0].inlines[0].text : undefined,
    );
    expect(texts).toEqual(["one", "two", "three", "four"]);
    expect(els(store).every(isStickyElement)).toBe(true);
    expect(editor.setSelection).toHaveBeenCalledWith(ids);
    expect(editor.enterTextEditing).not.toHaveBeenCalled();
    store.undo();
    expect(els(store)).toHaveLength(0);
  });

  it("places a single line on a free spot instead of on top of a sticky", () => {
    const { store, ctx } = setup();
    store.batch(() => {
      store.addElement(SYNTHETIC_SLIDE_ID, buildStickyInit("#FFF8B8", { x: 0, y: 0 }));
    });
    pasteTextAsStickies(ctx, "solo");
    const [first, second] = els(store);
    expect(second.frame.x).toBeGreaterThanOrEqual(first.frame.x + first.frame.w);
  });

  it("places a multi-line grid in free space, not over the stickies at the centre", () => {
    const { store, ctx } = setup();
    // A 2x2 block of stickies around the viewport centre (0, 0).
    store.batch(() => {
      for (const x of [-120, 120]) {
        for (const y of [-120, 120]) {
          store.addElement(SYNTHETIC_SLIDE_ID, buildStickyInit("#FFF8B8", { x, y }));
        }
      }
    });
    const before = els(store).map((e) => e.frame);
    const { ids } = pasteTextAsStickies(ctx, "one\ntwo\nthree\nfour");
    const pasted = els(store).filter((e) => ids.includes(e.id)).map((e) => e.frame);
    expect(pasted).toHaveLength(4);
    const hit = (a: Frame, b: Frame) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const p of pasted) {
      for (const b of before) expect(hit(p, b)).toBe(false);
    }
    // Still a 2x2 grid.
    expect(new Set(pasted.map((f) => f.x)).size).toBe(2);
    expect(new Set(pasted.map((f) => f.y)).size).toBe(2);
  });
});

describe("handleStickyFlowKey", () => {
  const key = (k: string, mods: Partial<KeyboardEventInit> = {}) =>
    new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods });

  function ctxWith(over: Partial<StickyFlowKeyContext["editor"]> = {}, sticky = true) {
    const addAdjacent = vi.fn();
    const exitTextEditing = vi.fn();
    const ctx: StickyFlowKeyContext = {
      editor: {
        getEditingElementId: () => null,
        getSelection: () => ["s1"],
        isCropping: () => false,
        exitTextEditing,
        ...over,
      },
      readOnly: false,
      isSticky: () => sticky,
      isBoardTarget: () => true,
      addAdjacent,
    };
    return { ctx, addAdjacent, exitTextEditing };
  }

  it("Mod+Enter on one selected sticky adds one to its right", () => {
    const { ctx, addAdjacent } = ctxWith();
    const e = key("Enter", { metaKey: true });
    expect(handleStickyFlowKey(e, ctx)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(addAdjacent).toHaveBeenCalledWith("s1", "right");
  });

  it("works with Ctrl too", () => {
    const { ctx, addAdjacent } = ctxWith();
    handleStickyFlowKey(key("Enter", { ctrlKey: true }), ctx);
    expect(addAdjacent).toHaveBeenCalled();
  });

  it("leaves Mod+Enter alone on a non-sticky, a multi-selection, or read-only", () => {
    expect(handleStickyFlowKey(key("Enter", { metaKey: true }), ctxWith({}, false).ctx)).toBe(false);
    expect(
      handleStickyFlowKey(key("Enter", { metaKey: true }), ctxWith({ getSelection: () => ["a", "b"] }).ctx),
    ).toBe(false);
    const ro = ctxWith();
    ro.ctx.readOnly = true;
    expect(handleStickyFlowKey(key("Enter", { metaKey: true }), ro.ctx)).toBe(false);
  });

  it("leaves plain Enter, Tab and Shift+Mod+Enter alone outside a text edit", () => {
    const { ctx, addAdjacent } = ctxWith();
    expect(handleStickyFlowKey(key("Enter"), ctx)).toBe(false);
    expect(handleStickyFlowKey(key("Tab"), ctx)).toBe(false);
    expect(handleStickyFlowKey(key("Enter", { metaKey: true, shiftKey: true }), ctx)).toBe(false);
    expect(addAdjacent).not.toHaveBeenCalled();
  });

  it("Tab or Mod+Enter while typing in a sticky commits it, then adds the next", () => {
    for (const e of [key("Tab"), key("Enter", { metaKey: true })]) {
      const { ctx, addAdjacent, exitTextEditing } = ctxWith({ getEditingElementId: () => "s1" });
      expect(handleStickyFlowKey(e, ctx)).toBe(true);
      expect(exitTextEditing).toHaveBeenCalledTimes(1);
      expect(addAdjacent).toHaveBeenCalledWith("s1", "right");
      expect(exitTextEditing.mock.invocationCallOrder[0]).toBeLessThan(
        addAdjacent.mock.invocationCallOrder[0],
      );
    }
  });

  it("leaves Tab to a text edit in anything but a sticky, and Shift+Tab always", () => {
    const shape = ctxWith({ getEditingElementId: () => "t1" }, false);
    expect(handleStickyFlowKey(key("Tab"), shape.ctx)).toBe(false);
    const sticky = ctxWith({ getEditingElementId: () => "s1" });
    expect(handleStickyFlowKey(key("Tab", { shiftKey: true }), sticky.ctx)).toBe(false);
  });

  it("never interrupts an IME composition", () => {
    const { ctx, addAdjacent } = ctxWith({ getEditingElementId: () => "s1" });
    expect(handleStickyFlowKey(key("Enter", { metaKey: true, isComposing: true }), ctx)).toBe(false);
    expect(addAdjacent).not.toHaveBeenCalled();
  });
});

describe("handleStickyFlowKey through real listeners", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // The board's handler runs in the capture phase; the editor's key rules
  // and the docs text editor's own listener run later and do not check
  // `defaultPrevented`. A consumed key must never reach them.
  it("stops a consumed key before the editor's bubble listener and the text box", () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const addAdjacent = vi.fn();
    const ctx: StickyFlowKeyContext = {
      editor: {
        getEditingElementId: () => "s1",
        getSelection: () => ["s1"],
        isCropping: () => false,
        exitTextEditing: vi.fn(),
      },
      readOnly: false,
      isSticky: () => true,
      isBoardTarget: () => true,
      addAdjacent,
    };
    const capture = (e: KeyboardEvent) => handleStickyFlowKey(e, ctx);
    const editorRule = vi.fn();
    const textBox = vi.fn();
    document.addEventListener("keydown", capture, true);
    document.addEventListener("keydown", editorRule);
    textarea.addEventListener("keydown", textBox);
    try {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
      expect(addAdjacent).toHaveBeenCalledTimes(1);
      expect(textBox).not.toHaveBeenCalled();
      expect(editorRule).not.toHaveBeenCalled();

      // A key it does not take still reaches both.
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      expect(textBox).toHaveBeenCalledTimes(1);
      expect(editorRule).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", capture, true);
      document.removeEventListener("keydown", editorRule);
    }
  });
});
