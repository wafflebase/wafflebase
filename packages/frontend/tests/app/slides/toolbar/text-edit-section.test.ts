/**
 * Tests for the text-edit toolbar state transitions and the TextEditSection
 * component's contract.
 *
 * JSX rendering is not supported in the Node test runner, so these tests
 * focus on the state-machine logic (getToolbarState) and verify that the
 * text-edit path produces the expected state shape that TextEditSection
 * consumes. We also smoke-test the import of TextEditSection itself to
 * confirm there are no module-resolution or TypeScript structural errors.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getToolbarState } from "../../../../src/app/slides/toolbar/state.ts";
import type { SlidesEditor, SlidesStore, SlidesTextBoxEditor, Slide, SlidesDocument } from "@wafflebase/slides";

// ---------------------------------------------------------------------------
// Mock helpers (shared pattern from state.test.ts)
// ---------------------------------------------------------------------------

function makeTextBoxEditor(): SlidesTextBoxEditor {
  return {
    isEditing: () => true,
    focus: () => {},
    detach: () => {},
    commit: () => {},
    container: {} as HTMLDivElement,
    getSelectionStyle: () => ({}),
    applyStyle: () => {},
    applyBlockStyle: () => {},
    getBlockType: () => ({ type: "paragraph" as const }),
    setBlockType: () => {},
    toggleList: () => {},
    indent: () => {},
    outdent: () => {},
    insertLink: () => {},
    removeLink: () => {},
    getLinkAtCursor: () => undefined,
    requestLink: () => {},
    undo: () => {},
    redo: () => {},
    onCursorMove: () => {},
  } as unknown as SlidesTextBoxEditor;
}

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
    exitTextEditing() {},
    onCurrentSlideChange: () => () => {},
    setHostSize() {},
    align() {},
    distribute() {},
    destroy() {},
  } as unknown as SlidesEditor;
}

function makeStore(slides: Slide[]): SlidesStore {
  const doc: SlidesDocument = {
    meta: { title: "Test", themeId: "default-light", masterId: "default" },
    slides,
    themes: [],
    masters: [],
  };
  return {
    read: () => JSON.parse(JSON.stringify(doc)) as SlidesDocument,
    addSlide: () => "new-id",
    duplicateSlide: () => "dup-id",
    removeSlide() {},
    removeSlides() {},
    moveSlide() {},
    moveSlides() {},
    updateSlideBackground() {},
    applyLayout() {},
    addTheme() {},
    applyTheme() {},
    addElement: () => "el-id",
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

function makeTextElementSlide(): Slide {
  return {
    id: "slide-1",
    layoutId: "blank",
    background: { type: "solid", color: { type: "fixed", value: "#ffffff" } },
    elements: [
      {
        id: "el-text",
        type: "text" as const,
        frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
        data: { blocks: [] },
      },
    ],
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// State-transition tests for the text-edit path
// ---------------------------------------------------------------------------

test("selecting a text element produces object state with selectionType 'text-element'", () => {
  const editor = makeEditor({
    selection: ["el-text"],
    currentSlideId: "slide-1",
  });
  const store = makeStore([makeTextElementSlide()]);
  const state = getToolbarState(editor, store);
  assert.equal(state.kind, "object");
  if (state.kind === "object") {
    assert.equal(state.selectionType, "text-element");
    assert.deepEqual(Array.from(state.ids), ["el-text"]);
  }
});

test("entering text-edit produces text-edit state with elementId and textEditor", () => {
  const fakeTextEditor = makeTextBoxEditor();
  const editor = makeEditor({
    isTextEditing: true,
    editingElementId: "el-text",
    textEditor: fakeTextEditor,
  });
  const store = makeStore([makeTextElementSlide()]);
  const state = getToolbarState(editor, store);
  assert.equal(state.kind, "text-edit");
  if (state.kind === "text-edit") {
    assert.equal(state.elementId, "el-text");
    assert.equal(state.textEditor, fakeTextEditor);
  }
});

test("exiting text-edit (isTextEditing false, selection retained) returns object state", () => {
  const editor = makeEditor({
    isTextEditing: false,
    editingElementId: null,
    textEditor: null,
    selection: ["el-text"],
    currentSlideId: "slide-1",
  });
  const store = makeStore([makeTextElementSlide()]);
  const state = getToolbarState(editor, store);
  assert.equal(state.kind, "object");
  if (state.kind === "object") {
    assert.equal(state.selectionType, "text-element");
  }
});

test("text-edit state textEditor exposes formatting surface (structural check)", () => {
  const fakeTextEditor = makeTextBoxEditor();
  const editor = makeEditor({
    isTextEditing: true,
    editingElementId: "el-text",
    textEditor: fakeTextEditor,
  });
  const store = makeStore([]);
  const state = getToolbarState(editor, store);
  assert.equal(state.kind, "text-edit");
  if (state.kind === "text-edit") {
    // Verify the textEditor on the state satisfies the TextFormattingEditor
    // surface that TextEditSection passes to the shared formatting groups.
    const te = state.textEditor;
    assert.equal(typeof te.focus, "function");
    assert.equal(typeof te.getSelectionStyle, "function");
    assert.equal(typeof te.applyStyle, "function");
    assert.equal(typeof te.applyBlockStyle, "function");
    assert.equal(typeof te.getBlockType, "function");
    assert.equal(typeof te.setBlockType, "function");
    assert.equal(typeof te.toggleList, "function");
    assert.equal(typeof te.indent, "function");
    assert.equal(typeof te.outdent, "function");
    assert.equal(typeof te.requestLink, "function");
  }
});

test("TextEditSection module imports without error", async () => {
  // Smoke-test: confirms the module can be resolved and the named export exists.
  // Full JSX rendering is not available in the Node test runner.
  const mod = await import("../../../../src/app/slides/toolbar/text-edit-section.tsx");
  assert.equal(typeof mod.TextEditSection, "function");
});
