import type { NoteViewMode } from "@wafflebase/notes";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { IconPencil, IconLayoutColumns, IconEye } from "@tabler/icons-react";

const MODES: {
  mode: NoteViewMode;
  label: string;
  Icon: typeof IconEye;
}[] = [
  { mode: "edit", label: "Editor", Icon: IconPencil },
  { mode: "both", label: "Split", Icon: IconLayoutColumns },
  { mode: "view", label: "Preview", Icon: IconEye },
];

/**
 * Thin notes toolbar: a 3-way view-mode segmented control
 * (Editor / Split / Preview), mirroring CodePair's editor modes. Uses the same
 * `Toggle` + tooltip + tabler-icon button pattern as the docs/sheets formatting
 * toolbars so the look & feel matches. The toolbar strip styling is inlined
 * (rather than importing the shared `Toolbar` primitive) to avoid hoisting it
 * into its own chunk for a 3-button control.
 */
export function NotesToolbar({
  mode,
  onModeChange,
}: {
  mode: NoteViewMode;
  onModeChange: (mode: NoteViewMode) => void;
}) {
  return (
    <div
      aria-label="Note view mode"
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
    </div>
  );
}

export default NotesToolbar;
