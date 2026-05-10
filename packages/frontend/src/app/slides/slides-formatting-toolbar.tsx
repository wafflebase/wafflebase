import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolveFont,
  showLayoutPicker,
  type AlignDirection,
  type DistributeAxis,
  type Element,
  type InsertKind,
  type ShapeKind,
  type SlidesEditor,
  type SlidesStore,
  type Theme,
  type ThemeColor,
  type ThemeFont,
} from "@wafflebase/slides";
import { Toggle } from "@/components/ui/toggle";
import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import {
  IconLetterT,
  IconPalette,
  IconColorSwatch,
  IconTypography,
  IconPlus,
  IconPointer,
  IconChevronDown,
  IconLayoutAlignLeft,
  IconLayoutAlignCenter,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutAlignMiddle,
  IconLayoutAlignBottom,
  IconLayoutDistributeHorizontal,
  IconLayoutDistributeVertical,
} from "@tabler/icons-react";
import { ShapePicker } from "./shape-picker";
import { ThemedColorPicker } from "./themed-color-picker";
import { ThemedFontPicker } from "./themed-font-picker";
import {
  applyShapeFill,
  readShapeFill,
} from "./themed-color-picker-helpers";

interface SlidesFormattingToolbarProps {
  editor: SlidesEditor | null;
  /**
   * SlidesStore wired to the same Yorkie document as the editor. Lifted
   * up from `slides-view.tsx` via `onStoreReady` so the contextual
   * pickers can mutate element data without bypassing the editor's
   * commit path. Optional to keep tests + early-mount frames safe.
   */
  store?: SlidesStore | null;
  /**
   * Active document theme — used by the color/font pickers to render
   * their "Theme" rows. Optional so the toolbar still renders before
   * the store has loaded.
   */
  theme?: Theme | null;
  /**
   * Toggles the theme picker side panel. The parent owns
   * `themePanelOpen` state and flips it.
   */
  onToggleThemePanel?: () => void;
  themePanelOpen?: boolean;
}

/**
 * Read the single selected element on the active slide. Returns null
 * when there's no selection, the selection spans multiple elements,
 * the slide id is unknown, or the element id no longer exists.
 */
function readSingleSelectedElement(
  store: SlidesStore | null | undefined,
  editor: SlidesEditor | null,
): { slideId: string; element: Element } | null {
  if (!store || !editor) return null;
  const selection = editor.getSelection();
  if (selection.length !== 1) return null;
  const slideId = editor.getCurrentSlideId();
  if (!slideId) return null;
  const doc = store.read();
  const slide = doc.slides.find((s) => s.id === slideId);
  if (!slide) return null;
  const element = slide.elements.find((e) => e.id === selection[0]);
  if (!element) return null;
  return { slideId, element };
}

/**
 * Slides equivalent of `DocsFormattingToolbar`. Renders the insert
 * toolbar above the slide canvas and surfaces three contextual
 * controls:
 *   - Fill color picker (shape selected, or hint when none)
 *   - Font picker (text selected, or hint when none)
 *   - Theme panel toggle (always visible)
 *
 * Picker popovers use `DropdownMenu` (Radix) so they portal to body
 * and don't get clipped by the toolbar's overflow context — same
 * pattern as docs / sheets toolbars.
 */
