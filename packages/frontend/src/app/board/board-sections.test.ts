import { describe, it, expect, afterEach } from "vitest";
// jsdom has no 2D canvas; the slides package's own test shim gives the
// real editor a recording context so it can be driven end to end here.
import "../../../../slides/src/view/canvas/test-canvas-env";
import {
  initializeEditor,
  type Element,
  type SlidesEditor,
} from "@wafflebase/slides";
import {
  SECTION_COLORS,
  SECTION_PADDING,
  SYNTHETIC_SLIDE_ID,
  sectionOf,
  type Viewport,
} from "@wafflebase/board";
import { YorkieBoardStore } from "./yorkie-board-store";
import { makeYorkieBoardDoc } from "./__testkit__";
import {
  createBoardSections,
  createSection,
  deleteSectionAndContents,
  readElements,
  sectionFrameFromGesture,
  setSectionColor,
  updateSectionMeta,
  wrapInSection,
} from "./board-sections";

function makeStore(): YorkieBoardStore {
  return new YorkieBoardStore(makeYorkieBoardDoc());
}

function addSticky(store: YorkieBoardStore, x: number, y: number, w = 100, h = 100): string {
  let id = "";
  store.batch(() => {
    id = store.addElement(SYNTHETIC_SLIDE_ID, {
      type: "shape",
      frame: { x, y, w, h, rotation: 0 },
      data: { kind: "rect", fill: { kind: "srgb", value: "#FFF8B8" } },
    });
  });
  return id;
}

const byId = (store: YorkieBoardStore, id: string): Element | undefined =>
  readElements(store).find((e) => e.id === id);

describe("section store actions", () => {
  it("creates a section behind ordinary elements, in one undo step", () => {
    const store = makeStore();
    const a = addSticky(store, 10, 10);
    const id = createSection(store, { x: 0, y: 0, w: 500, h: 400 }, { title: "Ideas" });
    expect(readElements(store).map((e) => e.id)).toEqual([id, a]);
    expect(sectionOf(byId(store, id))).toEqual({ title: "Ideas" });
    store.undo();
    expect(readElements(store).map((e) => e.id)).toEqual([a]);
  });

  it("puts a smaller section in front of a larger one", () => {
    const store = makeStore();
    const big = createSection(store, { x: 0, y: 0, w: 1000, h: 1000 });
    const small = createSection(store, { x: 10, y: 10, w: 100, h: 100 });
    const bigger = createSection(store, { x: -10, y: -10, w: 2000, h: 2000 });
    expect(readElements(store).map((e) => e.id)).toEqual([bigger, big, small]);
  });

  it("wraps elements with padding", () => {
    const store = makeStore();
    const a = addSticky(store, 100, 100);
    const b = addSticky(store, 400, 300);
    const id = wrapInSection(store, [a, b])!;
    expect(byId(store, id)!.frame).toEqual({
      x: 100 - SECTION_PADDING,
      y: 100 - SECTION_PADDING,
      w: 400 + SECTION_PADDING * 2,
      h: 300 + SECTION_PADDING * 2,
      rotation: 0,
    });
    expect(wrapInSection(store, ["missing"])).toBeNull();
  });

  it("merges meta patches and drops a cleared flag", () => {
    const store = makeStore();
    const id = createSection(store, { x: 0, y: 0, w: 100, h: 100 }, { title: "T" });
    updateSectionMeta(store, id, { hidden: true, locked: true });
    expect(sectionOf(byId(store, id))).toEqual({ title: "T", hidden: true, locked: true });
    updateSectionMeta(store, id, { hidden: false });
    expect(sectionOf(byId(store, id))).toEqual({ title: "T", locked: true });
  });

  it("recolours a section", () => {
    const store = makeStore();
    const id = createSection(store, { x: 0, y: 0, w: 100, h: 100 });
    setSectionColor(store, [id], SECTION_COLORS[2]);
    const data = (byId(store, id) as { data: { fill: unknown } }).data;
    expect(data.fill).toEqual({ kind: "srgb", value: SECTION_COLORS[2].fill });
  });

  it("deletes a section and its contents only, in one batch", () => {
    const store = makeStore();
    const inside = addSticky(store, 10, 10);
    const outside = addSticky(store, 900, 900);
    const id = createSection(store, { x: 0, y: 0, w: 500, h: 500 });
    deleteSectionAndContents(store, id);
    expect(readElements(store).map((e) => e.id)).toEqual([outside]);
    store.undo();
    expect(readElements(store).map((e) => e.id).sort()).toEqual([id, inside, outside].sort());
  });
});

