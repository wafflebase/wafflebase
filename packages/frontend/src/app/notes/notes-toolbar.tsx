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
} from "@/components/ui/dropdown-menu";
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
  IconTable,
  IconKeyboard,
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

function Divider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-border" />;
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
            <button
              type="button"
              aria-label="Insert table"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            >
              <IconTable size={16} />
            </button>
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
 * Thin notes toolbar: a markdown-formatting group (bold / italic /
 * strikethrough toggles, link toggle, table insert) on the left when editing,
 * and a view-mode dropdown (Editor / Split / Preview) pinned to the far right
 * — following the Slides toolbar's right-aligned dropdown pattern. Uses the
 * same Toggle + tooltip + tabler-icon look as the docs/sheets toolbars.
 */
export function NotesToolbar({
  mode,
  onModeChange,
  keymap,
  onKeymapChange,
  editor,
  readOnly,
}: {
  mode: NoteViewMode;
  onModeChange: (mode: NoteViewMode) => void;
  keymap: NoteKeymap;
  onKeymapChange: (keymap: NoteKeymap) => void;
  editor: NoteEditorAPI | null;
  readOnly?: boolean;
}) {
  const [formats, setFormats] = useState<NoteInlineFormats>(EMPTY_FORMATS);

  useEffect(() => {
    if (!editor) {
      setFormats(EMPTY_FORMATS);
      return;
    }
    setFormats(editor.getActiveFormats());
    editor.onSelectionChange(setFormats);
    return () => editor.onSelectionChange(null);
  }, [editor]);

  const canFormat = !readOnly && mode !== "view";
  const current = MODES.find((m) => m.mode === mode) ?? MODES[1];

  return (
    <div
      aria-label="Note toolbar"
      className="flex items-center gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 whitespace-nowrap"
    >
      {canFormat && editor && (
        <>
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
          <Divider />
          <TooltipToggle
            label="Link"
            pressed={formats.link}
            onToggle={() => editor.toggleLink()}
          >
            <IconLink size={16} />
          </TooltipToggle>
          <TableDropdown editor={editor} />
        </>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        {!readOnly && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Keyboard: ${
                      KEYMAPS.find((k) => k.key === keymap)?.label ?? "Default"
                    }`}
                    className="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-sm hover:bg-muted"
                  >
                    <IconKeyboard size={16} />
                    <IconChevronDown size={12} className="ml-0.5 opacity-50" />
                  </button>
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
                <button
                  type="button"
                  aria-label={`View mode: ${current.label}`}
                  className="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-sm hover:bg-muted"
                >
                  <current.Icon size={16} />
                  <IconChevronDown size={12} className="ml-0.5 opacity-50" />
                </button>
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default NotesToolbar;
