import { useCallback, useEffect, useRef, useState } from "react";
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
   * the store has loaded. Resolved by `slides-detail.tsx` from the
   * lifted `currentThemeId` against `store.read().themes`.
   */
  theme?: Theme | null;
  /**
   * Toggles the theme picker side panel. Receives no argument; the
   * parent owns `themePanelOpen` state and flips it. Optional so the
   * toolbar still renders when no panel is wired (e.g. tests).
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
 * the slide id is unknown, or the element id no longer exists. Pickers
 * only apply to single-element selections to keep the value/UX
 * unambiguous in v1.
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
 * toolbar above the slide canvas; reflects the editor's actual
 * insert mode (the editor resets it to null after a placement, so a
 * one-way controlled toolbar would get stuck "pressed").
 *
 * Phase 5 / Task 8 adds two contextual buttons after the insert row:
 *  - **Fill** color picker — visible when a single shape is selected;
 *    writes `data.fill` via `applyShapeFill` (single-batch undo).
 *  - **Font** picker — visible when a single text element is selected;
 *    rewrites every inline run's `fontFamily` to the resolved family.
 *    The `ThemeFont` role is lost on write because docs `InlineStyle`
 *    still stores a string family — extending docs to carry `ThemeFont`
 *    is a follow-up commit, mirroring Task 6's `ThemeColor` extension.
 */
export function SlidesFormattingToolbar({
  editor,
  store,
  theme,
  onToggleThemePanel,
  themePanelOpen,
}: SlidesFormattingToolbarProps) {
  const [insertMode, setInsertMode] = useState<InsertKind | null>(null);
  // Resolved single-selection (slide id + element). `null` when zero
  // or multiple elements are selected, or when the slide isn't loaded
  // yet. Re-read on every selection / slide / store-change tick so the
  // pickers always reflect the latest data.fill / data.kind.
  const [selected, setSelected] = useState<{
    slideId: string;
    element: Element;
  } | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  // Wrappers (not the Toggle itself) carry the click-outside refs —
  // shadcn `Toggle` is a plain function component and does not forward
  // refs in this codebase's version.
  const colorTriggerRef = useRef<HTMLDivElement>(null);
  const fontTriggerRef = useRef<HTMLDivElement>(null);
  const colorPopoverRef = useRef<HTMLDivElement>(null);
  const fontPopoverRef = useRef<HTMLDivElement>(null);

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
    // Store changes (e.g. a remote peer mutated the selected element's
    // fill, or our own picker just wrote to it) need to flow back into
    // `selected.element.data` so the picker's `value` prop tracks the
    // current data. `onChange` is only on YorkieSlidesStore (not the
    // base interface), so guard structurally — MemSlidesStore in tests
    // simply doesn't fire this and the picker still updates on direct
    // selection changes.
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

  // Close popovers when click lands outside trigger + content.
  useEffect(() => {
    if (!colorOpen && !fontOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (colorOpen) {
        const inTrigger = colorTriggerRef.current?.contains(target);
        const inContent = colorPopoverRef.current?.contains(target);
        if (!inTrigger && !inContent) setColorOpen(false);
      }
      if (fontOpen) {
        const inTrigger = fontTriggerRef.current?.contains(target);
        const inContent = fontPopoverRef.current?.contains(target);
        if (!inTrigger && !inContent) setFontOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  }, [colorOpen, fontOpen]);

  // Selection changes close any open popover so the picker doesn't
  // dangle over a now-different element.
  useEffect(() => {
    setColorOpen(false);
    setFontOpen(false);
  }, [selected?.element.id]);

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
      {/* Phase 5b-1 will add an "+ Image" button here.
          Phase 5b-2 will add a "Present" button here.
          Phase 5b-3 will add an "Export PDF" button here. */}
      {/* Contextual: shape fill color picker. Hidden when no single
          shape is selected; rendered as a button + a manual popover
          since the project doesn't ship @radix-ui/react-popover yet. */}
      <div style={{ position: "relative" }} ref={colorTriggerRef}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={colorOpen}
              onPressedChange={(pressed) => setColorOpen(pressed)}
              aria-label="Fill color"
              aria-haspopup="dialog"
              aria-expanded={colorOpen}
              disabled={!isShape || !theme || !store}
            >
              <IconColorSwatch size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Fill color</TooltipContent>
        </Tooltip>
        {colorOpen && theme && isShape && (
          <div
            ref={colorPopoverRef}
            role="dialog"
            aria-label="Fill color picker"
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              zIndex: 50,
              background: "var(--popover, #fff)",
              border: "1px solid var(--border, #e5e5e5)",
              borderRadius: 6,
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              minWidth: 200,
            }}
          >
            <ThemedColorPicker
              value={shapeFillValue}
              theme={theme}
              onChange={(c) => {
                onShapeFillChange(c);
                // Don't close on pick — users often try several swatches.
              }}
            />
          </div>
        )}
      </div>
      <div style={{ position: "relative" }} ref={fontTriggerRef}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={fontOpen}
              onPressedChange={(pressed) => setFontOpen(pressed)}
              aria-label="Font"
              aria-haspopup="dialog"
              aria-expanded={fontOpen}
              disabled={!isText || !theme || !store}
            >
              <IconTypography size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Font</TooltipContent>
        </Tooltip>
        {fontOpen && theme && isText && (
          <div
            ref={fontPopoverRef}
            role="dialog"
            aria-label="Font picker"
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              zIndex: 50,
              background: "var(--popover, #fff)",
              border: "1px solid var(--border, #e5e5e5)",
              borderRadius: 6,
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              minWidth: 220,
            }}
          >
            <ThemedFontPicker
              value={undefined}
              theme={theme}
              onChange={(f) => {
                onTextFontChange(f);
              }}
            />
          </div>
        )}
      </div>
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
