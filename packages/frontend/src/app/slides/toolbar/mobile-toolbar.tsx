/**
 * Mobile slides toolbar — morphing renderer.
 *
 * State machine (`state.kind`) is shared with the desktop toolbar and
 * computed by `getToolbarState` in `state.ts`:
 *
 * - idle      → +Slide · +Insert (sheet) · ⋮
 * - object    → +Slide · 🎨Format (sheet) · ≡Arrange (dropdown) · ⋮
 * - text-edit → +Slide · B/I/U · Aa Format (sheet) · ✓Done
 *
 * Each contextual sheet reuses the same desktop controls (ShapeControls,
 * ImageControls, TextElementControls, TextFormatGroup,
 * TextParagraphGroup, ArrangeMenu, ShapePicker, LinePicker) so the
 * editing surface area stays in lockstep — no parallel mobile API. The
 * block-style picker is intentionally omitted on both surfaces; see
 * `text-edit-section.tsx` for the rationale.
 */

import { useCallback, useState } from "react";
import type {
  InsertKind,
  SlidesEditor,
  SlidesStore,
  Theme,
} from "@wafflebase/slides";
import { findElementPath } from "@wafflebase/slides";
import {
  IconBold,
  IconCheck,
  IconDotsVertical,
  IconItalic,
  IconLetterT,
  IconLine,
  IconPhoto,
  IconPlus,
  IconShape,
  IconTable,
  IconTrash,
  IconTypography,
  IconUnderline,
} from "@tabler/icons-react";
import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
import {
  TextFormatGroup,
  TextParagraphGroup,
  FontFamilyPicker,
  FontSizePicker,
  useResolvedFontSize,
  useResolvedFontFamily,
  ensureFontLink,
} from "@/components/text-formatting";
import { applySlideFontFamily } from "./apply-font-family";
import type { ToolbarState } from "./state";
import { UndoRedoGroup } from "./global-controls";
import { ShapeControls } from "./shape-controls";
import { ImageControls } from "./image-controls";
import { TextElementControls } from "./text-element-controls";
import { ArrangeMenu } from "./arrange-menu";
import { ShapePicker } from "../shape-picker";
import { LinePicker } from "../line-picker";
import { TablePicker } from "../table-picker";
import { BackgroundPanel } from "../background-panel";
import { useSlideBackground } from "../use-slide-background";

export interface MobileSlidesToolbarProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  state: ToolbarState;
  theme?: Theme | null;
  onImagePick: () => void;
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
  onToggleThemePanel?: () => void;
  onToggleFormatPanel?: () => void;
  onToggleMotionPanel?: () => void;
}

export function MobileSlidesToolbar(props: MobileSlidesToolbarProps) {
  if (props.state.kind === "text-edit") return <TextEditMobileBar {...props} state={props.state} />;
  if (props.state.kind === "object") return <ObjectMobileBar {...props} state={props.state} />;
  return <IdleMobileBar {...props} />;
}

// ---------------------------------------------------------------------------
// Idle
// ---------------------------------------------------------------------------

function IdleMobileBar({
  editor,
  store,
  theme,
  onImagePick,
  upload,
  onToggleThemePanel,
  onToggleFormatPanel,
  onToggleMotionPanel,
}: MobileSlidesToolbarProps) {
  return (
    <Toolbar className="flex h-10 items-center gap-1 border-b px-2">
      <UndoRedoGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      <InsertSheet editor={editor} onImagePick={onImagePick} />
      <div className="flex-1" />
      <OverflowMenu
        editor={editor}
        store={store}
        theme={theme}
        upload={upload}
        onToggleThemePanel={onToggleThemePanel}
        onToggleFormatPanel={onToggleFormatPanel}
        onToggleMotionPanel={onToggleMotionPanel}
      />
    </Toolbar>
  );
}

// ---------------------------------------------------------------------------
// Object
// ---------------------------------------------------------------------------

