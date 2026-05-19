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
 * ImageControls, TextElementControls, TextStyleGroup, TextFormatGroup,
 * TextParagraphGroup, ArrangeMenu, ShapePicker, LinePicker) so the
 * editing surface area stays in lockstep — no parallel mobile API.
 */

import { useCallback, useState } from "react";
import type { InsertKind, SlidesEditor, SlidesStore, Theme } from "@wafflebase/slides";
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
  TextStyleGroup,
  TextFormatGroup,
  TextParagraphGroup,
} from "@/components/text-formatting";
import type { ToolbarState } from "./state";
import { UndoRedoGroup } from "./global-controls";
import { ShapeControls } from "./shape-controls";
import { ImageControls } from "./image-controls";
import { TextElementControls } from "./text-element-controls";
import { ArrangeMenu } from "./arrange-menu";
import { ShapePicker } from "../shape-picker";
import { LinePicker } from "../line-picker";

export interface MobileSlidesToolbarProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  state: ToolbarState;
  theme?: Theme | null;
  onImagePick: () => void;
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
  onToggleThemePanel?: () => void;
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
  onImagePick,
  onToggleThemePanel,
}: MobileSlidesToolbarProps) {
  return (
    <Toolbar className="flex h-10 items-center gap-1 border-b px-2">
      <UndoRedoGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      <InsertSheet editor={editor} onImagePick={onImagePick} />
      <div className="flex-1" />
      <OverflowMenu onToggleThemePanel={onToggleThemePanel} />
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
    if (!editor || !store || !slideId || state.ids.length === 0) return;
    store.batch(() => store.removeElements(slideId, [...state.ids]));
    editor.setSelection([]);
  }, [editor, store, slideId, state.ids]);

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
      <OverflowMenu onToggleThemePanel={onToggleThemePanel} />
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
      <TextFormatSheet textEditor={textEditor} />
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
}: {
  textEditor: Extract<ToolbarState, { kind: "text-edit" }>["textEditor"];
}) {
  const [open, setOpen] = useState(false);

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
            Block style, font, size, color, list, and alignment controls
            for the active text box.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex flex-wrap items-center gap-1">
            <TextStyleGroup
              editor={textEditor}
              allowedBlockTypes={["paragraph", "heading"]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <TextFormatGroup editor={textEditor} />
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
  onToggleThemePanel,
}: {
  onToggleThemePanel?: () => void;
}) {
  return (
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
          disabled={!onToggleThemePanel}
        >
          Theme…
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          Slide background… (coming soon)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

