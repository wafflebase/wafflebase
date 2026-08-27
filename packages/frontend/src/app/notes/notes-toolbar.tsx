import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  NoteEditorAPI,
  NoteViewMode,
  NoteInlineFormats,
  NoteKeymap,
} from "@wafflebase/notes";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Toolbar,
  ToolbarSeparator,
  ToolbarButton,
} from "@/components/ui/toolbar";
import { TableGridPicker } from "@/components/table-grid-picker";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  IconPencil,
  IconLayoutColumns,
  IconEye,
  IconChevronDown,
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconLink,
  IconBlockquote,
  IconCode,
  IconFold,
  IconTable,
  IconPhoto,
  IconKeyboard,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconUserCode,
  IconList,
  IconListNumbers,
  IconListCheck,
  IconIndentIncrease,
  IconIndentDecrease,
  IconDotsVertical,
} from "@tabler/icons-react";

const KEYMAPS: { key: NoteKeymap; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "vim", label: "Vim" },
];

const MODES: { mode: NoteViewMode; label: string; Icon: typeof IconEye }[] = [
  { mode: "edit", label: "Editor", Icon: IconPencil },
  { mode: "both", label: "Split", Icon: IconLayoutColumns },
  { mode: "view", label: "Preview", Icon: IconEye },
];

const EMPTY_FORMATS: NoteInlineFormats = {
  bold: false,
  italic: false,
  strikethrough: false,
  link: false,
  list: null,
  canIndent: false,
  canOutdent: false,
};