function ObjectMobileBar({
  editor,
  store,
  state,
  theme,
  onImagePick,
  upload,
  onToggleThemePanel,
  onToggleFormatPanel,
  onToggleMotionPanel,
}: MobileSlidesToolbarProps & {
  state: Extract<ToolbarState, { kind: "object" }>;
}) {
  // Same "single group selected" check the desktop ObjectSection performs
  // — drives whether Ungroup is enabled in the Arrange menu.
  const slideId = editor?.getCurrentSlideId();
  const slide =
    store && slideId
      ? store.read().slides.find((s) => s.id === slideId)
      : undefined;
  const canUngroup =
    !!slide &&
    state.ids.length === 1 &&
    (() => {
      const path = findElementPath(slide.elements, state.ids[0]);
      return path?.[path.length - 1]?.type === "group";
    })();

  const onDelete = useCallback(() => {
    editor?.deleteSelected();
  }, [editor]);

  return (
    <Toolbar className="flex h-10 items-center gap-1 border-b px-2">
      <UndoRedoGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      <FormatSheet
        editor={editor}
        store={store}
        state={state}
        theme={theme}
        onImagePick={onImagePick}
        upload={upload}
      />
      <ArrangeMenu
        editor={editor}
        selectionSize={state.ids.length}
        canUngroup={canUngroup}
      />
      <div className="flex-1" />
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete selection"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-destructive hover:bg-muted"
      >
        <IconTrash size={16} />
      </button>
      <OverflowMenu
        editor={editor}
        store={store}
        theme={theme}
        upload={upload}
        onToggleThemePanel={onToggleThemePanel}
        onToggleFormatPanel={onToggleFormatPanel}
        onToggleMotionPanel={onToggleMotionPanel}
      />
    </Toolbar>
  );
}

// ---------------------------------------------------------------------------
// Text edit
// ---------------------------------------------------------------------------

function TextEditMobileBar({
  editor,
  store,
  state,
}: MobileSlidesToolbarProps & {
  state: Extract<ToolbarState, { kind: "text-edit" }>;
}) {
  const textEditor = state.textEditor;
  // Read pressed state synchronously; SlidesToolbar's onTextEditingChange +
  // store.onChange listeners trigger a re-render after every applyStyle, so
  // the toggles flip after the click — same staleness model as desktop.
  const sel = textEditor.getSelectionStyle();
  const onBold = useCallback(() => {
    textEditor.applyStyle({ bold: !textEditor.getSelectionStyle().bold });
  }, [textEditor]);
  const onItalic = useCallback(() => {
    textEditor.applyStyle({ italic: !textEditor.getSelectionStyle().italic });
  }, [textEditor]);
  const onUnderline = useCallback(() => {
    textEditor.applyStyle({
      underline: !textEditor.getSelectionStyle().underline,
    });
  }, [textEditor]);

  return (
    <Toolbar className="flex h-10 items-center gap-1 border-b px-2">
      <UndoRedoGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      <Toggle size="sm" pressed={!!sel.bold} onPressedChange={onBold} aria-label="Bold">
        <IconBold size={16} />
      </Toggle>
      <Toggle
        size="sm"
        pressed={!!sel.italic}
        onPressedChange={onItalic}
        aria-label="Italic"
      >
        <IconItalic size={16} />
      </Toggle>
      <Toggle
        size="sm"
        pressed={!!sel.underline}
        onPressedChange={onUnderline}
        aria-label="Underline"
      >
        <IconUnderline size={16} />
      </Toggle>
      <ToolbarSeparator className="mx-1" />
      <TextFormatSheet textEditor={textEditor} editor={editor} />
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => editor?.exitTextEditing()}
        className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
      >
        <IconCheck size={14} />
        Done
      </button>
    </Toolbar>
  );
}

// ---------------------------------------------------------------------------
// Insert sheet (idle)
// ---------------------------------------------------------------------------

