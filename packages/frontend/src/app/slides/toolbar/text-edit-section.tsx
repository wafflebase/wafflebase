/**
 * Text-edit contextual section.
 *
 * Rendered in the toolbar's contextual middle slot when
 * `state.kind === 'text-edit'`. Composes the three shared
 * text-formatting groups from @/components/text-formatting bound to
 * the active SlidesTextBoxEditor, then ends with a Done button that
 * exits text-edit mode (equivalent to pressing Escape).
 *
 * `SlidesTextBoxEditor` structurally satisfies `TextFormattingEditor`
 * (all required methods are present on the type — see
 * text-box-editor.ts). No explicit cast is needed.
 *
 * Done lives here — at the trailing edge of the contextual region —
 * rather than in `RightGlobals` so the slide-style cluster
 * (Background / Layout / Theme) stays stable across state
 * transitions and the "exit mode" action sits next to the
 * mode-scoped formatting controls.
 */

import type { SlidesEditor } from '@wafflebase/slides';
import type { ToolbarState } from './state';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  TextStyleGroup,
  TextFormatGroup,
  TextParagraphGroup,
  TextSizeStepper,
} from '@/components/text-formatting';

export interface TextEditSectionProps {
  state: Extract<ToolbarState, { kind: 'text-edit' }>;
  editor: SlidesEditor | null;
}

export function TextEditSection({ state, editor }: TextEditSectionProps) {
  const textEditor = state.textEditor;
  return (
    <>
      <TextStyleGroup
        editor={textEditor}
        allowedBlockTypes={['paragraph', 'heading']}
      />
      <TextSizeStepper
        currentSize={textEditor.getSelectionStyle().fontSize}
        onPick={(size) => {
          textEditor.applyStyle({ fontSize: size });
          textEditor.focus();
        }}
      />
      <ToolbarSeparator className="mx-1" />
      <TextFormatGroup editor={textEditor} />
      <ToolbarSeparator className="mx-1" />
      <TextParagraphGroup editor={textEditor} />
      <ToolbarSeparator className="mx-1" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => editor?.exitTextEditing()}
            disabled={!editor}
            aria-label="Done editing text"
            className="inline-flex h-7 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            Done
          </button>
        </TooltipTrigger>
        <TooltipContent>Exit text edit (Esc)</TooltipContent>
      </Tooltip>
    </>
  );
}
