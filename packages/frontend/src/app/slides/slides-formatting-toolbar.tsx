import { useCallback, useEffect, useState } from "react";
import {
  resolveFont,
  type Element,
  type InsertKind,
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
  IconSquare,
  IconCircle,
  IconLine,
  IconArrowRight,
  IconLetterT,
  IconPalette,
  IconColorSwatch,
  IconTypography,
} from "@tabler/icons-react";
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

interface InsertButton {
  kind: InsertKind;
  label: string;
  icon: React.ReactNode;
}

const INSERT_BUTTONS: InsertButton[] = [
  { kind: "rect",    label: "Rectangle", icon: <IconSquare size={16} /> },
  { kind: "ellipse", label: "Ellipse",   icon: <IconCircle size={16} /> },
  { kind: "line",    label: "Line",      icon: <IconLine size={16} /> },
  { kind: "arrow",   label: "Arrow",     icon: <IconArrowRight size={16} /> },
  { kind: "text",    label: "Text box",  icon: <IconLetterT size={16} /> },
];

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

  useEffect(() => {
    if (!editor) return;
    setInsertMode(editor.getInsertMode());
    return editor.onInsertModeChange(() => setInsertMode(editor.getInsertMode()));
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      setSelected(null);
      return;
    }
    const refresh = () =>
      setSelected(readSingleSelectedElement(store, editor));
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

  return (
    <Toolbar className="flex h-10 items-center gap-1 border-b px-2">
      {INSERT_BUTTONS.map((b) => (
        <Tooltip key={b.kind}>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={insertMode === b.kind}
              onPressedChange={(pressed) => {
                editor?.setInsertMode(pressed ? b.kind : null);
              }}
              aria-label={b.label}
              disabled={!editor}
            >
              {b.icon}
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>{b.label}</TooltipContent>
        </Tooltip>
      ))}
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
