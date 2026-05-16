/**
 * Text-edit contextual section.
 *
 * Rendered in the toolbar's contextual middle slot when
 * `state.kind === 'text-edit'`. Composes the three shared text-formatting
 * groups from @/components/text-formatting, bound to the active
 * SlidesTextBoxEditor.
 *
 * SlidesTextBoxEditor structurally satisfies TextFormattingEditor (all
 * required methods are present on the type — see text-box-editor.ts).
 * No explicit cast is needed.
 */

import type { ToolbarState } from './state';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import {
  TextStyleGroup,
  TextFormatGroup,
  TextParagraphGroup,
} from '@/components/text-formatting';

export interface TextEditSectionProps {
  state: Extract<ToolbarState, { kind: 'text-edit' }>;
}

export function TextEditSection({ state }: TextEditSectionProps) {
  const editor = state.textEditor;
  return (
    <>
      <TextStyleGroup
        editor={editor}
        allowedBlockTypes={['paragraph', 'heading']}
      />
      <ToolbarSeparator className="mx-1" />
      <TextFormatGroup editor={editor} />
      <ToolbarSeparator className="mx-1" />
      <TextParagraphGroup editor={editor} />
    </>
  );
}
