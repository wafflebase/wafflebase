import { useEffect, useState } from "react";
import {
  IconAdjustmentsAlt,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBackground,
  IconPalette,
  IconSparkles,
} from "@tabler/icons-react";
import type { SlidesEditor, SlidesStore, Theme } from "@wafflebase/slides";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

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
  onToggleFormatPanel?: () => void;
  formatPanelOpen?: boolean;
  onToggleMotionPanel?: () => void;
  motionPanelOpen?: boolean;
  onToggleBackgroundPanel?: () => void;
  backgroundPanelOpen?: boolean;
}

/**
 * Right-side cluster, in order: Format options ▸ Motion ▸ Slide
 * background ▸ Theme. Object-level controls (Format, Motion) lead, then
 * the deck-level "what does this look like?" controls (Slide background,
 * Theme).
 *
 * Mirrors Google Slides' arrangement of the "what does this deck look
 * like?" controls so they read as one group. Layout was tried here
 * during this PR's smoke test and removed (the context menu and
 * thumbnail-panel chevron already cover layout-change). Zoom moved
 * out to the toolbar's left edge (closer to Undo/Redo / Format
 * painter); Done moved into the text-edit contextual section so it
 * doesn't sit among slide-style controls. `aria-label` on the wrapper
 * lets tests anchor on the cluster without relying on visual order.
 *
 * Background is a right-side PANEL like Format/Motion/Theme (not a
 * DropdownMenu here) — the actual `useSlideBackground` instance now
 * lives in `BackgroundSidePanel`, mounted by `slides-detail.tsx`
 * alongside the other panels, so this component only renders the toggle.
 */
export function RightGlobals({
  onToggleThemePanel,
  themePanelOpen,
  onToggleFormatPanel,
  formatPanelOpen,
  onToggleMotionPanel,
  motionPanelOpen,
  onToggleBackgroundPanel,
  backgroundPanelOpen,
}: RightGlobalsProps) {
  return (
    <div
      className="ml-auto flex items-center gap-1"
      aria-label="Slide style"
    >
      {onToggleFormatPanel && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={!!formatPanelOpen}
              onPressedChange={() => onToggleFormatPanel()}
              aria-label="Toggle format options"
            >
              <IconAdjustmentsAlt size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Format options</TooltipContent>
        </Tooltip>
      )}
      {onToggleMotionPanel && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={!!motionPanelOpen}
              onPressedChange={() => onToggleMotionPanel()}
              aria-label="Toggle motion panel"
            >
              <IconSparkles size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Motion</TooltipContent>
        </Tooltip>
      )}
      {onToggleBackgroundPanel && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={!!backgroundPanelOpen}
              onPressedChange={() => onToggleBackgroundPanel()}
              aria-label="Toggle slide background"
            >
              <IconBackground size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Background</TooltipContent>
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
    </div>
  );
}
