import type { SlidesEditor, SlidesStore, Theme } from '@wafflebase/slides';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import type { ToolbarState } from './state';
import { InsertGroup } from './insert-group';
import { ArrangeMenu } from './arrange-menu';
import { ShapeControls } from './shape-controls';
import { ImageControls } from './image-controls';

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
 * - `text-element` / `mixed` → contextual format zone left empty;
 *   Task 10 fills text-element in.
 *
 * Arrange menu always appears at the end regardless of selection type.
 */
export function ObjectSection({ state, editor, store, theme, onImagePick, upload }: ObjectSectionProps) {
  const showShapeControls =
    state.selectionType === 'shape' || state.selectionType === 'connector';

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
      <ToolbarSeparator className="mx-1" />
      <ArrangeMenu editor={editor} selectionSize={state.ids.length} />
    </>
  );
}
