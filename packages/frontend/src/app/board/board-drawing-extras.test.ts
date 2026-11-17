// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlidesEditor } from "@wafflebase/slides";
import type { BoardPresence } from "@/types/board-document";
import { createHandTool } from "./board-hand";
import { createInkTool, DEFAULT_INK_STATE } from "./board-ink";
import { createBoardDrawingExtras, createDrawingTools } from "./board-drawing-extras";
import { encodeLivePoints } from "./board-live-ink";

/**
 * The glue in `board-drawing-extras.ts`: editor options, the laser drag,
 * peers' live strokes, and one-live-tool-at-a-time.
 */

function fakeDoc(peers: { clientID: string; presence: Partial<BoardPresence> }[] = []) {
  const subs = new Set<() => void>();
  return {
    peers,
    getOthersPresences: () => peers,
    subscribe: (_: "others", cb: () => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    emit: () => subs.forEach((cb) => cb()),
  };
}

function fakeEditor() {
  let mode: string | null = null;
  const modeSubs = new Set<() => void>();
  return {
    getInsertMode: () => mode,
    setInsertMode: (m: string | null) => {
      mode = m;
      modeSubs.forEach((cb) => cb());
    },
    onInsertModeChange: (cb: () => void) => {
      modeSubs.add(cb);
      return () => modeSubs.delete(cb);
    },
    isTextEditing: () => false,
    exitTextEditing: vi.fn(),
    clearSelectionAndScope: vi.fn(),
    setPeerInkStroke: vi.fn(),
  };
}

function setup(opts: { readOnly?: boolean; peers?: { clientID: string; presence: Partial<BoardPresence> }[] } = {}) {
  const doc = fakeDoc(opts.peers ?? [{ clientID: "peer", presence: {} }]);
  const store = { updatePresence: vi.fn() };
  const ink = createInkTool(DEFAULT_INK_STATE);
  const tools = createDrawingTools();
  const editor = fakeEditor();
  const extras = createBoardDrawingExtras({
    doc,
    store,
    readOnly: opts.readOnly ?? false,
    ink,
    tools,
    getEditor: () => editor as unknown as SlidesEditor,
  });
  const container = document.createElement("div");
  const canvas = document.createElement("canvas");
  const overlay = document.createElement("div");
  container.append(canvas, overlay);
  document.body.appendChild(container);
  const hand = createHandTool();
  const sectionTool = createHandTool();
  const detach = extras.attach({
    container,
    canvas,
    overlay,
    getViewport: () => ({ panX: 0, panY: 0, zoom: 1 }),
    getHost: () => ({ w: 400, h: 300 }),
    getCanvasRect: () => ({ left: 0, top: 0 }),
    dpr: 1,
    hand,
    sectionTool,
  });
  return { doc, store, ink, tools, editor, extras, canvas, container, hand, sectionTool, detach };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("editor options", () => {
  it("free lasso on Alt or with the toggle, never read-only", () => {
    const s = setup();
    const lasso = s.extras.editorOptions.freeLasso!;
    expect(lasso({ altKey: false })).toBe(false);
    expect(lasso({ altKey: true })).toBe(true);
    s.tools.lasso.set(true);
    expect(lasso({ altKey: false })).toBe(true);
    s.detach();
    const ro = setup({ readOnly: true });
    expect(ro.extras.editorOptions.freeLasso!({ altKey: true })).toBe(false);
    ro.detach();
  });

  it("smart shapes only when switched on, and only for the marker", () => {
    const s = setup();
    const box = [
      { x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 90 }, { x: 0, y: 90 }, { x: 3, y: 4 },
    ];
    const stroke = { color: "#000", width: 4 };
    const transform = s.extras.editorOptions.transformInkStroke!;
    expect(transform(box, stroke)).toBeNull();
    s.ink.setSmartShapes(true);
    expect(transform(box, stroke)?.[0]).toMatchObject({ type: "shape", data: { kind: "rect" } });
    s.ink.setPen("highlighter");
    expect(transform(box, stroke)).toBeNull();
    s.detach();
  });

  it("onInkProgress writes the stroke to presence through the store", () => {
    vi.useFakeTimers();
    const s = setup();
    s.extras.editorOptions.onInkProgress!([{ x: 1, y: 2 }]);
    expect(s.store.updatePresence).toHaveBeenCalledWith({
      stroke: expect.objectContaining({ id: 1, tool: "marker", base: 0 }),
    });
    s.extras.editorOptions.onInkProgress!(null);
    vi.advanceTimersByTime(200);
    expect(s.store.updatePresence).toHaveBeenLastCalledWith({ stroke: null });
    s.detach();
    vi.useRealTimers();
  });

  it("writes no presence on a read-only mount or with nobody else here", () => {
    vi.useFakeTimers();
    const ro = setup({ readOnly: true });
    ro.extras.editorOptions.onInkProgress!([{ x: 1, y: 2 }]);
    const solo = setup({ peers: [] });
    solo.extras.editorOptions.onInkProgress!([{ x: 1, y: 2 }]);
    vi.advanceTimersByTime(200);
    expect(ro.store.updatePresence).not.toHaveBeenCalled();
    expect(solo.store.updatePresence).not.toHaveBeenCalled();
    ro.detach();
    solo.detach();
    vi.useRealTimers();
  });
});

describe("peers", () => {
  it("paints a peer's live stroke and clears it", () => {
    const stroke = {
      id: 1, tool: "marker" as const, color: "#000000", width: 4, alpha: 1, base: 0,
      points: encodeLivePoints([{ x: 0, y: 0 }, { x: 10, y: 10 }]),
    };
    const s = setup({ peers: [{ clientID: "p", presence: { stroke } }] });
    expect(s.editor.setPeerInkStroke).toHaveBeenCalledWith("p", expect.objectContaining({ width: 4 }));
    s.doc.peers[0].presence = { stroke: null };
    s.doc.emit();
    expect(s.editor.setPeerInkStroke).toHaveBeenLastCalledWith("p", null);
    s.detach();
  });
});

describe("laser", () => {
  it("a laser drag on the scene is claimed and published, never stored", () => {
    vi.useFakeTimers();
    const s = setup();
    s.tools.laser.set(true);
    const editorListener = vi.fn();
    s.canvas.addEventListener("pointerdown", editorListener);
    const down = new PointerEvent("pointerdown", { clientX: 5, clientY: 5, bubbles: true, button: 0, pointerId: 1 });
    s.canvas.dispatchEvent(down);
    expect(editorListener).not.toHaveBeenCalled();
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 30, clientY: 9, pointerId: 1 }));
    vi.advanceTimersByTime(200);
    expect(s.store.updatePresence).toHaveBeenCalledWith({
      laser: expect.objectContaining({ id: 1, base: 0 }),
    });
    document.dispatchEvent(new PointerEvent("pointerup", { clientX: 30, clientY: 9, pointerId: 1 }));
    vi.advanceTimersByTime(200);
    expect(s.store.updatePresence).toHaveBeenLastCalledWith({ laser: null });
    expect(s.canvas.dataset.boardLaser).toBe("");
    s.detach();
    vi.useRealTimers();
  });
});

describe("one live tool at a time", () => {
  it("laser and lasso disarm the hand, sections and insert modes, and each other", () => {
    const s = setup();
    s.hand.set(true);
    s.editor.setInsertMode("rect");
    s.tools.laser.set(true);
    expect(s.hand.get()).toBe(false);
    expect(s.editor.getInsertMode()).toBe(null);
    expect(s.editor.clearSelectionAndScope).toHaveBeenCalled();
    s.tools.lasso.set(true);
    expect(s.tools.laser.get()).toBe(false);
    s.sectionTool.set(true);
    expect(s.tools.lasso.get()).toBe(false);
    s.tools.laser.set(true);
    s.editor.setInsertMode("freeform");
    expect(s.tools.laser.get()).toBe(false);
    s.tools.lasso.set(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(s.tools.lasso.get()).toBe(false);
    s.detach();
  });
});
