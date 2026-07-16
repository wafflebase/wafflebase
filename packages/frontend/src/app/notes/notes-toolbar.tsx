import { useEffect, useState, type ReactNode } from "react";
import type {
  NoteEditorAPI,
  NoteViewMode,
  NoteInlineFormats,
} from "@wafflebase/notes";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  IconPencil,
  IconLayoutColumns,
  IconEye,
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconLink,
  IconTable,
} from "@tabler/icons-react";

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

/**
 * Thin notes toolbar: a view-mode segmented control (Editor / Split / Preview)
 * plus, when editing, a markdown-formatting group (bold / italic /
 * strikethrough toggles, a link toggle, and a table insert). Uses the same
 * Toggle + tooltip + tabler-icon pattern as the docs/sheets formatting
 * toolbars. Formatting is hidden when read-only or in preview-only mode (no
 * editor pane to act on).
 */
export function NotesToolbar({
  mode,
  onModeChange,
  editor,
  readOnly,
}: {
  mode: NoteViewMode;
  onModeChange: (mode: NoteViewMode) => void;
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

  return (
    <div
      aria-label="Note toolbar"
      className="flex items-center gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 whitespace-nowrap"
    >
      {MODES.map(({ mode: m, label, Icon }) => (
        <Tooltip key={m}>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={mode === m}
              onPressedChange={() => onModeChange(m)}
              className="h-7 w-7 cursor-pointer"
              aria-label={label}
            >
              <Icon size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}

      {canFormat && editor && (
        <>
          <Divider />
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 cursor-pointer p-0"
                aria-label="Insert table"
                onClick={() => editor.insertTable()}
              >
                <IconTable size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Insert table</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}

export default NotesToolbar;
