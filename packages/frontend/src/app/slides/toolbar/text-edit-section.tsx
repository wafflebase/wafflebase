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

import { useEffect, useState } from 'react';
import type { SlidesEditor } from '@wafflebase/slides';
import { DEFAULT_INLINE_STYLE } from '@wafflebase/docs';
import type { ToolbarState } from './state';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  TextStyleGroup,
  TextFormatGroup,
  TextParagraphGroup,
  FontSizePicker,
} from '@/components/text-formatting';

export interface TextEditSectionProps {
  state: Extract<ToolbarState, { kind: 'text-edit' }>;
  editor: SlidesEditor | null;
}

export function TextEditSection({ state, editor }: TextEditSectionProps) {
  const textEditor = state.textEditor;

  // Mirror docs-formatting-toolbar.tsx: pull from getRangeStyleSummary,
  // refresh on cursor moves, fall back to DEFAULT_INLINE_STYLE.fontSize
  // when the run has no explicit size. A freshly typed Shape's text is
  // seeded by emptyShapeTextBlock() in editor.ts with only
  // `{ color: SHAPE_TEXT_SEED_COLOR }` — no fontSize — so a raw
  // getSelectionStyle().fontSize read renders the picker empty even
  // though the canvas paints at the docs default size.
  type RangeSummary = ReturnType<typeof textEditor.getRangeStyleSummary>;
  const [summary, setSummary] = useState<RangeSummary>(() =>
    textEditor.getRangeStyleSummary(),
  );
  useEffect(() => {
    const refresh = () => setSummary(textEditor.getRangeStyleSummary());
    refresh();
    return textEditor.onCursorMove(refresh);
  }, [textEditor]);
  const sizeValue =
    summary.fontSize === 'mixed'
      ? undefined
      : (summary.fontSize ?? DEFAULT_INLINE_STYLE.fontSize);

  return (
    <>
      <TextStyleGroup
        editor={textEditor}
        allowedBlockTypes={['paragraph', 'heading']}
      />
      <FontSizePicker
        value={sizeValue}
        onChange={(size) => {
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
