/**
 * Text-edit contextual section.
 *
 * Rendered in the toolbar's contextual middle slot when
 * `state.kind === 'text-edit'`. Composes the shared text-formatting
 * groups from @/components/text-formatting bound to the active
 * SlidesTextBoxEditor, then ends with a Done button that exits
 * text-edit mode (equivalent to pressing Escape).
 *
 * Slides-specific surface choices (vs. docs):
 *   - No block-style picker (`TextStyleGroup`). Slides text bodies are
 *     positioned per-element via the slide layout / theme tier; promoting
 *     a run to "Title" / "Heading 1" inside a shape doesn't carry the
 *     semantic weight it does in a flowing document, and the picker
 *     duplicates the layout-driven typography that themes already supply.
 *   - No Strikethrough toggle. Bold / Italic / Underline cover the
 *     in-deck inline-format needs; strike is rarely a first-class need
 *     when editing a slide and the toolbar stays compact without it.
 *   - No Highlight (background color) swatch. Highlight backgrounds
 *     rarely read against themed slide backgrounds and the inline-format
 *     cluster stays compact without them. Text color stays.
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
  TextFormatGroup,
  TextParagraphGroup,
  FontFamilyPicker,
  FontSizePicker,
  useResolvedFontSize,
  useResolvedFontFamily,
  ensureFontLink,
} from '@/components/text-formatting';
import { applySlideFontFamily } from './apply-font-family';

export interface TextEditSectionProps {
  state: Extract<ToolbarState, { kind: 'text-edit' }>;
  editor: SlidesEditor | null;
}

export function TextEditSection({ state, editor }: TextEditSectionProps) {
  const textEditor = state.textEditor;
  // Three-case font-size / family resolution (uniform / mixed / unset →
  // docs default). Shared with the mobile sheet via the `useResolved*`
  // hooks so both surfaces follow the same rule.
  const sizeValue = useResolvedFontSize(textEditor);
  const familyValue = useResolvedFontFamily(textEditor);

  return (
    <>
      <FontFamilyPicker
        value={familyValue}
        onChange={(family) => applySlideFontFamily(textEditor, family, editor)}
        onPrefetch={ensureFontLink}
      />
      <ToolbarSeparator className="mx-1" />
      <FontSizePicker
        value={sizeValue}
        onChange={(size) => {
          textEditor.applyStyle({ fontSize: size });
          textEditor.focus();
        }}
      />
      <ToolbarSeparator className="mx-1" />
      <TextFormatGroup
        editor={textEditor}
        showStrikethrough={false}
        showHighlight={false}
      />
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
