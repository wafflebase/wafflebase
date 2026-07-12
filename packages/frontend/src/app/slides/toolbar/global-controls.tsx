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
import { representativeColor, resolveColor } from "@wafflebase/slides";
import { useSlideBackground } from "../use-slide-background";
import { BackgroundPanel } from "../background-panel";
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
import {
  releaseFocusToBody,
  useMenuCloseHandlers,
} from "@/components/menu-focus";
import { ColorSwatchButton } from "@/components/color-swatch-button";

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
  /** Upload pipeline for the Background panel's image picker. */
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
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
 */
export function RightGlobals({
  editor,
  store,
  theme,
  onToggleThemePanel,
  themePanelOpen,
  onToggleFormatPanel,
  formatPanelOpen,
  onToggleMotionPanel,
  motionPanelOpen,
  upload,
}: RightGlobalsProps) {
  const slideId = editor?.getCurrentSlideId();
  // Controlled open state so a discrete pick (swatch, image, reset)
  // closes the palette — the panel's controls are plain <button>s, not
  // DropdownMenuItem.
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const backgroundMenu = useMenuCloseHandlers(releaseFocusToBody);
  // Single hook instance, lifted here (not inside BackgroundPanel) so the
  // DropdownMenu's onOpenChange can flush an in-flight gradient drag draft
  // via `bg.onFlushGradientDraft()` before the panel unmounts. Only a
  // discrete pick closes the palette; live custom-input changes (and the
  // custom blur, which records only) keep it open.
  const bg = useSlideBackground(store, slideId, theme ?? null, () => {
    backgroundMenu.markSwatchClicked();
    setBackgroundOpen(false);
  });

  const hasSlideStyleGroup = !!store;

  // The swatch button's stripe wants a single resolved CSS color even when
  // the background is a gradient — representativeColor collapses a
  // gradient to its first stop so the stripe still shows *something*.
  const currentBackground = bg.backgroundFill
    ? resolveColor(representativeColor(bg.backgroundFill), theme!)
    : undefined;

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
      {hasSlideStyleGroup && (
        <DropdownMenu
          open={backgroundOpen}
          onOpenChange={(open) => {
            // Flush any uncommitted gradient-drag draft before the panel
            // unmounts, so a drag-then-click-away doesn't lose the pick.
            if (!open) bg.onFlushGradientDraft();
            setBackgroundOpen(open);
          }}
        >
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
          <DropdownMenuContent
            align="end"
            className="w-auto p-2"
            onCloseAutoFocus={backgroundMenu.onCloseAutoFocus}
          >
            {theme && (
              <BackgroundPanel
                bg={bg}
                theme={theme}
                recentColors={store?.read().meta.recentColors}
                upload={upload}
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
