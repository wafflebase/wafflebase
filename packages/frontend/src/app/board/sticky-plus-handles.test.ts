import { describe, it, expect, vi, afterEach } from "vitest";
import type { Element } from "@wafflebase/slides";
import { createStickyPlusHandles, plusHandleCenters, PLUS_HANDLE_OFFSET } from "./sticky-plus-handles";

describe("plusHandleCenters", () => {
  it("puts one handle off the middle of each side, in screen px", () => {
    const frame = { x: 10, y: 20, w: 100, h: 50, rotation: 0 };
    const c = plusHandleCenters(frame, { panX: 5, panY: 0, zoom: 2 });
    // Screen box: x 25..225, y 40..140.
    expect(c.right).toEqual({ x: 225 + PLUS_HANDLE_OFFSET, y: 90 });
    expect(c.left).toEqual({ x: 25 - PLUS_HANDLE_OFFSET, y: 90 });
    expect(c.down).toEqual({ x: 125, y: 140 + PLUS_HANDLE_OFFSET });
    expect(c.up).toEqual({ x: 125, y: 40 - PLUS_HANDLE_OFFSET });
  });
});

describe("createStickyPlusHandles", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function mount(opts: { selection?: string[]; editing?: boolean; sticky?: boolean } = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const listeners: (() => void)[] = [];
    const state = {
      selection: opts.selection ?? ["s1"],
      editing: opts.editing ?? false,
    };
    const el = {
      id: "s1",
      type: "shape",
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { kind: "roundRect" },
    } as unknown as Element;
    const onAdd = vi.fn();
    const handles = createStickyPlusHandles({
      container,
      editor: {
        getSelection: () => state.selection,
        isTextEditing: () => state.editing,
        onSelectionChange: (cb) => {
          listeners.push(cb);
          return () => {};
        },
        onTextEditingChange: () => () => {},
      },
      getViewport: () => ({ panX: 0, panY: 0, zoom: 1 }),
      readElement: (id) => (id === "s1" ? el : undefined),
      isSticky: () => opts.sticky ?? true,
      onAdd,
    });
    const fire = () => listeners.forEach((cb) => cb());
    return { container, handles, onAdd, state, fire };
  }

  const shown = (layer: HTMLElement) => layer.style.display !== "none";

  it("shows four handles round one selected sticky; a click adds on that side", () => {
    const { handles, onAdd } = mount();
    expect(shown(handles.element)).toBe(true);
    const buttons = handles.element.querySelectorAll("button");
    expect(buttons).toHaveLength(4);
    const below = handles.element.querySelector<HTMLButtonElement>('[data-direction="down"]')!;
    expect(below.getAttribute("aria-label")).toBe("Add sticky note below");
    below.click();
    expect(onAdd).toHaveBeenCalledWith("s1", "down");
  });

  it("keeps a press on a handle from reaching the board", () => {
    const { container, handles } = mount();
    const boardPress = vi.fn();
    container.addEventListener("pointerdown", boardPress);
    handles.element
      .querySelector("button")!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(boardPress).not.toHaveBeenCalled();
    expect(shown(handles.element)).toBe(true);
  });

  it("hides for a non-sticky, a multi-selection, or while typing", () => {
    expect(shown(mount({ sticky: false }).handles.element)).toBe(false);
    document.body.innerHTML = "";
    expect(shown(mount({ selection: ["s1", "s2"] }).handles.element)).toBe(false);
    document.body.innerHTML = "";
    expect(shown(mount({ editing: true }).handles.element)).toBe(false);
  });

  it("follows the selection, and hides while a press on the board is down", () => {
    const { container, handles, state, fire } = mount({ selection: [] });
    expect(shown(handles.element)).toBe(false);
    state.selection = ["s1"];
    fire();
    expect(shown(handles.element)).toBe(true);
    container.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(shown(handles.element)).toBe(false);
    document.dispatchEvent(new PointerEvent("pointerup"));
    expect(shown(handles.element)).toBe(true);
  });

  it("removes its layer on dispose", () => {
    const { container, handles } = mount();
    handles.dispose();
    expect(container.querySelector("[data-sticky-plus-handles]")).toBeNull();
  });
});
