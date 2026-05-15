import type { SlidesEditor, SlidesStore, SlidesTextBoxEditor, Element } from '@wafflebase/slides';

export type ToolbarState =
  | { kind: 'idle' }
  | { kind: 'object'; selectionType: 'shape' | 'connector' | 'image' | 'text-element' | 'mixed'; ids: readonly string[] }
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
  let selectionType: 'shape' | 'connector' | 'image' | 'text-element' | 'mixed';
  if (!single) {
    selectionType = 'mixed';
  } else if (single === 'text') {
    selectionType = 'text-element';
  } else if (single === 'image') {
    selectionType = 'image';
  } else if (single === 'connector') {
    selectionType = 'connector';
  } else {
    selectionType = 'shape';
  }
  return { kind: 'object', selectionType, ids: selection };
}
