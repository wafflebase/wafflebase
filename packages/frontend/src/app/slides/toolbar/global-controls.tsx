import { useEffect, useState, type ComponentType } from "react";
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
import { ToolbarButton } from "@/components/ui/toolbar";
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
          <ToolbarButton
            onClick={() => store?.undo()}
            disabled={!store || !undoable}
            aria-label="Undo"
          >
            <IconArrowBackUp size={16} />
          </ToolbarButton>
        </TooltipTrigger>
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarButton
            onClick={() => store?.redo()}
            disabled={!store || !redoable}
            aria-label="Redo"
          >
            <IconArrowForwardUp size={16} />
          </ToolbarButton>
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
  /**
   * How much room the toolbar's contextual middle takes: `"compact"`
   * with nothing selected (Insert only), `"full"` when an object or a
   * text box is being edited. Decides how wide the toolbar must be
   * before the panel toggles show their text labels — see
   * `PanelToggle`. Defaults to `"full"`, the conservative answer.
   */
  contextWidth?: "compact" | "full";
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
  contextWidth = "full",
}: RightGlobalsProps) {
  const labelled = LABELLED_AT[contextWidth];
  const toggles: PanelToggleProps[] = [
    {
      label: "Format",
      ariaLabel: "Toggle format options",
      tooltip: "Format options",
      icon: IconAdjustmentsAlt,
      pressed: formatPanelOpen,
      onToggle: onToggleFormatPanel,
    },
    {
      label: "Motion",
      ariaLabel: "Toggle motion panel",
      tooltip: "Motion",
      icon: IconSparkles,
      pressed: motionPanelOpen,
      onToggle: onToggleMotionPanel,
    },
    {
      label: "Background",
      ariaLabel: "Toggle slide background",
      tooltip: "Slide background",
      icon: IconBackground,
      pressed: backgroundPanelOpen,
      onToggle: onToggleBackgroundPanel,
    },
    {
      label: "Theme",
      ariaLabel: "Toggle theme picker",
      tooltip: "Theme",
      icon: IconPalette,
      pressed: themePanelOpen,
      onToggle: onToggleThemePanel,
    },
  ];
  return (
    <div className="ml-auto flex items-center gap-0.5" aria-label="Slide style">
      {toggles.map((t) =>
        t.onToggle ? (
          <PanelToggle key={t.label} {...t} labelled={labelled} />
        ) : null,
      )}
    </div>
  );
}

interface PanelToggleProps {
  /** Visible text: the word Google Slides uses for the panel. */
  label: string;
  /**
   * The accessible name, unchanged from the icon-only toggles. It
   * contains `label`, so what a voice-control user reads off the screen
   * still names the control (WCAG 2.5.3, label in name).
   */
  ariaLabel: string;
  tooltip: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  pressed?: boolean;
  onToggle?: () => void;
}

/**
 * Container-query classes per `contextWidth`, written out in full so
 * Tailwind's scanner sees every literal. The widths are measured, not
 * guessed (visual harness, Chromium, system UI font): the four labels
 * cost 287px against 134px of icons. With nothing selected the whole
 * strip needs ~760px, so labels show from 800px. Text-edit is the
 * widest state at ~1290px with labels (~1136px with icons), and a
 * selected table is of the same order, so every non-idle state shows
 * labels from 1300px.
 */
const LABELLED_AT = {
  compact: {
    toggle: "@min-[800px]/slides-toolbar:px-2",
    icon: "@min-[800px]/slides-toolbar:hidden",
    label: "hidden @min-[800px]/slides-toolbar:inline",
  },
  full: {
    toggle: "@min-[1300px]/slides-toolbar:px-2",
    icon: "@min-[1300px]/slides-toolbar:hidden",
    label: "hidden @min-[1300px]/slides-toolbar:inline",
  },
} as const;

type LabelClasses = (typeof LABELLED_AT)[keyof typeof LABELLED_AT];

/**
 * One right-side panel toggle, text-labelled like Google Slides'
 * "Background · Layout · Theme · Transition" row: four look-alike
 * glyphs (sliders, sparkles, a layered square, a palette) were not
 * recognisable to people arriving from there.
 *
 * The words cost ~150px over the icons, and the toolbar morphs. So
 * the label shows only while the toolbar itself (the
 * `@container/slides-toolbar` in `./index.tsx`) is wide enough for the
 * current state (`LABELLED_AT`); below that each toggle falls back to
 * its icon and the tooltip carries the name. It keys on the toolbar,
 * not the viewport, because the sidebar takes a varying share of it.
 * Between the two widths the labels give way to icons once something
 * is selected, which is also what Google Slides does: its
 * Background / Theme row is a no-selection affordance.
 */
function PanelToggle({
  label,
  ariaLabel,
  tooltip,
  icon: Icon,
  pressed,
  onToggle,
  labelled,
}: PanelToggleProps & { labelled: LabelClasses }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={!!pressed}
          onPressedChange={() => onToggle?.()}
          aria-label={ariaLabel}
          className={labelled.toggle}
        >
          <Icon aria-hidden={true} className={labelled.icon} />
          <span className={labelled.label}>{label}</span>
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
