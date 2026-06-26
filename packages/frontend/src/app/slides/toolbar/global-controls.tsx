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
import { resolveColor } from "@wafflebase/slides";
import { useSlideBackground } from "../use-slide-background";
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
}: RightGlobalsProps) {
  const slideId = editor?.getCurrentSlideId();
  // Controlled open state so the swatch click closes the palette — the
  // color swatches are plain <button>s, not DropdownMenuItem.
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const backgroundMenu = useMenuCloseHandlers(releaseFocusToBody);
  // Only a discrete swatch pick closes the palette; live custom-input
  // changes (and the custom blur, which records only) keep it open.
  const { backgroundFill, onChange: onBackgroundChange } = useSlideBackground(
    store,
    slideId,
    theme ?? null,
    () => {
      backgroundMenu.markSwatchClicked();
      setBackgroundOpen(false);
    },
  );

  const hasSlideStyleGroup = !!store;

  // The raw ThemeColor drives the picker's "active" swatch marker, and its
  // resolved CSS string drives the swatch button's stripe. Both fall back to
  // undefined (empty outlined slot / no marker) when nothing is known yet.
  const currentBackground = backgroundFill
    ? resolveColor(backgroundFill, theme!)
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
        <DropdownMenu open={backgroundOpen} onOpenChange={setBackgroundOpen}>
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
              <ThemedColorPicker
                value={backgroundFill}
                theme={theme}
                onChange={onBackgroundChange}
                recentColors={store?.read().meta.recentColors}
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
