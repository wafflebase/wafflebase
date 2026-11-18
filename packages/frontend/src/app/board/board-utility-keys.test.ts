import { describe, expect, it, vi } from "vitest";
import {
  handleBoardUtilityKey,
  isFindChord,
  isTidyUpChord,
  type BoardUtilityKeyContext,
} from "./board-utility-keys";

function ctx(over: Partial<BoardUtilityKeyContext> = {}, selection: string[] = []) {
  const editor = {
    isTextEditing: vi.fn(() => false),
    exitTextEditing: vi.fn(),
    getSelection: () => selection,
  };
  return {
    editor,
    readOnly: false,
    isBoardTarget: () => true,
    openFind: vi.fn(),
    tidyUp: vi.fn(),
    ...over,
  } satisfies BoardUtilityKeyContext;
}

const key = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, "target", { value: target });
  return e;
};

describe("chords", () => {
  it("matches Mod+F by key or code, and nothing else", () => {
    expect(isFindChord(key({ key: "f", metaKey: true }))).toBe(true);
    expect(isFindChord(key({ key: "а", code: "KeyF", ctrlKey: true }))).toBe(true);
    expect(isFindChord(key({ key: "f" }))).toBe(false);
    expect(isFindChord(key({ key: "F", metaKey: true, shiftKey: true }))).toBe(false);
  });

  it("matches Alt+Shift+T by code (Option turns the key into a symbol)", () => {
    expect(isTidyUpChord(key({ key: "ˇ", code: "KeyT", altKey: true, shiftKey: true }))).toBe(true);
    expect(isTidyUpChord(key({ key: "T", code: "KeyT", shiftKey: true }))).toBe(false);
    expect(
      isTidyUpChord(key({ key: "t", code: "KeyT", altKey: true, shiftKey: true, metaKey: true })),
    ).toBe(false);
  });
});

describe("handleBoardUtilityKey", () => {
  it("opens find and claims Mod+F, read-only too", () => {
    const c = ctx({ readOnly: true });
    const e = key({ key: "f", metaKey: true });
    const stop = vi.spyOn(e, "stopPropagation");
    expect(handleBoardUtilityKey(e, c)).toBe(true);
    expect(c.openFind).toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalled();
  });

  it("ends a sticky edit before opening find", () => {
    const isTextEditing = vi.fn(() => true);
    const c = ctx({
      editor: { isTextEditing, exitTextEditing: vi.fn(), getSelection: () => [] },
    });
    handleBoardUtilityKey(key({ key: "f", ctrlKey: true }), c);
    expect(c.editor.exitTextEditing).toHaveBeenCalled();
    expect(c.openFind).toHaveBeenCalled();
  });

  it("leaves Mod+F to the browser outside the board", () => {
    const c = ctx({ isBoardTarget: () => false });
    const e = key({ key: "f", metaKey: true });
    expect(handleBoardUtilityKey(e, c)).toBe(false);
    expect(e.defaultPrevented).toBe(false);
  });

  it("tidies a multi-selection on Alt+Shift+T", () => {
    const c = ctx({}, ["a", "b"]);
    expect(
      handleBoardUtilityKey(key({ key: "ˇ", code: "KeyT", altKey: true, shiftKey: true }), c),
    ).toBe(true);
    expect(c.tidyUp).toHaveBeenCalled();
  });

  it("does not tidy one element, a read-only board, or from a text field", () => {
    const chord = () => key({ key: "ˇ", code: "KeyT", altKey: true, shiftKey: true });
    const one = ctx({}, ["a"]);
    expect(handleBoardUtilityKey(chord(), one)).toBe(false);
    const ro = ctx({ readOnly: true }, ["a", "b"]);
    expect(handleBoardUtilityKey(chord(), ro)).toBe(false);
    const field = ctx({}, ["a", "b"]);
    const input = document.createElement("input");
    expect(
      handleBoardUtilityKey(
        key({ key: "ˇ", code: "KeyT", altKey: true, shiftKey: true }, input),
        field,
      ),
    ).toBe(false);
    expect(one.tidyUp).not.toHaveBeenCalled();
    expect(ro.tidyUp).not.toHaveBeenCalled();
    expect(field.tidyUp).not.toHaveBeenCalled();
  });
});
