import type { SlidesEditor, SlidesStore, Theme } from '@wafflebase/slides';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import type { ToolbarState } from './state';
import { InsertGroup } from './insert-group';
import { ArrangeMenu } from './arrange-menu';
import { ShapeControls } from './shape-controls';

export interface ObjectSectionProps {
  state: Extract<ToolbarState, { kind: 'object' }>;
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  theme?: Theme | null;
  onImagePick: () => void;
}

/**
 * Contextual toolbar section rendered when one or more objects are selected.
 *
 * Routes on `state.selectionType`:
 * - `shape` / `connector` → ShapeControls (Fill + Border)
 * - `image` / `text-element` / `mixed` → contextual format zone left empty;
 *   Tasks 9 and 10 fill these in.
 *
 * Arrange menu always appears at the end regardless of selection type.
 */
export function ObjectSection({ state, editor, store, theme, onImagePick }: ObjectSectionProps) {
  const showShapeControls =
    state.selectionType === 'shape' || state.selectionType === 'connector';

  return (
    <>
      <InsertGroup editor={editor} onImagePick={onImagePick} disabled={!editor} />
      <ToolbarSeparator className="mx-1" />
      {showShapeControls && (
        <ShapeControls editor={editor} store={store} theme={theme} ids={state.ids} />
      )}
      <ToolbarSeparator className="mx-1" />
      <ArrangeMenu editor={editor} selectionSize={state.ids.length} />
    </>
  );
}
