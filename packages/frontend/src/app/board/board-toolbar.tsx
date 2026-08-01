import { useEffect, useRef, useState } from "react";
import type { InsertKind, SlidesEditor } from "@wafflebase/slides";
import { Toggle } from "@/components/ui/toggle";
import { Toolbar } from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { IconPointer, IconLetterT, IconNote, IconPhoto } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  /** Upload + insert the picked/pasted/dropped file at the viewport center. */
  onInsertImage?: (file: File) => void;
}

/**
 * Minimal insert toolbar for the board infinite canvas: Select / Text /
 * Sticky ▾ / Image / Shape ▾ / Line ▾. Mirrors `slides/toolbar/insert-group.tsx`'s
 * wiring against the reused `SlidesEditor`'s `setInsertMode` / `getInsertMode` /
 * `onInsertModeChange` API, minus the one control that doesn't apply to a
 * board:
 *
 * - Table insert is deliberately never exposed here: `YorkieBoardStore`
 *   throws `notSupported()` on the table-editing ops (`insertTableRow`
 *   etc.) a table element's handlers call, and board paste already
 *   strips tables on the way in. Surfacing `<TablePicker>` would let a
 *   user create a table that then crashes as soon as it's edited.
 */
export function BoardToolbar({
  editor,
  disabled,
  onInsertSticky,
  onInsertImage,
}: BoardToolbarProps) {
  const [insertMode, setInsertMode] = useState<InsertKind | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Color chosen from the palette, applied in `onCloseAutoFocus` (below) so
  // the sticky is created only after Radix has finished closing the menu —
  // and with focus restoration prevented, so the new sticky's text caret
  // keeps focus instead of the dropdown trigger stealing it back.
  const pendingStickyColor = useRef<string | null>(null);

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
          <DropdownMenuContent
            align="start"
            className="flex gap-1 p-1"
            onCloseAutoFocus={(e) => {
              const color = pendingStickyColor.current;
              if (!color) return;
              pendingStickyColor.current = null;
              // Skip Radix's default focus restore to the trigger — otherwise
              // it steals focus from the sticky's text caret that
              // `dropStickyAtViewportCenter` (via onInsertSticky) just entered.
              e.preventDefault();
              onInsertSticky?.(color);
            }}
          >
            {STICKY_COLORS.map((c) => (
              <DropdownMenuItem
                key={c.value}
                aria-label={c.name}
                title={c.name}
                className="h-6 w-6 rounded border border-black/10 p-0"
                style={{ backgroundColor: c.value }}
                onSelect={() => {
                  // Defer the actual insert to onCloseAutoFocus; onSelect just
                  // records the choice and lets Radix close the menu.
                  pendingStickyColor.current = c.value;
                }}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Image — opens a file picker; upload + insert is board-view's
          onInsertImage (reuses the slides upload + insert pipeline). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={false}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Insert image"
            disabled={disabled || !editor || !onInsertImage}
          >
            <IconPhoto size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Insert image</TooltipContent>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onInsertImage?.(file);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />

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
