import { useEffect, useState } from "react";
import type { InsertKind, SlidesEditor } from "@wafflebase/slides";
import { Toggle } from "@/components/ui/toggle";
import { Toolbar } from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { IconPointer, IconLetterT } from "@tabler/icons-react";
import { ShapePicker } from "../slides/shape-picker";
import { LinePicker } from "../slides/line-picker";
import { isLineToolKind } from "../slides/line-picker-helpers";

export interface BoardToolbarProps {
  editor: SlidesEditor | null;
  disabled?: boolean;
}

/**
 * Minimal insert toolbar for the board infinite canvas: Select / Text /
 * Shape ▾ / Line ▾. Mirrors `slides/toolbar/insert-group.tsx`'s wiring
 * against the reused `SlidesEditor`'s `setInsertMode` / `getInsertMode` /
 * `onInsertModeChange` API, minus the two controls that don't apply to a
 * board:
 *
 * - Image insert is out of scope for the board (SP2) — dropped rather
 *   than wired to a dead `onImagePick`.
 * - Table insert is deliberately never exposed here: `YorkieBoardStore`
 *   throws `notSupported()` on the table-editing ops (`insertTableRow`
 *   etc.) a table element's handlers call, and board paste already
 *   strips tables on the way in. Surfacing `<TablePicker>` would let a
 *   user create a table that then crashes as soon as it's edited.
 */
export function BoardToolbar({ editor, disabled }: BoardToolbarProps) {
  const [insertMode, setInsertMode] = useState<InsertKind | null>(null);

  useEffect(() => {
    if (!editor) return;
    setInsertMode(editor.getInsertMode());
    return editor.onInsertModeChange(() => setInsertMode(editor.getInsertMode()));
  }, [editor]);

  return (
    <Toolbar>
      {/* Select — pressed when insertMode === null (Esc/default state).
          onClick rather than onPressedChange so a second click while
          already in select mode is a no-op instead of toggling to
          undefined. */}
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
            pressed={insertMode === "text"}
            onPressedChange={(pressed) =>
              editor?.setInsertMode(pressed ? "text" : null)
            }
            aria-label="Text box"
            disabled={disabled || !editor}
          >
            <IconLetterT size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Text box</TooltipContent>
      </Tooltip>

      {/* Shape ▾ — active when insertMode is a ShapeKind (not text, and
          not a line-tool kind: connectors / scribble live in Line ▾) */}
      <ShapePicker
        activeKind={
          insertMode && insertMode !== "text" && !isLineToolKind(insertMode)
            ? insertMode
            : null
        }
        onSelect={(kind) => editor?.setInsertMode(kind)}
        disabled={disabled || !editor}
      />

      {/* Line ▾ — connectors + the freehand scribble */}
      <LinePicker
        activeKind={isLineToolKind(insertMode) ? insertMode : null}
        onSelect={(kind) => editor?.setInsertMode(kind)}
        disabled={disabled || !editor}
      />
    </Toolbar>
  );
}

export default BoardToolbar;