describe("sectionFrameFromGesture", () => {
  it("makes a default section on a click and the dragged rect otherwise", () => {
    const click = sectionFrameFromGesture({ x: 100, y: 100 }, { x: 101, y: 100 }, 1);
    expect(click.w).toBe(800);
    expect(click.x + click.w / 2).toBe(100);
    expect(sectionFrameFromGesture({ x: 300, y: 200 }, { x: 100, y: 50 }, 1)).toEqual({
      x: 100, y: 50, w: 200, h: 150,
    });
    // The slop is in screen px: 3 world px at 4x zoom is a drag.
    expect(sectionFrameFromGesture({ x: 0, y: 0 }, { x: 3, y: 3 }, 4).w).toBe(3);
  });
});

describe("sections in the editor", () => {
  let editor: SlidesEditor | null = null;
  afterEach(() => {
    editor?.detach();
    editor = null;
    document.body.innerHTML = "";
  });

  function mount(store: YorkieBoardStore) {
    const container = document.createElement("div");
    const canvas = document.createElement("canvas");
    const overlay = document.createElement("div");
    container.append(canvas, overlay);
    document.body.appendChild(container);
    const vp: Viewport = { panX: 0, panY: 0, zoom: 1 };
    const sections = createBoardSections({
      store,
      container,
      readOnly: false,
      getEditor: () => editor,
      getViewport: () => vp,
      fitElement: () => undefined,
      isSceneTarget: (t) => t === canvas,
    });
    editor = initializeEditor({
      ...sections.editorOptions,
      canvas,
      overlay,
      store,
      hostWidth: 1920,
      hostHeight: 1080,
      dpr: 1,
      viewport: vp,
      suppressSlideChrome: true,
    });
    return { canvas, overlay, container, sections, editor };
  }

  function drag(canvas: HTMLCanvasElement, from: [number, number], to: [number, number]) {
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: from[0], clientY: from[1], bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      clientX: to[0], clientY: to[1], bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      clientX: to[0], clientY: to[1], bubbles: true,
    }));
  }

  it("drags a section with its contents, in one undo step", () => {
    const store = makeStore();
    const inside = addSticky(store, 300, 300);
    const outside = addSticky(store, 1500, 900);
    const id = createSection(store, { x: 0, y: 0, w: 1000, h: 800 });
    const { canvas } = mount(store);
    // Grab the section's empty corner.
    drag(canvas, [50, 50], [157, 133]);
    const s = byId(store, id)!.frame;
    const m = byId(store, inside)!.frame;
    expect(s.x).not.toBe(0);
    expect(m.x - 300).toBe(s.x);
    expect(m.y - 300).toBe(s.y);
    expect(byId(store, outside)!.frame.x).toBe(1500);
    store.undo();
    expect(byId(store, id)!.frame.x).toBe(0);
    expect(byId(store, inside)!.frame.x).toBe(300);
  });

  it("deletes the section alone and keeps its contents", () => {
    const store = makeStore();
    const inside = addSticky(store, 300, 300);
    const id = createSection(store, { x: 0, y: 0, w: 1000, h: 800 });
    const { editor } = mount(store);
    editor.setSelection([id]);
    editor.deleteSelected();
    expect(readElements(store).map((e) => e.id)).toEqual([inside]);
  });

  it("lets a click pass through a locked section and its contents", () => {
    const store = makeStore();
    addSticky(store, 300, 300);
    const id = createSection(store, { x: 0, y: 0, w: 1000, h: 800 });
    updateSectionMeta(store, id, { locked: true });
    const { canvas, editor } = mount(store);
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 350, clientY: 350, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      clientX: 350, clientY: 350, bubbles: true,
    }));
    expect(editor.getSelection()).toEqual([]);
  });

  it("selects a hidden section, never its covered contents", () => {
    const store = makeStore();
    addSticky(store, 300, 300);
    const id = createSection(store, { x: 0, y: 0, w: 1000, h: 800 });
    updateSectionMeta(store, id, { hidden: true });
    const { canvas, editor } = mount(store);
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 350, clientY: 350, bubbles: true,
    }));
    expect(editor.getSelection()).toEqual([id]);
  });

  it("renames a section from a double-click instead of editing shape text", () => {
    const store = makeStore();
    const id = createSection(store, { x: 0, y: 0, w: 1000, h: 800 }, { title: "Old" });
    const { canvas, container, editor } = mount(store);
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 50, clientY: 50, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      clientX: 50, clientY: 50, bubbles: true,
    }));
    canvas.dispatchEvent(new MouseEvent("dblclick", { clientX: 50, clientY: 50, bubbles: true }));
    expect(editor.isTextEditing()).toBe(false);
    const input = container.querySelector<HTMLInputElement>("input[data-board-section-title]")!;
    expect(input.value).toBe("Old");
    input.value = "Retro";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(sectionOf(byId(store, id))?.title).toBe("Retro");
    expect(container.querySelector("input[data-board-section-title]")).toBeNull();
  });

  it("Escape in the rename input keeps the old title", () => {
    const store = makeStore();
    const id = createSection(store, { x: 0, y: 0, w: 1000, h: 800 }, { title: "Keep" });
    const { container, sections } = mount(store);
    sections.rename(id);
    const input = container.querySelector<HTMLInputElement>("input[data-board-section-title]")!;
    input.value = "Nope";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(sectionOf(byId(store, id))?.title).toBe("Keep");
  });

  it("draws a section with the armed tool and disarms it", () => {
    const store = makeStore();
    const { canvas, container, sections, editor } = mount(store);
    sections.attach();
    sections.tool.set(true);
    drag(canvas, [100, 100], [500, 400]);
    const created = readElements(store).find((e) => sectionOf(e));
    expect(created?.frame).toMatchObject({ x: 100, y: 100, w: 400, h: 300 });
    expect(sections.tool.get()).toBe(false);
    expect(editor.getSelection()).toEqual([created!.id]);
    // Straight into naming it, as FigJam does.
    expect(container.querySelector("input[data-board-section-title]")).not.toBeNull();
  });

  it("offers section actions in the element menu and unlock on the canvas", () => {
    const store = makeStore();
    const a = addSticky(store, 300, 300);
    const id = createSection(store, { x: 0, y: 0, w: 1000, h: 800 }, { title: "Q1" });
    const { sections } = mount(store);
    const menu = sections.editorOptions.hostElementMenuItems!;
    const on = (sel: string) => menu({ at: { x: 0, y: 0 }, elementId: sel, selectedIds: [sel] });
    expect(on(id).map((i) => i.label)).toContain("Delete section and contents");
    expect(on(a).map((i) => i.label)).toContain("Create section around selection");
    expect(sections.canvasMenuItems({ x: 50, y: 50 })).toEqual([]);
    updateSectionMeta(store, id, { locked: true });
    const unlock = sections.canvasMenuItems({ x: 50, y: 50 }).find((i) =>
      i.label.startsWith("Unlock"),
    )!;
    expect(unlock.label).toBe("Unlock “Q1”");
    unlock.run();
    expect(sectionOf(byId(store, id))?.locked).toBeUndefined();
  });
});
