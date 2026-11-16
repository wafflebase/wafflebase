import { describe, expect, it, vi } from "vitest";
import { claimsPanDrag, createHandTool, panCursor } from "./board-hand";

describe("createHandTool", () => {
  it("notifies only on a real change", () => {
    const hand = createHandTool();
    const cb = vi.fn();
    hand.subscribe(cb);
    hand.set(false);
    expect(cb).not.toHaveBeenCalled();
    hand.set(true);
    expect(hand.get()).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("panCursor", () => {
  const idle = { panning: false, spaceDown: false, hand: false, readOnly: false };

  it("leaves the editor's cursor alone when no pan is possible", () => {
    expect(panCursor(idle)).toBeNull();
  });

  it("offers grab for Space, the hand tool and a viewer", () => {
    expect(panCursor({ ...idle, spaceDown: true })).toBe("grab");
    expect(panCursor({ ...idle, hand: true })).toBe("grab");
    expect(panCursor({ ...idle, readOnly: true })).toBe("grab");
  });

  it("shows grabbing mid-pan", () => {
    expect(panCursor({ ...idle, hand: true, panning: true })).toBe("grabbing");
  });
});

describe("claimsPanDrag", () => {
  const base = {
    button: 0,
    pointerType: "mouse",
    spaceDown: false,
    hand: false,
    readOnly: false,
    onScene: true,
  };

  it("leaves a plain left-drag to the editor", () => {
    expect(claimsPanDrag(base)).toBe(false);
  });

  it("pans on a left-drag with the hand armed or on a read-only board", () => {
    expect(claimsPanDrag({ ...base, hand: true })).toBe(true);
    expect(claimsPanDrag({ ...base, readOnly: true })).toBe(true);
  });

  it("leaves the minimap's drag alone under the hand and read-only", () => {
    expect(claimsPanDrag({ ...base, hand: true, onScene: false })).toBe(false);
    expect(claimsPanDrag({ ...base, readOnly: true, onScene: false })).toBe(false);
  });

  it("pans on Space-drag and middle-drag anywhere", () => {
    expect(claimsPanDrag({ ...base, spaceDown: true, onScene: false })).toBe(true);
    expect(claimsPanDrag({ ...base, button: 1, onScene: false })).toBe(true);
  });

  it("never claims touch or a right button", () => {
    expect(claimsPanDrag({ ...base, hand: true, pointerType: "touch" })).toBe(false);
    expect(claimsPanDrag({ ...base, hand: true, button: 2 })).toBe(false);
  });
});
