import type { SlidesEditor } from '@wafflebase/slides';
import { InsertGroup } from './insert-group';

export interface IdleSectionProps {
  editor: SlidesEditor | null;
  onImagePick: () => void;
}

/**
 * Idle state (no selection, not text-editing): only the Insert group.
 * The Slide background button lives next to Theme in RightGlobals so
 * it stays available regardless of selection state.
 */
export function IdleSection({ editor, onImagePick }: IdleSectionProps) {
  return <InsertGroup editor={editor} onImagePick={onImagePick} disabled={!editor} />;
}
