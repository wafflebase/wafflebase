import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBackground,
  IconPalette,
} from "@tabler/icons-react";
import type {
  SlidesEditor,
  SlidesStore,
  Theme,
  ThemeColor,
} from "@wafflebase/slides";
import { resolveColor } from "@wafflebase/slides";
import { Toggle } from "@/components/ui/toggle";
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
import { ColorSwatchButton } from "./color-swatch-button";

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
  onToggleThemePanel?: () => void;
  themePanelOpen?: boolean;
}

/**
 * Right-side slide-style cluster: Slide background ▸ Theme.
 *
 * Mirrors Google Slides' arrangement of the "what does this deck look
 * like?" controls so they read as one group. Layout was tried here
 * during this PR's smoke test and removed (the context menu and
 * thumbnail-panel chevron already cover layout-change). Zoom moved
 * out to the toolbar's left edge (closer to Undo/Redo / Format
 * painter); Done moved into the text-edit contextual section so it
 * doesn't sit among slide-style controls. `aria-label` on the wrapper
 * lets tests anchor on the cluster without relying on visual order.
 */
export function RightGlobals({
  editor,
  store,
  theme,
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

  // Resolve the current slide's background fill to a CSS color string so
  // the swatch button's stripe always reflects what the user is about to
  // change. Falls back to undefined (renders as the empty outlined slot)
  // when nothing is known yet.
  const currentBackground = useMemo(() => {
    if (!store || !slideId || !theme) return undefined;
    const slide = store.read().slides.find((s) => s.id === slideId);
    const fill = slide?.background?.fill;
    return fill ? resolveColor(fill, theme) : undefined;
  }, [store, slideId, theme]);

  return (
    <div
      className="ml-auto flex items-center gap-1"
      aria-label="Slide style"
    >
      {hasSlideStyleGroup && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <ColorSwatchButton
                  icon={<IconBackground size={14} />}
                  color={currentBackground}
                  label="Slide background"
                  disabled={!store || !slideId || !theme}
                />
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
