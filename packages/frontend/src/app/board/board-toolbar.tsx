import { useEffect, useState } from "react";
import type { InsertKind, SlidesEditor } from "@wafflebase/slides";
import { Toggle } from "@/components/ui/toggle";
import { Toolbar } from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { IconPointer, IconLetterT, IconNote } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ShapePicker } from "../slides/shape-picker";
import { LinePicker } from "../slides/line-picker";
import { isLineToolKind } from "../slides/line-picker-helpers";
import { STICKY_COLORS } from "./sticky";

export interface BoardToolbarProps {
  editor: SlidesEditor | null;
  disabled?: boolean;
  /** Drop a sticky of the given fill color at the viewport center. */
  onInsertSticky?: (colorValue: string) => void;
}

/**
 * Minimal insert toolbar for the board infinite canvas: Select / Text /
 * Sticky ▾ / Shape ▾ / Line ▾. Mirrors `slides/toolbar/insert-group.tsx`'s wiring
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
export function BoardToolbar({ editor, disabled, onInsertSticky }: BoardToolbarProps) {
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

      {/* Sticky note ▾ — main click drops the first (yellow) color;
          chevron opens the 6-color palette. Placement + text-edit entry
          is board-local (dropStickyAtViewportCenter), not an editor
          InsertKind, so the slides editor is untouched. */}
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              aria-label="Sticky note"
              disabled={disabled || !editor}
              onClick={() => onInsertSticky?.(STICKY_COLORS[0].value)}
            >
              <IconNote size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sticky note</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-5 px-0"
              aria-label="Sticky note color"
              disabled={disabled || !editor}
            >
              <span aria-hidden>▾</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="flex gap-1 p-1">
            {STICKY_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={c.name}
                title={c.name}
                className="h-6 w-6 rounded border border-black/10"
                style={{ backgroundColor: c.value }}
                onClick={() => onInsertSticky?.(c.value)}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
