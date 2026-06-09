import { useEffect, useState } from 'react';
import type { InsertKind, SlidesEditor } from '@wafflebase/slides';
import { Toggle } from '@/components/ui/toggle';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { IconPointer, IconLetterT, IconPhoto } from '@tabler/icons-react';
import { ShapePicker } from '../shape-picker';
import { LinePicker } from '../line-picker';
import { isLinePickerKind } from '../line-picker-helpers';
import { TablePicker } from '../table-picker';

export interface InsertGroupProps {
  editor: SlidesEditor | null;
  /** Parent opens file picker, then calls insertImageOnSlide. */
  onImagePick: () => void;
  disabled?: boolean;
}

/**
 * Insert group: Select / Text / Image / Shape ▾ / Line ▾
 *
 * Shared by the idle and object toolbar sections. The Image button
 * delegates to the parent via `onImagePick` so the toolbar stays
 * decoupled from the upload/insert path — the parent can choose its
 * own file-picker invocation and funnel through `insertImageOnSlide`.
 */
export function InsertGroup({ editor, onImagePick, disabled }: InsertGroupProps) {
  const [insertMode, setInsertMode] = useState<InsertKind | null>(null);

  useEffect(() => {
    if (!editor) return;
    setInsertMode(editor.getInsertMode());
    return editor.onInsertModeChange(() => setInsertMode(editor.getInsertMode()));
  }, [editor]);

  return (
    <>
      {/* Select — pressed when insertMode === null (Esc/default state).
          onClick rather than onPressedChange so a second click while
          already in select mode is a no-op instead of toggling to undefined. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={insertMode === null}
            onClick={() => editor?.setInsertMode(null)}
            aria-label="Select"
            disabled={disabled || !editor}
          >
            <IconPointer size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Select (Esc)</TooltipContent>
      </Tooltip>

      {/* Text box */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={insertMode === 'text'}
            onPressedChange={(pressed) =>
              editor?.setInsertMode(pressed ? 'text' : null)
            }
            aria-label="Text box"
            disabled={disabled || !editor}
          >
            <IconLetterT size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Text box</TooltipContent>
      </Tooltip>

      {/* Insert image — momentary button (not a toggle); no insert-mode state */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onImagePick}
            disabled={disabled || !editor}
            aria-label="Insert image"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconPhoto size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Insert image</TooltipContent>
      </Tooltip>

      {/* Shape ▾ — active when insertMode is a ShapeKind (not text, not connector) */}
      <ShapePicker
        activeKind={
          insertMode && insertMode !== 'text' && !isLinePickerKind(insertMode)
            ? insertMode
            : null
        }
        onSelect={(kind) => editor?.setInsertMode(kind)}
        disabled={disabled || !editor}
      />

      {/* Line ▾ — active when insertMode is a ConnectorInsertKind */}
      <LinePicker
        activeKind={isLinePickerKind(insertMode) ? insertMode : null}
        onSelect={(kind) => editor?.setInsertMode(kind)}
        disabled={disabled || !editor}
      />

      {/* Table ▾ — Google-Slides-style grid picker; clicking a cell
          (rows, cols) inserts a default-sized table on the current
          slide and selects it. */}
      <TablePicker editor={editor} disabled={disabled} />
    </>
  );
}