function TooltipToggle({
  label,
  pressed,
  onToggle,
  children,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={pressed}
          onPressedChange={onToggle}
          className="h-7 w-7 cursor-pointer"
          aria-label={label}
        >
          {children}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Plain (non-toggle) toolbar action with a tooltip and disabled state. */
function TooltipButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolbarButton aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </ToolbarButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Table insert as a hover-grid size picker, mirroring the docs toolbar. */
function TableDropdown({ editor }: { editor: NoteEditorAPI }) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <ToolbarButton aria-label="Insert table">
              <IconTable size={16} />
            </ToolbarButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Insert table</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        ref={contentRef}
        align="start"
        sideOffset={4}
        // Radix focuses the menu container on open; redirect focus to the grid
        // so its arrow-key sizing handler is reachable.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current
            ?.querySelector<HTMLElement>('[role="grid"]')
            ?.focus();
        }}
      >
        <TableGridPicker
          onSelect={(rows, cols) => {
            editor.insertTable(rows, cols);
            editor.focus();
            setOpen(false);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Image insert via a hidden file input — the keyboard/touch equivalent of
 * pasting or dropping a file, which the editor handles on its own. The accept
 * list mirrors the upload endpoint's allowed types so the picker filters what
 * the server would reject anyway.
 *
 * The input is mounted separately from its trigger because there are two
 * triggers: the toolbar button on desktop and the overflow-menu item on
 * mobile. Both open this one input via the ref.
 */
function ImageFileInput({
  inputRef,
  editor,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  editor: NoteEditorAPI;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      multiple
      className="hidden"
      onChange={(e) => {
        if (e.target.files?.length) editor.insertImageFiles(e.target.files);
        // Clear the value so picking the same file again still fires change.
        e.target.value = "";
      }}
    />
  );
}

/**
 * Everything the strip cannot hold on a phone, in one `⋮` menu — the same
 * shape the docs toolbar uses (`docs-formatting-toolbar.tsx`): the inline text
 * formats stay on the strip, the list and insert controls move here under
 * labelled sections.
 *
 * Table is a fixed 3×3 insert rather than the desktop's `TableGridPicker`,
 * which sizes the table by hovering across a grid and so has no touch
 * equivalent. Docs' mobile menu settled on the same 3×3.
 */
function MobileOverflowMenu({
  editor,
  formats,
  onPickImage,
}: {
  editor: NoteEditorAPI;
  formats: NoteInlineFormats;
  onPickImage: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton aria-label="More formatting options">
          <IconDotsVertical size={16} />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        // Radix returns focus to the trigger when the menu closes, which on a
        // phone means the caret leaves the document and the soft keyboard
        // drops — right after the user asked for a formatting change they
        // want to keep typing into. Hand focus back to the editor instead.
        // (`TableDropdown` calls `editor.focus()` inline for the same reason;
        // doing it here covers every item at once.)
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          editor.focus();
        }}
      >
        <DropdownMenuLabel>Lists</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={formats.list === "bullet"}
          onCheckedChange={() => editor.toggleBulletList()}
          className="gap-2"
        >
          <IconList size={16} />
          Bullet list
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={formats.list === "ordered"}
          onCheckedChange={() => editor.toggleOrderedList()}
          className="gap-2"
        >
          <IconListNumbers size={16} />
          Numbered list
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={formats.list === "task"}
          onCheckedChange={() => editor.toggleTaskList()}
          className="gap-2"
        >
          <IconListCheck size={16} />
          Checkbox
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem
          disabled={!formats.canIndent}
          onClick={() => editor.indentList()}
          className="gap-2"
        >
          <IconIndentIncrease size={16} />
          Indent
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!formats.canOutdent}
          onClick={() => editor.outdentList()}
          className="gap-2"
        >
          <IconIndentDecrease size={16} />
          Outdent
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Insert</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={formats.link}
          onCheckedChange={() => editor.toggleLink()}
          className="gap-2"
        >
          <IconLink size={16} />
          Link
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem
          onClick={() => editor.toggleQuote()}
          className="gap-2"
        >
          <IconBlockquote size={16} />
          Quote
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => editor.insertCodeBlock()}
          className="gap-2"
        >
          <IconCode size={16} />
          Code block
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => editor.insertFoldout()}
          className="gap-2"
        >
          <IconFold size={16} />
          Foldout
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => editor.insertTable(3, 3)}
          className="gap-2"
        >
          <IconTable size={16} />
          Table (3×3)
        </DropdownMenuItem>
        {editor.canInsertImage() && (
          <DropdownMenuItem onClick={onPickImage} className="gap-2">
            <IconPhoto size={16} />
            Image
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Thin notes toolbar: a markdown-formatting group (bold / italic /
 * strikethrough toggles, link toggle, quote / code / foldout / table inserts)
 * on the left when editing,
 * and a view-mode dropdown (Editor / Split / Preview) pinned to the far right
 * — following the Slides toolbar's right-aligned dropdown pattern. Uses the
 * same Toggle + tooltip + tabler-icon look as the docs/sheets toolbars.
 */
export function NotesToolbar({
  mode,
  onModeChange,
  keymap,
  onKeymapChange,
  showAuthors,
  onShowAuthorsChange,
  editor,
  readOnly,
}: {
  mode: NoteViewMode;
  onModeChange: (mode: NoteViewMode) => void;
  keymap: NoteKeymap;
  onKeymapChange: (keymap: NoteKeymap) => void;
  /** Whether the blame gutter (who last edited each line) is shown. */
  showAuthors: boolean;
  onShowAuthorsChange: (show: boolean) => void;
  editor: NoteEditorAPI | null;
  readOnly?: boolean;
}) {
  const [formats, setFormats] = useState<NoteInlineFormats>(EMPTY_FORMATS);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const isMobile = useIsMobile();
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editor) {
      setFormats(EMPTY_FORMATS);
      setHistory({ canUndo: false, canRedo: false });
      return;
    }
    // The selection-change callback fires on every doc/selection change, which
    // is exactly when both inline formats and undo/redo depth can change — so
    // we refresh both from the one subscription.
    const refresh = (f: NoteInlineFormats) => {
      setFormats(f);
      setHistory({ canUndo: editor.canUndo(), canRedo: editor.canRedo() });
    };
    refresh(editor.getActiveFormats());
    editor.onSelectionChange(refresh);
    return () => editor.onSelectionChange(null);
  }, [editor]);

  const canFormat = !readOnly && mode !== "view";
  const current = MODES.find((m) => m.mode === mode) ?? MODES[1];
  // Split lays the two panes out at a fixed 50/50 (`packages/notes`
  // `editor.ts`), which is ~187px each on a 375px screen. Below the mobile
  // breakpoint the mode is not offered; `notes-detail` demotes a stored
  // `both` to `edit` so nobody arrives in a layout they cannot leave.
  const visibleModes = isMobile
    ? MODES.filter((m) => m.mode !== "both")
    : MODES;

  return (
    // `role` makes the label below reachable: `aria-label` on a generic
    // container is not exposed to the accessibility tree.
    <Toolbar role="toolbar" aria-label="Note toolbar">
      {canFormat && editor && (
        <>
          <TooltipButton
            label="Undo"
            disabled={!history.canUndo}
            onClick={() => editor.undo()}
          >
            <IconArrowBackUp size={16} />
          </TooltipButton>
          <TooltipButton
            label="Redo"
            disabled={!history.canRedo}
            onClick={() => editor.redo()}
          >
            <IconArrowForwardUp size={16} />
          </TooltipButton>
          <ToolbarSeparator />
          <TooltipToggle
            label="Bold"
            pressed={formats.bold}
            onToggle={() => editor.toggleBold()}
          >
            <IconBold size={16} />
          </TooltipToggle>
          <TooltipToggle
            label="Italic"
            pressed={formats.italic}
            onToggle={() => editor.toggleItalic()}
          >
            <IconItalic size={16} />
          </TooltipToggle>
          <TooltipToggle
            label="Strikethrough"
            pressed={formats.strikethrough}
            onToggle={() => editor.toggleStrikethrough()}
          >
            <IconStrikethrough size={16} />
          </TooltipToggle>
          <ToolbarSeparator />

          {/* One hidden input for both triggers (button / overflow item). */}
          {editor.canInsertImage() && (
            <ImageFileInput inputRef={imageInputRef} editor={editor} />
          )}

          {isMobile ? (
            // Nineteen controls do not fit a phone. The strip is
            // `overflow-x-auto`, so the overflow was never clipped — it
            // scrolled sideways, taking the right-pinned view-mode and
            // keymap dropdowns off screen with it. Keeping only undo/redo
            // and the inline formats inline puts those two back in view.
            <MobileOverflowMenu
              editor={editor}
              formats={formats}
              onPickImage={() => imageInputRef.current?.click()}
            />
          ) : (
            <>
              {/* List group: the three kinds are toggles (pressed when every
              selected line is of that kind), indent/outdent plain buttons that
              disable when the block cannot nest further in that direction.
              All five apply to every line the selection covers. */}
              <TooltipToggle
                label="Bullet list"
                pressed={formats.list === "bullet"}
                onToggle={() => editor.toggleBulletList()}
              >
                <IconList size={16} />
              </TooltipToggle>
              <TooltipToggle
                label="Numbered list"
                pressed={formats.list === "ordered"}
                onToggle={() => editor.toggleOrderedList()}
              >
                <IconListNumbers size={16} />
              </TooltipToggle>
              <TooltipToggle
                label="Checkbox"
                pressed={formats.list === "task"}
                onToggle={() => editor.toggleTaskList()}
              >
                <IconListCheck size={16} />
              </TooltipToggle>
              <TooltipButton
                label="Indent"
                disabled={!formats.canIndent}
                onClick={() => editor.indentList()}
              >
                <IconIndentIncrease size={16} />
              </TooltipButton>
              <TooltipButton
                label="Outdent"
                disabled={!formats.canOutdent}
                onClick={() => editor.outdentList()}
              >
                <IconIndentDecrease size={16} />
              </TooltipButton>
              <ToolbarSeparator />
              <TooltipToggle
                label="Link"
                pressed={formats.link}
                onToggle={() => editor.toggleLink()}
              >
                <IconLink size={16} />
              </TooltipToggle>
              <TooltipButton label="Quote" onClick={() => editor.toggleQuote()}>
                <IconBlockquote size={16} />
              </TooltipButton>
              <TooltipButton
                label="Code block"
                onClick={() => editor.insertCodeBlock()}
              >
                <IconCode size={16} />
              </TooltipButton>
              {/* Foldout is a plain insert, not a toggle: foldouts nest. */}
              <TooltipButton
                label="Foldout"
                onClick={() => editor.insertFoldout()}
              >
                <IconFold size={16} />
              </TooltipButton>
              <TableDropdown editor={editor} />
              {editor.canInsertImage() && (
                <TooltipButton
                  label="Insert image"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <IconPhoto size={16} />
                </TooltipButton>
              )}
            </>
          )}
        </>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        {!readOnly && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <ToolbarButton
                    variant="menu"
                    aria-label={`Keyboard: ${
                      KEYMAPS.find((k) => k.key === keymap)?.label ?? "Default"
                    }`}
                  >
                    <IconKeyboard size={16} />
                    <IconChevronDown size={12} className="ml-0.5 opacity-50" />
                  </ToolbarButton>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Keyboard</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              {KEYMAPS.map(({ key, label }) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={keymap === key}
                  onCheckedChange={() => onKeymapChange(key)}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <ToolbarButton
                  variant="menu"
                  aria-label={`View mode: ${current.label}`}
                >
                  <current.Icon size={16} />
                  <IconChevronDown size={12} className="ml-0.5 opacity-50" />
                </ToolbarButton>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>View mode</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            {visibleModes.map(({ mode: m, label, Icon }) => (
              <DropdownMenuCheckboxItem
                key={m}
                checked={mode === m}
                // Ignore the toggled-off case: a mode is always selected.
                onCheckedChange={() => onModeChange(m)}
                className="gap-2"
              >
                <Icon size={16} />
                {label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            {/*
              Display only: every client records authorship, so this decides
              what you see, not what you leave behind. The title still says
              that a name is recorded — it is the part a user cannot see, and
              it is durable (it goes into the note's content, readable by
              anyone who can read the note), so this menu is where they find
              out.
            */}
            <DropdownMenuCheckboxItem
              checked={showAuthors}
              onCheckedChange={(next) => onShowAuthorsChange(next)}
              className="gap-2"
              title="Show who last edited each line. Names are self-reported: everyone editing this note records their display name on the text they write, and it is visible to everyone who can read the note."
            >
              <IconUserCode size={16} />
              Show authors
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Toolbar>
  );
}

export default NotesToolbar;