function InsertSheet({
  editor,
  onImagePick,
}: {
  editor: SlidesEditor | null;
  onImagePick: () => void;
}) {
  const [open, setOpen] = useState(false);

  const enterMode = useCallback(
    (kind: InsertKind) => {
      editor?.setInsertMode(kind);
      setOpen(false);
    },
    [editor],
  );
  const pickImage = useCallback(() => {
    onImagePick();
    setOpen(false);
  }, [onImagePick]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Insert"
          disabled={!editor}
          className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <IconPlus size={14} />
          Insert
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom,8px)]">
        <SheetHeader>
          <SheetTitle>Insert</SheetTitle>
          <SheetDescription className="sr-only">
            Add a text box, image, shape, or line to the current slide.
          </SheetDescription>
        </SheetHeader>
        <div className="grid grid-cols-2 gap-2 px-4 pb-4">
          <SheetActionButton
            icon={<IconLetterT size={20} />}
            label="Text box"
            onClick={() => enterMode("text")}
            disabled={!editor}
          />
          <SheetActionButton
            icon={<IconPhoto size={20} />}
            label="Image"
            onClick={pickImage}
            disabled={!editor}
          />
          <ShapePicker
            activeKind={null}
            onSelect={(k) => {
              editor?.setInsertMode(k);
              setOpen(false);
            }}
            disabled={!editor}
            trigger={
              <button
                type="button"
                aria-label="Shape"
                disabled={!editor}
                className={SHEET_ACTION_BUTTON_CLASS}
              >
                <IconShape size={20} />
                Shape
              </button>
            }
          />
          <LinePicker
            activeKind={null}
            onSelect={(k) => {
              editor?.setInsertMode(k);
              setOpen(false);
            }}
            disabled={!editor}
            trigger={
              <button
                type="button"
                aria-label="Line"
                disabled={!editor}
                className={SHEET_ACTION_BUTTON_CLASS}
              >
                <IconLine size={20} />
                Line
              </button>
            }
          />
          <TablePicker
            editor={editor}
            disabled={!editor}
            onInsert={() => setOpen(false)}
            trigger={
              <button
                type="button"
                aria-label="Table"
                disabled={!editor}
                className={SHEET_ACTION_BUTTON_CLASS}
              >
                <IconTable size={20} />
                Table
              </button>
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Format sheet (object)
// ---------------------------------------------------------------------------

function FormatSheet({
  editor,
  store,
  state,
  theme,
  onImagePick,
  upload,
}: {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  state: Extract<ToolbarState, { kind: "object" }>;
  theme?: Theme | null;
  onImagePick: () => void;
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
}) {
  const [open, setOpen] = useState(false);
  const isImage = state.selectionType === "image";
  const isText = state.selectionType === "text-element";
  const isShape =
    state.selectionType === "shape" || state.selectionType === "connector";
  const isMixed = state.selectionType === "mixed";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Format"
          className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          disabled={isMixed}
        >
          <IconTypography size={14} />
          Format
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom,8px)]">
        <SheetHeader>
          <SheetTitle>Format</SheetTitle>
          <SheetDescription className="sr-only">
            Edit fill, border, font, and other style attributes for the
            selected element.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {isShape && (
            <div className="flex flex-wrap items-center gap-1">
              <ShapeControls
                editor={editor}
                store={store}
                theme={theme}
                ids={state.ids}
              />
            </div>
          )}
          {isImage && (
            <div className="flex flex-wrap items-center gap-1">
              <ImageControls
                editor={editor}
                store={store}
                ids={state.ids}
                upload={upload}
              />
            </div>
          )}
          {isText && (
            <div className="flex flex-wrap items-center gap-1">
              <TextElementControls
                editor={editor}
                store={store}
                theme={theme}
                ids={state.ids}
              />
            </div>
          )}
          {/* Image element re-uses the same picker the desktop's Replace
              button does. Keep a quick-action here so the user doesn't
              have to hunt inside ImageControls' submenu. */}
          {isImage && (
            <SheetActionButton
              icon={<IconPhoto size={20} />}
              label="Replace image…"
              onClick={() => {
                onImagePick();
                setOpen(false);
              }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Text format sheet (text-edit)
// ---------------------------------------------------------------------------

function TextFormatSheet({
  textEditor,
  editor,
}: {
  textEditor: Extract<ToolbarState, { kind: "text-edit" }>["textEditor"];
  editor: SlidesEditor | null;
}) {
  const [open, setOpen] = useState(false);
  const sizeValue = useResolvedFontSize(textEditor);
  const familyValue = useResolvedFontFamily(textEditor);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Text formatting"
          className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted"
        >
          <IconTypography size={14} />
          Format
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom,8px)]">
        <SheetHeader>
          <SheetTitle>Text formatting</SheetTitle>
          <SheetDescription className="sr-only">
            Font family, size, inline format, color, link, list, and
            alignment controls for the active text box.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {/*
           * Block-style picker + Strikethrough + Highlight intentionally
           * omitted on slides surfaces — see text-edit-section.tsx for
           * rationale (theme/layout owns block-level typography in
           * slides; Strike and Highlight are not first-class needs in
           * a deck). Keep this row mirrored with the desktop text-edit
           * toolbar.
           */}
          <div className="flex flex-wrap items-center gap-1">
            <FontFamilyPicker
              value={familyValue}
              onChange={(family) =>
                applySlideFontFamily(textEditor, family, editor)
              }
              onPrefetch={ensureFontLink}
            />
            <FontSizePicker
              value={sizeValue}
              onChange={(size) => {
                textEditor.applyStyle({ fontSize: size });
                textEditor.focus();
              }}
            />
            <TextFormatGroup
              editor={textEditor}
              showStrikethrough={false}
              showHighlight={false}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <TextParagraphGroup editor={textEditor} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Overflow menu (always-present right-side)
// ---------------------------------------------------------------------------

function OverflowMenu({
  editor,
  store,
  theme,
  upload,
  onToggleThemePanel,
  onToggleFormatPanel,
  onToggleMotionPanel,
}: {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  theme?: Theme | null;
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
  onToggleThemePanel?: () => void;
  onToggleFormatPanel?: () => void;
  onToggleMotionPanel?: () => void;
}) {
  // Only `backgroundOpen` is controlled — the DropdownMenu itself is
  // uncontrolled and auto-closes on select. The background sheet lives
  // outside the menu so it survives the dropdown unmount.
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const slideId = editor?.getCurrentSlideId();
  const canBackground = !!store && !!slideId && !!theme;
  // Theme reads the deck (store); Format/Motion panels need a live editor
  // selection context. Gate the items on real readiness so a tap before
  // the editor/store mounts can't open an empty header-only sheet — the
  // `onToggle*` props are always-defined closures and never gate alone.
  const canTheme = !!onToggleThemePanel && !!store;
  const canPanels = !!store && !!editor;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More slide options"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
          >
            <IconDotsVertical size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Design</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => onToggleThemePanel?.()}
            disabled={!canTheme}
          >
            Theme…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setBackgroundOpen(true)}
            disabled={!canBackground}
          >
            Slide background…
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onToggleFormatPanel?.()}
            disabled={!onToggleFormatPanel || !canPanels}
          >
            Format options…
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onToggleMotionPanel?.()}
            disabled={!onToggleMotionPanel || !canPanels}
          >
            Motion…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {canBackground && (
        <SlideBackgroundSheet
          open={backgroundOpen}
          onOpenChange={setBackgroundOpen}
          store={store!}
          theme={theme!}
          slideId={slideId!}
          upload={upload}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Slide background sheet (toolbar-local)
// ---------------------------------------------------------------------------

/**
 * Mobile bottom-sheet wrapper around the shared `BackgroundPanel`,
 * mirroring the desktop `RightGlobals` slide-background dropdown. Writes
 * through `store.updateSlideBackground` for the current slide; a discrete
 * pick (swatch, image, reset) closes the sheet, live custom-input changes
 * (and gradient-stop drags) keep it open.
 */
function SlideBackgroundSheet({
  open,
  onOpenChange,
  store,
  theme,
  slideId,
  upload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: SlidesStore;
  theme: Theme;
  slideId: string;
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
}) {
  // Single hook instance, lifted here (not inside BackgroundPanel) so the
  // Sheet's onOpenChange can flush an in-flight gradient drag draft via
  // `bg.onFlushGradientDraft()` before the panel unmounts — same pattern
  // as the desktop RightGlobals DropdownMenu.
  const bg = useSlideBackground(store, slideId, theme, () =>
    onOpenChange(false),
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) bg.onFlushGradientDraft();
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom,8px)]">
        <SheetHeader>
          <SheetTitle>Background</SheetTitle>
          <SheetDescription className="sr-only">
            Set the slide background color, gradient, or image.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <BackgroundPanel
            bg={bg}
            theme={theme}
            recentColors={store.read().meta.recentColors}
            upload={upload}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHEET_ACTION_BUTTON_CLASS =
  "inline-flex h-12 items-center gap-3 rounded-md border bg-background px-4 text-sm hover:bg-muted disabled:opacity-50";

function SheetActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={SHEET_ACTION_BUTTON_CLASS}
    >
      {icon}
      {label}
    </button>
  );
}

