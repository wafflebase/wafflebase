import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { InsertKind, SlidesEditor } from "@wafflebase/slides";
import {
  IconChevronDown,
  IconDots,
  IconHandStop,
  IconLetterT,
  IconNote,
  IconPhoto,
  IconPointer,
} from "@tabler/icons-react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
import { useCanvasFocusRelease } from "@/components/toolbar-focus-release";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ShapePicker } from "../slides/shape-picker";
import { LinePicker } from "../slides/line-picker";
import { isLineToolKind } from "../slides/line-picker-helpers";
import { STICKY_COLORS } from "./sticky";
import { TOOL_HINTS } from "./board-shortcuts";
import type { HandTool } from "./board-hand";
import type { InkTool } from "./board-ink";
import { BoardEraserToggle, BoardInkControls } from "./board-ink-controls";
import { useSectionToolArmed, type BoardSections } from "./board-sections";
import { SectionToolToggle } from "./board-section-toolbar";
import { BOARD_LINE_EXCLUDE, BOARD_LINE_LABELS } from "./board-vocabulary";
import { BOARD_SHAPES } from "./board-shapes";
import { BOARD_OVERLAY_ATTR } from "./fit-insets";
import { BoardLassoToggle } from "./board-drawing-controls";
import type { DrawingTools } from "./board-drawing-extras";
import { useToggleOn } from "./use-toggle-on";
import { dockLayout, type DockLayout } from "./board-dock-layout";

/** Shape and line tool keys, spoken in the pickers' tooltips. */
const SHAPE_HINT = "R, O";
const LINE_HINT = "L, Shift+L, X";

export interface BoardToolDockProps {
  editor: SlidesEditor | null;
  /** The hand (drag-to-pan) tool, shared with the board's `H` key. */
  hand?: HandTool | null;
  /** The marker / highlighter pen choice, shared with the M keys. */
  ink?: InkTool | null;
  /** The laser pointer and lasso-select toggles (`board-drawing-extras.ts`). */
  drawingTools?: DrawingTools | null;
  /** Board sections: the section tool (Shift+S). */
  sections?: BoardSections | null;
  disabled?: boolean;
  /** Drop a sticky of the given fill color at the viewport center. */
  onInsertSticky?: (colorValue: string) => void;
  /** Upload + insert the picked file at the viewport center. */
  onInsertImage?: (file: File) => void;
  /** Board tools owned outside this file (stamps / voting / comments). */
  extraTools?: ReactNode;
  /** One of `extraTools` is armed, so Select is not the live tool. */
  extraToolArmed?: boolean;
  /**
   * Disarms `extraTools`; called when Select is clicked. Deliberately not
   * an `on*` name: it is plumbing between two tool owners, not a control
   * a host may leave unwired (the UI-hunter rubric treats every optional
   * `on*` prop as one, see `scripts/agent-arms/hunt-ui.test.mjs`).
   */
  disarmExtraTools?: () => void;
}

/**
 * Tracks the dock's placement against its host (the canvas wrapper it is
 * absolutely positioned in) and its own natural width. Without a
 * `ResizeObserver` (jsdom) it keeps the wide default.
 */
function useDockLayout(dockRef: React.RefObject<HTMLDivElement | null>): DockLayout {
  const [layout, setLayout] = useState<DockLayout>(() => dockLayout(0, 0));
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const host = dock?.parentElement;
    if (!dock || !host || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = dockLayout(host.clientWidth, dock.scrollWidth);
      setLayout((prev) =>
        prev.compact === next.compact &&
        prev.align === next.align &&
        prev.maxWidth === next.maxWidth
          ? prev
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [dockRef]);
  return layout;
}

/**
 * Arrow keys move between the dock's controls (the WAI-ARIA toolbar
 * pattern); Tab still reaches every one of them, so nothing depends on
 * knowing the arrows. Home/End jump to the ends.
 */
function onDockKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const buttons = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
  );
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? buttons.length - 1
        : (at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
  e.preventDefault();
  e.stopPropagation();
  buttons[next]?.focus();
}

/**
 * The board's tool dock: every insert tool, floating bottom-centre over
 * the canvas (FigJam, Miro). The top bar keeps the view and contextual
 * controls (see `board-toolbar.tsx`).
 *
 * ```text
 * [Select][Lasso][Hand] │ [Sticky▾][Text][Shape▾][Line▾] │ [Marker▾][Eraser] │ [Section][Image] │ [Stamp▾][Comment]
 * ```
 *
 * Below 640px the rarer tools (Lasso, Hand, Line, Eraser, Section, Image and the
 * rituals) fold under "More", so a phone shows
 * `[Select][Sticky▾][Text][Shape▾][Marker▾][More]`.
 *
 * Marked `data-board-overlay` so a fit keeps content out from under it,
 * and `data-canvas-toolbar` so a click hands the keyboard back to the
 * canvas (issue #882).
 */
