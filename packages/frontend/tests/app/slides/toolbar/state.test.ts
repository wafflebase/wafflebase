import { test, expect } from 'vitest';
import { getToolbarState } from "../../../../src/app/slides/toolbar/state.ts";
import type { SlidesEditor, SlidesStore, SlidesTextBoxEditor, Slide, SlidesDocument } from "@wafflebase/slides";

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

function makeEditor(overrides: Partial<{
  isTextEditing: boolean;
  editingElementId: string | null;
  textEditor: SlidesTextBoxEditor | null;
  selection: readonly string[];
  currentSlideId: string | undefined;
}>): SlidesEditor {
  const o = {
    isTextEditing: false,
    editingElementId: null as string | null,
    textEditor: null as SlidesTextBoxEditor | null,
    selection: [] as readonly string[],
    currentSlideId: undefined as string | undefined,
    ...overrides,
  };
  return {
    render() {},
    markDirty() {},
    getSelection: () => o.selection,
    setSelection() {},
    onSelectionChange: () => () => {},
    setInsertMode() {},
    getInsertMode: () => null,
    isConnectorMode: () => false,
    onInsertModeChange: () => () => {},
    getCurrentSlideId: () => o.currentSlideId,
    setCurrentSlide() {},
    getEditingElementId: () => o.editingElementId,
    isTextEditing: () => o.isTextEditing,
    onTextEditingChange: () => () => {},
    getActiveTextEditor: () => o.textEditor,
    enterTextEditing() {},
    getCellSelection: () => null,
    onCellSelectionChange: () => () => {},
    exitTextEditing() {},
    onCurrentSlideChange: () => () => {},
    setHostSize() {},
    align() {},
    distribute() {},
    destroy() {},
    // Additional methods not relevant for state derivation
  } as unknown as SlidesEditor;
}

function makeStore(slides: Slide[]): SlidesStore {
  const doc: SlidesDocument = {
    meta: { title: 'Test', themeId: 'default-light', masterId: 'default' },
    slides,
    themes: [],
    masters: [],
  };
  return {
    read: () => JSON.parse(JSON.stringify(doc)) as SlidesDocument,
    addSlide: () => 'new-id',
    duplicateSlide: () => 'dup-id',
    removeSlide() {},
    removeSlides() {},
    moveSlide() {},
    moveSlides() {},
    updateSlideBackground() {},
    applyLayout() {},
    addTheme() {},
    applyTheme() {},
    addElement: () => 'el-id',
    removeElement() {},
    removeElements() {},
    updateElementFrame() {},
    updateElementData() {},
    reorderElement() {},
    updateConnectorEndpoint() {},
    updateConnectorArrowheads() {},
    withTextElement() {},
    withNotes() {},
    batch(fn) { fn(); },
    undo() {},
    redo() {},
    canUndo: () => false,
    canRedo: () => false,
  };
}

function makeSlide(id: string, elements: Slide['elements']): Slide {
  return {
    id,
    layoutId: 'blank',
    background: { type: 'solid', color: { type: 'fixed', value: '#ffffff' } },
    elements,
    notes: [],
  };
}

function makeShapeElement(id: string) {
  return {
    id,
    type: 'shape' as const,
    frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    data: { kind: 'rect' as const },
  };
}

function makeImageElement(id: string) {
  return {
    id,
    type: 'image' as const,
    frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    data: { src: 'https://example.com/img.png' },
  };
}

function makeTextElement(id: string) {
  return {
    id,
    type: 'text' as const,
    frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    data: { blocks: [] },
  };
}

function makeConnectorElement(id: string) {
  return {
    id,
    type: 'connector' as const,
    frame: { x: 0, y: 0, w: 100, h: 10, rotation: 0 },
    routing: 'straight' as const,
    start: { kind: 'free' as const, x: 0, y: 0 },
    end: { kind: 'free' as const, x: 100, y: 0 },
    arrowheads: {},
  };
}

