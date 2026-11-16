import { describe, expect, it, vi } from "vitest";
import { createHandTool, panCursor } from "./board-hand";

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