export function BoardToolDock({
  editor,
  hand = null,
  ink = null,
  drawingTools = null,
  sections = null,
  disabled,
  onInsertSticky,
  onInsertImage,
  extraTools,
  extraToolArmed = false,
  disarmExtraTools,
}: BoardToolDockProps) {
  const dockRef = useRef<HTMLDivElement>(null);
  const layout = useDockLayout(dockRef);
  const sectionArmed = useSectionToolArmed(sections);
  const laserOn = useToggleOn(drawingTools?.laser);
  const lassoOn = useToggleOn(drawingTools?.lasso);
  const [insertMode, setInsertMode] = useState<InsertKind | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Color chosen from the palette, applied in `onCloseAutoFocus` (below) so
  // the sticky is created only after Radix has finished closing the menu —
  // and with focus restoration prevented, so the new sticky's text caret
  // keeps focus instead of the dropdown trigger stealing it back.
  const pendingStickyColor = useRef<string | null>(null);

  // Hand focus back to the board after a pointer interaction with the
  // dock (issue #882). Keyboard (Tab) focus is left alone.
  useCanvasFocusRelease();

  const [handOn, setHandOn] = useState(() => hand?.get() ?? false);
  useEffect(() => {
    if (!hand) return;
    setHandOn(hand.get());
    return hand.subscribe(() => setHandOn(hand.get()));
  }, [hand]);

  useEffect(() => {
    if (!editor) return;
    setInsertMode(editor.getInsertMode());
    return editor.onInsertModeChange(() => setInsertMode(editor.getInsertMode()));
  }, [editor]);

  const off = disabled || !editor;
  const lineArmed = isLineToolKind(insertMode) && insertMode !== "freeform";

  const select = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          // onClick rather than onPressedChange so a second click while
          // already in select mode is a no-op instead of toggling off.
          pressed={
            insertMode === null && !handOn && !sectionArmed && !extraToolArmed &&
            !laserOn && !lassoOn
          }
          onClick={() => {
            drawingTools?.laser.set(false);
            drawingTools?.lasso.set(false);
            hand?.set(false);
            sections?.tool.set(false);
            editor?.setInsertMode(null);
            disarmExtraTools?.();
          }}
          aria-label="Select"
          disabled={off}
        >
          <IconPointer size={16} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>Select ({TOOL_HINTS.select})</TooltipContent>
    </Tooltip>
  );

  // Free lasso (Alt+drag does the same without arming it); next to Select
  // since it is a way of selecting.
  const lasso = <BoardLassoToggle tool={drawingTools?.lasso ?? null} disabled={off} />;

  // Board-local state (see `board-hand.ts`); arming it disarms any insert
  // tool, and vice versa.
  const handToggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={handOn}
          onPressedChange={(pressed) => hand?.set(pressed)}
          aria-label="Hand"
          disabled={!hand || !editor}
        >
          <IconHandStop size={16} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>Hand ({TOOL_HINTS.hand})</TooltipContent>
    </Tooltip>
  );

  // Main click drops the first (yellow) color; the chevron opens the
  // 6-color palette. Placement + text-edit entry is board-local
  // (`dropStickyAtViewportCenter`), not an editor InsertKind.
  const sticky = (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            aria-label="Sticky note"
            disabled={off}
            onClick={() => onInsertSticky?.(STICKY_COLORS[0].value)}
          >
            <IconNote size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Sticky note ({TOOL_HINTS.sticky})</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-5 px-0"
            aria-label="Sticky note color"
            disabled={off}
          >
            <IconChevronDown size={12} aria-hidden="true" className="opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="flex gap-1 p-1"
          onCloseAutoFocus={(e) => {
            const color = pendingStickyColor.current;
            if (!color) return;
            pendingStickyColor.current = null;
            // Skip Radix's focus restore to the trigger, which would steal
            // focus from the new sticky's text caret.
            e.preventDefault();
            onInsertSticky?.(color);
          }}
        >
          {STICKY_COLORS.map((c) => (
            <DropdownMenuItem
              key={c.value}
              aria-label={c.name}
              title={c.name}
              // Portalled, so the dock's coarse rule does not reach it.
              className="size-7 rounded border border-black/15 p-0 pointer-coarse:size-11"
              style={{ backgroundColor: c.value }}
              onSelect={() => {
                pendingStickyColor.current = c.value;
              }}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const text = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={insertMode === "text"}
          onPressedChange={(pressed) => editor?.setInsertMode(pressed ? "text" : null)}
          aria-label="Text box"
          disabled={off}
        >
          <IconLetterT size={16} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>Text box ({TOOL_HINTS.text})</TooltipContent>
    </Tooltip>
  );

  // Active when insertMode is a ShapeKind: not text, not the eraser, and
  // not a line-tool kind (connectors live in Line ▾, freehand in Marker).
  const shape = (
    <ShapePicker
      activeKind={
        insertMode &&
        insertMode !== "text" &&
        insertMode !== "eraser" &&
        !isLineToolKind(insertMode)
          ? insertMode
          : null
      }
      onSelect={(kind) => editor?.setInsertMode(kind)}
      disabled={off}
      featured={BOARD_SHAPES}
      tooltip={`Shape (${SHAPE_HINT})`}
    />
  );

  const line = (
    <LinePicker
      activeKind={lineArmed ? insertMode : null}
      onSelect={(kind) => editor?.setInsertMode(kind)}
      disabled={off}
      labels={BOARD_LINE_LABELS}
      exclude={BOARD_LINE_EXCLUDE}
      tooltip={`Line (${LINE_HINT})`}
    />
  );

  const inkGroup = (
    <BoardInkControls
      editor={editor}
      ink={ink}
      insertMode={insertMode}
      disabled={disabled}
      withEraser={!layout.compact}
      laser={drawingTools?.laser ?? null}
    />
  );

  const eraser = (
    <BoardEraserToggle editor={editor} insertMode={insertMode} disabled={disabled} />
  );

  const section = <SectionToolToggle sections={sections} disabled={off} />;

  // Opens a file picker; upload + insert is board-view's onInsertImage.
  // The <input> itself stays at the dock root (below), so it outlives the
  // "More" popover closing while the system file dialog is up.
  const image = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={false}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Insert image"
          disabled={off || !onInsertImage}
        >
          <IconPhoto size={16} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>Insert image</TooltipContent>
    </Tooltip>
  );

  const moreArmed =
    handOn || lassoOn || lineArmed || insertMode === "eraser" || sectionArmed ||
    extraToolArmed;

  return (
    <Toolbar
      ref={dockRef}
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="horizontal"
      data-canvas-toolbar=""
      {...{ [BOARD_OVERLAY_ATTR]: "" }}
      onKeyDown={onDockKeyDown}
      className={cn(
        "absolute bottom-3 z-20 rounded-lg border bg-background px-1 shadow-md",
        layout.align === "center" ? "left-1/2 -translate-x-1/2" : "left-3",
      )}
      style={{ maxWidth: layout.maxWidth }}
    >
      {select}
      {!layout.compact && lasso}
      {!layout.compact && handToggle}
      <ToolbarSeparator className="mx-1" />
      {sticky}
      {text}
      {shape}
      {!layout.compact && line}
      <ToolbarSeparator className="mx-1" />
      {inkGroup}
      {layout.compact ? (
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="More tools"
                  // A folded tool is live: say so on the trigger, which is
                  // the only part of it on screen.
                  className={cn(
                    "h-8 px-2",
                    moreArmed && "bg-selected text-selected-foreground",
                  )}
                >
                  <IconDots size={16} />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>More tools</TooltipContent>
          </Tooltip>
          <PopoverContent
            side="top"
            align="end"
            data-canvas-toolbar=""
            aria-label="More tools"
            className="flex w-auto max-w-[calc(100vw-2rem)] flex-wrap items-center gap-0.5 p-1"
            // A tool picked here closes the popover, so the canvas is free
            // for it; a control that opens a menu of its own (Line ▾,
            // Stamp ▾) keeps it open, or its menu would unmount with it.
            onClick={(e) => {
              const button = (e.target as Element).closest("button");
              if (button && !button.hasAttribute("aria-haspopup")) setMoreOpen(false);
            }}
          >
            {lasso}
            {handToggle}
            {line}
            {eraser}
            {section}
            {image}
            {extraTools}
          </PopoverContent>
        </Popover>
      ) : (
        <>
          <ToolbarSeparator className="mx-1" />
          {section}
          {image}
          {extraTools}
        </>
      )}
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
    </Toolbar>
  );
}
