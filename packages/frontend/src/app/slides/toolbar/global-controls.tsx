import { useCallback, useEffect, useState } from "react";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconColorSwatch,
  IconPalette,
} from "@tabler/icons-react";
import type {
  SlidesEditor,
  SlidesStore,
  Theme,
  ThemeColor,
} from "@wafflebase/slides";
import { Toggle } from "@/components/ui/toggle";
import { ToolbarSeparator } from "@/components/ui/toolbar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ThemedColorPicker } from "../themed-color-picker";

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
  theme?: Theme | null;
  /** When true, shows a Done button to exit text editing (Esc-equivalent). */
  isTextEditing?: boolean;
  onToggleThemePanel?: () => void;
  themePanelOpen?: boolean;
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
  theme,
  isTextEditing = false,
  onToggleThemePanel,
  themePanelOpen,
}: RightGlobalsProps) {
  const slideId = editor?.getCurrentSlideId();
  const onBackgroundChange = useCallback(
    (color: ThemeColor) => {
      if (!store || !slideId) return;
      store.batch(() => store.updateSlideBackground(slideId, { fill: color }));
    },
    [store, slideId],
  );

  const hasSlideStyleGroup = !!store;
  const hasPanelGroup = !!onToggleThemePanel;

  return (
    <div className="ml-auto flex items-center gap-1">
      {isTextEditing && (
        <>
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
          {(hasSlideStyleGroup || hasPanelGroup) && (
            <ToolbarSeparator className="mx-1" />
          )}
        </>
      )}
      {hasSlideStyleGroup && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Slide background"
                  disabled={!store || !slideId || !theme}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                  <IconColorSwatch size={16} />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Slide background</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-auto p-2">
            {theme && (
              <ThemedColorPicker
                value={undefined}
                theme={theme}
                onChange={onBackgroundChange}
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
    </div>
  );
}
