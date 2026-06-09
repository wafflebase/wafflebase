import type { SlidesEditor, SlidesStore, SlidesTextBoxEditor, Element } from '@wafflebase/slides';

export type ToolbarState =
  | { kind: 'idle' }
  | {
      kind: 'object';
      selectionType: 'shape' | 'connector' | 'image' | 'text-element' | 'table' | 'mixed';
      ids: readonly string[];
      /**
       * Live cell-range selection inside a table — present iff
       * `selectionType === 'table'` AND the user has clicked into a
       * specific cell / dragged a range. TableControls reads this to
       * scope its ops (fill / vAlign / border) to the selected cells;
       * when absent (`null`), the same ops apply to the WHOLE table.
       */
      cellRange?: {
        tableId: string;
        r0: number;
        c0: number;
        r1: number;
        c1: number;
      } | null;
    }
  | { kind: 'text-edit'; elementId: string; textEditor: SlidesTextBoxEditor };

export function getToolbarState(
  editor: SlidesEditor | null,
  store: SlidesStore | null,
): ToolbarState {
  if (!editor) return { kind: 'idle' };
  if (editor.isTextEditing()) {
    const elementId = editor.getEditingElementId();
    const textEditor = editor.getActiveTextEditor();
    if (elementId && textEditor) return { kind: 'text-edit', elementId, textEditor };
    return { kind: 'idle' };
  }
  const selection = editor.getSelection();
  if (selection.length === 0) return { kind: 'idle' };

  const slideId = editor.getCurrentSlideId();
  const slide = store && slideId
    ? store.read().slides.find((s) => s.id === slideId)
    : undefined;
  if (!slide) return { kind: 'idle' };
  const types = new Set<Element['type']>();
  for (const el of slide.elements) {
    if (selection.includes(el.id)) types.add(el.type);
  }
  if (types.size === 0) return { kind: 'idle' };
  const single = types.size === 1 ? (types.values().next().value as Element['type']) : null;
  let selectionType: 'shape' | 'connector' | 'image' | 'text-element' | 'table' | 'mixed';
  if (!single) {
    selectionType = 'mixed';
  } else if (single === 'text') {
    selectionType = 'text-element';
  } else if (single === 'image') {
    selectionType = 'image';
  } else if (single === 'connector') {
    selectionType = 'connector';
  } else if (single === 'table') {
    // Tables get no per-element controls in P1; ObjectSection / mobile
    // toolbar render only the universal InsertGroup + Arrange controls.
    // A dedicated Table mode (insert/delete row & col, merge, cell fill /
    // border / vAlign) lands in P3 with the contextual table toolbar.
    selectionType = 'table';
  } else {
    selectionType = 'shape';
  }
  const cellRange =
    selectionType === 'table' ? editor.getCellSelection() : null;
  return { kind: 'object', selectionType, ids: selection, cellRange };
}