function makeTableElement(id: string) {
  return {
    id,
    type: 'table' as const,
    frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
    data: {
      columnWidths: [100, 100],
      rows: [
        {
          height: 100,
          cells: [
            { body: { blocks: [] }, style: {} },
            { body: { blocks: [] }, style: {} },
          ],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// idle cases
// ---------------------------------------------------------------------------

test("getToolbarState returns idle when editor is null", () => {
  const state = getToolbarState(null, null);
  expect(state.kind).toBe("idle");
});

test("getToolbarState returns idle when selection is empty", () => {
  const editor = makeEditor({ selection: [], currentSlideId: "slide-1" });
  const store = makeStore([makeSlide("slide-1", [makeShapeElement("el-1")])]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("idle");
});

test("getToolbarState returns idle when not text-editing and store is null", () => {
  const editor = makeEditor({ selection: ["el-1"], currentSlideId: "slide-1" });
  const state = getToolbarState(editor, null);
  expect(state.kind).toBe("idle");
});

test("getToolbarState returns idle when slide not found in store", () => {
  const editor = makeEditor({ selection: ["el-1"], currentSlideId: "slide-unknown" });
  const store = makeStore([makeSlide("slide-1", [makeShapeElement("el-1")])]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("idle");
});

test("getToolbarState returns idle when selection IDs don't match any element on the current slide", () => {
  // selection has an id that doesn't exist in slide.elements
  const editor = makeEditor({ selection: ["nonexistent-id"], currentSlideId: "slide-1" });
  const store = makeStore([makeSlide("slide-1", [makeShapeElement("el-1")])]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("idle");
});

// ---------------------------------------------------------------------------
// text-edit case
// ---------------------------------------------------------------------------

test("getToolbarState returns text-edit when editor.isTextEditing() is true and ids/editor are present", () => {
  const fakeTextEditor = { getFormats: () => ({}), focus: () => {} } as unknown as SlidesTextBoxEditor;
  const editor = makeEditor({
    isTextEditing: true,
    editingElementId: "el-text",
    textEditor: fakeTextEditor,
  });
  const store = makeStore([]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("text-edit");
  if (state.kind === "text-edit") {
    expect(state.elementId).toBe("el-text");
    expect(state.textEditor).toBe(fakeTextEditor);
  }
});

test("getToolbarState returns idle when isTextEditing is true but elementId is null", () => {
  const fakeTextEditor = {} as unknown as SlidesTextBoxEditor;
  const editor = makeEditor({
    isTextEditing: true,
    editingElementId: null,
    textEditor: fakeTextEditor,
  });
  const state = getToolbarState(editor, null);
  expect(state.kind).toBe("idle");
});

test("getToolbarState returns idle when isTextEditing is true but textEditor is null", () => {
  const editor = makeEditor({
    isTextEditing: true,
    editingElementId: "el-text",
    textEditor: null,
  });
  const state = getToolbarState(editor, null);
  expect(state.kind).toBe("idle");
});

// ---------------------------------------------------------------------------
// object cases
// ---------------------------------------------------------------------------

test("getToolbarState returns object with selectionType 'shape' for single shape selection", () => {
  const editor = makeEditor({ selection: ["el-1"], currentSlideId: "slide-1" });
  const store = makeStore([makeSlide("slide-1", [makeShapeElement("el-1")])]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("object");
  if (state.kind === "object") {
    expect(state.selectionType).toBe("shape");
    expect(Array.from(state.ids)).toEqual(["el-1"]);
  }
});

test("getToolbarState returns object with selectionType 'image' for single image selection", () => {
  const editor = makeEditor({ selection: ["el-img"], currentSlideId: "slide-1" });
  const store = makeStore([makeSlide("slide-1", [makeImageElement("el-img")])]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("object");
  if (state.kind === "object") {
    expect(state.selectionType).toBe("image");
  }
});

test("getToolbarState returns object with selectionType 'text-element' for single text element selection", () => {
  // element.type is 'text' but selectionType maps to 'text-element'
  const editor = makeEditor({ selection: ["el-txt"], currentSlideId: "slide-1" });
  const store = makeStore([makeSlide("slide-1", [makeTextElement("el-txt")])]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("object");
  if (state.kind === "object") {
    expect(state.selectionType).toBe("text-element");
  }
});

test("getToolbarState returns object with selectionType 'mixed' for multi-type selection", () => {
  const editor = makeEditor({ selection: ["el-shape", "el-txt"], currentSlideId: "slide-1" });
  const store = makeStore([
    makeSlide("slide-1", [makeShapeElement("el-shape"), makeTextElement("el-txt")]),
  ]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("object");
  if (state.kind === "object") {
    expect(state.selectionType).toBe("mixed");
  }
});

test("getToolbarState includes all selected ids in the ids array", () => {
  const editor = makeEditor({ selection: ["el-1", "el-2"], currentSlideId: "slide-1" });
  const store = makeStore([
    makeSlide("slide-1", [makeShapeElement("el-1"), makeShapeElement("el-2")]),
  ]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("object");
  if (state.kind === "object") {
    expect(state.selectionType).toBe("shape");
    expect(Array.from(state.ids)).toEqual(["el-1", "el-2"]);
  }
});

test("getToolbarState returns object with selectionType 'connector' for single connector selection", () => {
  const editor = makeEditor({ selection: ["el-conn"], currentSlideId: "slide-1" });
  const store = makeStore([makeSlide("slide-1", [makeConnectorElement("el-conn")])]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("object");
  if (state.kind === "object") {
    expect(state.selectionType).toBe("connector");
    expect(Array.from(state.ids)).toEqual(["el-conn"]);
  }
});

test("getToolbarState returns 'mixed' when selection spans connector and shape", () => {
  const editor = makeEditor({ selection: ["el-conn", "el-shape"], currentSlideId: "slide-1" });
  const store = makeStore([
    makeSlide("slide-1", [makeConnectorElement("el-conn"), makeShapeElement("el-shape")]),
  ]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("object");
  if (state.kind === "object") {
    expect(state.selectionType).toBe("mixed");
  }
});

test("getToolbarState returns selectionType 'table' for single TableElement (not 'shape')", () => {
  // Regression guard: before adding the table union member to getToolbarState,
  // a single TableElement selection fell through the else into 'shape', so
  // ObjectSection rendered ShapeControls (Fill + Border) on a table — phantom
  // controls that silently no-op against an el.type === 'shape' guard inside
  // onStrokeChange but still opened store.batch (snapshot + redo-clear).
  const editor = makeEditor({ selection: ["el-tbl"], currentSlideId: "slide-1" });
  const store = makeStore([
    makeSlide("slide-1", [makeTableElement("el-tbl") as unknown as Slide['elements'][number]]),
  ]);
  const state = getToolbarState(editor, store);
  expect(state.kind).toBe("object");
  if (state.kind === "object") {
    expect(state.selectionType).toBe("table");
  }
});
