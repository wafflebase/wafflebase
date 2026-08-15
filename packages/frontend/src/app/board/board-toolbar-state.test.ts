import { describe, expect, it } from "vitest";
import type {
  Element,
  Frame,
  GroupElement,
  ShapeElement,
  SlidesEditor,
  SlidesStore,
  TextElement,
} from "@wafflebase/slides";
import { SYNTHETIC_SLIDE_ID, boardToSlidesDocument } from "@wafflebase/board";
import { getToolbarState } from "../slides/toolbar/state";
import { canUngroupSelection } from "../slides/toolbar/can-ungroup";

/**
 * Characterization test for the contract the board toolbar leans on:
 * slides' `getToolbarState` must read a BOARD store — one synthetic
 * slide wrapping the board's flat element array — exactly the way it
 * reads a real deck. The board toolbar routes its contextual controls
 * off this function's output, so any drift here silently empties the
 * toolbar rather than failing loudly.
 *
 * The store stub synthesizes its snapshot through the real
 * `boardToSlidesDocument`, so the slide id / theme / layout wiring under
 * test is the production one and not a hand-rolled lookalike.
 */
function boardStore(elements: Element[]): SlidesStore {
  return {
    read: () =>
      boardToSlidesDocument({ meta: { title: "Board" }, elements }),
  } as unknown as SlidesStore;
}

/** Minimal editor stub exposing only what `getToolbarState` reads. */
function editorStub(over: Partial<Record<string, unknown>> = {}): SlidesEditor {
  return {
    isTextEditing: () => false,
    getEditingElementId: () => null,
    getActiveTextEditor: () => null,
    getSelection: () => [],
    getCurrentSlideId: () => SYNTHETIC_SLIDE_ID,
    getCellSelection: () => null,
    ...over,
  } as unknown as SlidesEditor;
}

const frame: Frame = { x: 0, y: 0, w: 10, h: 10, rotation: 0 };
const shape: ShapeElement = {
  id: "e1",
  type: "shape",
  frame,
  data: { kind: "rect" },
};
const text: TextElement = {
  id: "e2",
  type: "text",
  frame,
  data: { blocks: [] },
};

describe("getToolbarState on a board store", () => {
  it("is idle with nothing selected", () => {
    const state = getToolbarState(editorStub(), boardStore([shape]));
    expect(state.kind).toBe("idle");
  });

  it("reports a shape selection", () => {
    const state = getToolbarState(
      editorStub({ getSelection: () => ["e1"] }),
      boardStore([shape]),
    );
    expect(state).toMatchObject({
      kind: "object",
      selectionType: "shape",
      ids: ["e1"],
    });
  });

  it("reports a text-element selection", () => {
    const state = getToolbarState(
      editorStub({ getSelection: () => ["e2"] }),
      boardStore([text]),
    );
    expect(state).toMatchObject({ kind: "object", selectionType: "text-element" });
  });

  it("reports a mixed selection", () => {
    const state = getToolbarState(
      editorStub({ getSelection: () => ["e1", "e2"] }),
      boardStore([shape, text]),
    );
    expect(state).toMatchObject({ kind: "object", selectionType: "mixed" });
  });

  it("enables Ungroup for a single selected group on a board store", () => {
    // Regression guard: the board toolbar left `canUngroup` at its
    // `false` default, so Arrange ▸ Ungroup was dead even right after
    // the user grouped two shapes from that same menu.
    const group: GroupElement = {
      id: "g1",
      type: "group",
      frame,
      data: { children: [shape, text] },
    };
    const store = boardStore([group]);
    const editor = editorStub({ getSelection: () => ["g1"] });

    expect(canUngroupSelection(editor, store, ["g1"])).toBe(true);
    // …and not for a plain shape, or a multi-selection.
    expect(canUngroupSelection(editor, boardStore([shape]), ["e1"])).toBe(false);
    expect(canUngroupSelection(editor, store, ["g1", "e1"])).toBe(false);
    expect(canUngroupSelection(editor, store, [])).toBe(false);
    expect(canUngroupSelection(null, store, ["g1"])).toBe(false);
  });

  it("reports text-edit while editing a text box", () => {
    const textEditor = { marker: true };
    const state = getToolbarState(
      editorStub({
        isTextEditing: () => true,
        getEditingElementId: () => "e2",
        getActiveTextEditor: () => textEditor,
      }),
      boardStore([text]),
    );
    expect(state).toMatchObject({ kind: "text-edit", elementId: "e2" });
  });
});
