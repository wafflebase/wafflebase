import { useEffect, useState } from "react";
import { IconArrowBackUp, IconArrowForwardUp, IconPalette } from "@tabler/icons-react";
import type { SlidesEditor, SlidesStore } from "@wafflebase/slides";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { PresentButton } from "../slides-present-button";

// ---------------------------------------------------------------------------
// UndoRedoGroup
// ---------------------------------------------------------------------------

export interface UndoRedoGroupProps {
  store: SlidesStore | null;
}

/**
 * Undo (↶) and Redo (↷) buttons wired to the store's undo/redo stack.
 * Subscribes to store.onChange (when available) so the enabled state
 * tracks the stack in real time.
 */
export function UndoRedoGroup({ store }: UndoRedoGroupProps) {
  const [undoable, setUndoable] = useState(false);
  const [redoable, setRedoable] = useState(false);

  useEffect(() => {
    if (!store) {
      setUndoable(false);
      setRedoable(false);
      return;
    }
    const refresh = () => {
      setUndoable(store.canUndo());
      setRedoable(store.canRedo());
    };
    refresh();
    return store.onChange?.(refresh);
  }, [store]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => store?.undo()}
            disabled={!store || !undoable}
            aria-label="Undo"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconArrowBackUp size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => store?.redo()}
            disabled={!store || !redoable}
            aria-label="Redo"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconArrowForwardUp size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Redo</TooltipContent>
      </Tooltip>
    </>
  );
}

// ---------------------------------------------------------------------------
// RightGlobals
// ---------------------------------------------------------------------------

export interface RightGlobalsProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  /** When true, shows a Done button to exit text editing (Esc-equivalent). */
  isTextEditing?: boolean;
  onToggleThemePanel?: () => void;
  themePanelOpen?: boolean;
  onStartPresentation?: (from: "current" | "first") => void;
  slideCount?: number;
}

/**
 * Right-aligned global controls: Theme panel toggle + Present split-button.
 * When isTextEditing is true, also renders a Done button before the theme
 * toggle that exits text editing (equivalent to pressing Escape).
 * Aligned to the right of the toolbar via ml-auto on the wrapper.
 */
export function RightGlobals({
  editor,
  store,
  isTextEditing = false,
  onToggleThemePanel,
  themePanelOpen,
  onStartPresentation,
  slideCount = 0,
}: RightGlobalsProps) {
  return (
    <div className="ml-auto flex items-center gap-1">
      {isTextEditing && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor?.exitTextEditing()}
              aria-label="Done editing text"
              className="inline-flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Done
            </button>
          </TooltipTrigger>
          <TooltipContent>Exit text edit (Esc)</TooltipContent>
        </Tooltip>
      )}
      {onToggleThemePanel && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={!!themePanelOpen}
              onPressedChange={() => onToggleThemePanel()}
              aria-label="Toggle theme picker"
            >
              <IconPalette size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Theme</TooltipContent>
        </Tooltip>
      )}
      {onStartPresentation && (
        <PresentButton
          disabled={!store || slideCount === 0}
          onStart={onStartPresentation}
        />
      )}
    </div>
  );
}
