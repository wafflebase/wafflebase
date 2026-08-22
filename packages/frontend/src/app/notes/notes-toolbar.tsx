import { useEffect, useRef, useState, type ReactNode } from "react";
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
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Toolbar,
  ToolbarSeparator,
  ToolbarButton,
} from "@/components/ui/toolbar";
import { TableGridPicker } from "@/components/table-grid-picker";
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
        <ToolbarButton
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
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
 */
function ImageButton({ editor }: { editor: NoteEditorAPI }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <TooltipButton
        label="Insert image"
        onClick={() => inputRef.current?.click()}
      >
        <IconPhoto size={16} />
      </TooltipButton>
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
    </>
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

  return (
    <Toolbar aria-label="Note toolbar">
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
          <TooltipButton label="Foldout" onClick={() => editor.insertFoldout()}>
            <IconFold size={16} />
          </TooltipButton>
          <TableDropdown editor={editor} />
          {editor.canInsertImage() && <ImageButton editor={editor} />}
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
            {MODES.map(({ mode: m, label, Icon }) => (
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