export function SlidesFormattingToolbar({
  editor,
  store,
  theme,
  onToggleThemePanel,
  themePanelOpen,
}: SlidesFormattingToolbarProps) {
  const [insertMode, setInsertMode] = useState<InsertKind | null>(null);
  const [selected, setSelected] = useState<{
    slideId: string;
    element: Element;
  } | null>(null);
  const [selectionSize, setSelectionSize] = useState<number>(0);

  useEffect(() => {
    if (!editor) return;
    setInsertMode(editor.getInsertMode());
    return editor.onInsertModeChange(() => setInsertMode(editor.getInsertMode()));
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      setSelected(null);
      setSelectionSize(0);
      return;
    }
    const refresh = () => {
      setSelected(readSingleSelectedElement(store, editor));
      setSelectionSize(editor.getSelection().length);
    };
    refresh();
    const offSel = editor.onSelectionChange(refresh);
    const offSlide = editor.onCurrentSlideChange(refresh);
    const onChange = (
      store as { onChange?: (cb: () => void) => () => void } | null | undefined
    )?.onChange;
    const offStore = onChange?.call(store, refresh);
    return () => {
      offSel();
      offSlide();
      offStore?.();
    };
  }, [editor, store]);

  const isShape = selected?.element.type === "shape";
  const isText = selected?.element.type === "text";

  const onShapeFillChange = useCallback(
    (color: ThemeColor) => {
      if (!store || !selected || selected.element.type !== "shape") return;
      applyShapeFill(store, selected.slideId, selected.element, color);
    },
    [store, selected],
  );

  const onTextFontChange = useCallback(
    (font: ThemeFont) => {
      if (!store || !selected || selected.element.type !== "text" || !theme) {
        return;
      }
      const family = resolveFont(font, theme);
      const slideId = selected.slideId;
      const elementId = selected.element.id;
      store.batch(() => {
        store.withTextElement(slideId, elementId, (blocks) =>
          blocks.map((b) => ({
            ...b,
            inlines: b.inlines.map((run) => ({
              ...run,
              style: { ...run.style, fontFamily: family },
            })),
          })),
        );
      });
    },
    [store, selected, theme],
  );

  const shapeFillValue = isShape ? readShapeFill(selected!.element) : undefined;
  const fillHint = isShape ? undefined : "Select a shape to apply the fill.";
  const fontHint = isText ? undefined : "Select a text element to apply the font.";

  // Anchor the layout picker popover off the chevron button so it
  // opens flush with the split button rather than at click coords.
  const layoutChevronRef = useRef<HTMLButtonElement | null>(null);
  // Close handle returned by the open picker, or null when closed.
  // Drives both the toggle behavior (second chevron click closes) and
  // the unmount cleanup (so the popover and its document listeners
  // don't outlive the toolbar when the user navigates away mid-pick).
  const pickerCloseRef = useRef<(() => void) | null>(null);
  const onAddBlankSlide = useCallback(() => {
    if (!store) return;
    store.batch(() => store.addSlide("blank"));
  }, [store]);
  const onAlign = useCallback(
    (direction: AlignDirection) => {
      editor?.align(direction);
    },
    [editor],
  );
  const onDistribute = useCallback(
    (axis: DistributeAxis) => {
      editor?.distribute(axis);
    },
    [editor],
  );
  const onOpenLayoutPicker = useCallback(() => {
    if (!store) return;
    if (pickerCloseRef.current) {
      pickerCloseRef.current();
      return;
    }
    const el = layoutChevronRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    pickerCloseRef.current = showLayoutPicker(document.body, {
      store,
      // Skip the picker's outside-click-close when the user clicks
      // the chevron itself; the chevron's own onClick toggles via the
      // close handle without the capture-phase race.
      trigger: el,
      anchor: { x: rect.left, y: rect.bottom + 4 },
      onPick: (layoutId) => {
        store.batch(() => store.addSlide(layoutId));
      },
      onClose: () => {
        pickerCloseRef.current = null;
      },
    });
  }, [store]);
  // Close the popover if the toolbar unmounts mid-pick — otherwise
  // the document listeners in showLayoutPicker outlive their consumer.
  useEffect(() => () => pickerCloseRef.current?.(), []);

  return (
    <Toolbar className="flex h-10 items-center gap-1 border-b px-2">
      {/* New slide split-button — primary adds a blank slide; chevron
          opens the layout picker. */}
      <div className="inline-flex items-center rounded-md border">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onAddBlankSlide}
              disabled={!store}
              aria-label="Add slide"
              className="inline-flex h-7 items-center gap-1 rounded-l-md px-2 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <IconPlus size={16} />
              <span className="text-xs">Slide</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>Add slide</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={layoutChevronRef}
              type="button"
              onClick={onOpenLayoutPicker}
              disabled={!store}
              aria-label="Choose a layout"
              className="inline-flex h-7 w-6 items-center justify-center rounded-r-md border-l hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <IconChevronDown size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Choose a layout</TooltipContent>
        </Tooltip>
      </div>
      <ToolbarSeparator className="mx-1" />

      {/* Select / Text / Shape form an exclusive insert-mode group.
          Select is pressed when insertMode === null (i.e. ESC state); a
          click is idempotent — clicking it while already in select mode
          is a no-op. The Toggle component would untoggle on second click
          (giving us insertMode === undefined briefly), so we wire onClick
          directly and read `pressed` from insertMode. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={insertMode === null}
            onClick={() => editor?.setInsertMode(null)}
            aria-label="Select"
            disabled={!editor}
          >
            <IconPointer size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Select (Esc)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={insertMode === "text"}
            onPressedChange={(pressed) => {
              editor?.setInsertMode(pressed ? "text" : null);
            }}
            aria-label="Text box"
            disabled={!editor}
          >
            <IconLetterT size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Text box</TooltipContent>
      </Tooltip>
      <ShapePicker
        activeKind={
          insertMode && insertMode !== "text"
            ? (insertMode as ShapeKind)
            : null
        }
        onSelect={(kind) => editor?.setInsertMode(kind)}
        disabled={!editor}
      />
      <ToolbarSeparator className="mx-1" />

      {/* Align (6) + distribute (2) — momentary actions, not toggles.
          Align disabled when nothing is selected; distribute requires
          3+ selected elements (matches editor.distribute() semantics
          and Google Slides' ergonomics). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onAlign("left")}
            disabled={!editor || selectionSize === 0}
            aria-label="Align left"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconLayoutAlignLeft size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Align left</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onAlign("center-h")}
            disabled={!editor || selectionSize === 0}
            aria-label="Align center"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconLayoutAlignCenter size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Align center</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onAlign("right")}
            disabled={!editor || selectionSize === 0}
            aria-label="Align right"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconLayoutAlignRight size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Align right</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onAlign("top")}
            disabled={!editor || selectionSize === 0}
            aria-label="Align top"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconLayoutAlignTop size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Align top</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onAlign("center-v")}
            disabled={!editor || selectionSize === 0}
            aria-label="Align middle"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconLayoutAlignMiddle size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Align middle</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onAlign("bottom")}
            disabled={!editor || selectionSize === 0}
            aria-label="Align bottom"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconLayoutAlignBottom size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Align bottom</TooltipContent>
      </Tooltip>
      <ToolbarSeparator className="mx-0.5" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onDistribute("horizontal")}
            disabled={!editor || selectionSize < 3}
            aria-label="Distribute horizontally"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconLayoutDistributeHorizontal size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Distribute horizontally (3+ objects)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onDistribute("vertical")}
            disabled={!editor || selectionSize < 3}
            aria-label="Distribute vertically"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconLayoutDistributeVertical size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Distribute vertically (3+ objects)</TooltipContent>
      </Tooltip>
      <ToolbarSeparator className="mx-1" />

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                aria-label="Fill color"
                disabled={!theme || !store}
              >
                <IconColorSwatch size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Fill color</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-auto p-2">
          {theme && (
            <ThemedColorPicker
              value={shapeFillValue}
              theme={theme}
              onChange={onShapeFillChange}
              hint={fillHint}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                aria-label="Font"
                disabled={!theme || !store}
              >
                <IconTypography size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Font</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-auto p-2">
          {theme && (
            <ThemedFontPicker
              value={undefined}
              theme={theme}
              onChange={onTextFontChange}
              hint={fontHint}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {onToggleThemePanel && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={!!themePanelOpen}
              onPressedChange={() => onToggleThemePanel()}
              aria-label="Toggle theme picker"
              className="ml-auto"
            >
              <IconPalette size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Theme</TooltipContent>
        </Tooltip>
      )}
    </Toolbar>
  );
}
