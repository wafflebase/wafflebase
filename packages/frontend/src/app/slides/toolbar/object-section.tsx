import type { SlidesEditor, SlidesStore, Theme } from '@wafflebase/slides';
import { findElementPath } from '@wafflebase/slides';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import type { ToolbarState } from './state';
import { InsertGroup } from './insert-group';
import { ArrangeMenu } from './arrange-menu';
import { ShapeControls } from './shape-controls';
import { ImageControls } from './image-controls';
import { TextElementControls } from './text-element-controls';

export interface ObjectSectionProps {
  state: Extract<ToolbarState, { kind: 'object' }>;
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  theme?: Theme | null;
  onImagePick: () => void;
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
}

/**
 * Contextual toolbar section rendered when one or more objects are selected.
 *
 * Routes on `state.selectionType`:
 * - `shape` / `connector` → ShapeControls (Fill + Border)
 * - `image` → ImageControls (Replace / Crop placeholder / Reset crop / Alt)
 * - `text-element` → TextElementControls (Background fill + Border + Font family + Font size)
 * - `mixed` → contextual format zone left empty
 *
 * Arrange menu always appears at the end regardless of selection type.
 */
export function ObjectSection({ state, editor, store, theme, onImagePick, upload }: ObjectSectionProps) {
  const showShapeControls =
    state.selectionType === 'shape' || state.selectionType === 'connector';

  // Determine whether the current selection is a single group element that
  // can be ungrouped. We look up the element by id in the current slide.
  const slideId = editor?.getCurrentSlideId();
  const slide = store && slideId ? store.read().slides.find((s) => s.id === slideId) : undefined;
  const canUngroup =
    !!slide &&
    state.ids.length === 1 &&
    (() => {
      const path = findElementPath(slide.elements, state.ids[0]);
      return path?.[path.length - 1]?.type === 'group';
    })();

  return (
    <>
      <InsertGroup editor={editor} onImagePick={onImagePick} disabled={!editor} />
      <ToolbarSeparator className="mx-1" />
      {showShapeControls && (
        <ShapeControls editor={editor} store={store} theme={theme} ids={state.ids} />
      )}
      {state.selectionType === 'image' && (
        <ImageControls editor={editor} store={store} ids={state.ids} upload={upload} />
      )}
      {state.selectionType === 'text-element' && (
        <TextElementControls editor={editor} store={store} theme={theme} ids={state.ids} />
      )}
      <ToolbarSeparator className="mx-1" />
      <ArrangeMenu editor={editor} selectionSize={state.ids.length} canUngroup={canUngroup} />
    </>
  );
}
