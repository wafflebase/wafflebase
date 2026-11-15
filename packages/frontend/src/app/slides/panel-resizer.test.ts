// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachPanelResizer } from "./panel-resizer";

/**
 * jsdom has no `PointerEvent` constructor, so a `MouseEvent` carrying a
 * pointer event's *type* stands in: listeners dispatch on the type, and the
 * fields the resizer reads (`button`, `clientX/Y`) exist on both.
 */
function pointer(
  target: EventTarget,
  type: string,
  init: MouseEventInit = {},
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function setup() {
  const handle = document.createElement("div");
  document.body.appendChild(handle);
  const calls = {
    onStart: vi.fn(),
    onMove: vi.fn(),
    onEnd: vi.fn(),
  };
  const dispose = attachPanelResizer(handle, {
    cursor: "col-resize",
    ...calls,
  });
  return { handle, dispose, ...calls };
}

describe("attachPanelResizer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("claims touch gestures on the handle", () => {
    const { handle } = setup();
    expect(handle.style.touchAction).toBe("none");
  });

  it("runs a drag from pointerdown through document moves to pointerup", () => {
    const { handle, onStart, onMove, onEnd } = setup();

    const down = pointer(handle, "pointerdown", { button: 0, clientX: 10 });
    expect(down.defaultPrevented).toBe(true);
    expect(onStart).toHaveBeenCalledOnce();
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    // The pointer has left the 6px handle: moves arrive on the document.
    pointer(document, "pointermove", { clientX: 40 });
    expect(onMove).toHaveBeenCalledOnce();
    expect((onMove.mock.calls[0][0] as MouseEvent).clientX).toBe(40);

    pointer(document, "pointerup");
    expect(onEnd).toHaveBeenCalledOnce();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    // A move after release is not part of the drag.
    pointer(document, "pointermove", { clientX: 80 });
    expect(onMove).toHaveBeenCalledOnce();
  });

  it("does not move focus when a drag starts", () => {
    const { handle } = setup();
    const mousedown = pointer(handle, "mousedown", { button: 0 });
    expect(mousedown.defaultPrevented).toBe(true);
  });

  it("ends the drag when the browser cancels the pointer", () => {
    const { handle, onEnd } = setup();
    pointer(handle, "pointerdown", { button: 0 });
    pointer(document, "pointercancel");
    expect(onEnd).toHaveBeenCalledOnce();
    expect(document.body.style.cursor).toBe("");
  });

  it("ignores moves that are not part of a drag and non-primary buttons", () => {
    const { handle, onStart, onMove } = setup();
    pointer(document, "pointermove", { clientX: 5 });
    pointer(handle, "pointerdown", { button: 2 });
    pointer(document, "pointermove", { clientX: 5 });
    expect(onStart).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("disposing mid-drag ends the drag and detaches the handle", () => {
    const { handle, dispose, onStart, onEnd } = setup();
    pointer(handle, "pointerdown", { button: 0 });
    dispose();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(document.body.style.userSelect).toBe("");

    pointer(handle, "pointerdown", { button: 0 });
    expect(onStart).toHaveBeenCalledOnce();
  });
});
