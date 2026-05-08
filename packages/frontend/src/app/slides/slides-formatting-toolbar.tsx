import { useEffect, useState } from "react";
import type { InsertKind, SlidesEditor } from "@wafflebase/slides";
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
} from "@tabler/icons-react";

interface SlidesFormattingToolbarProps {
  editor: SlidesEditor | null;
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
 * Slides equivalent of `DocsFormattingToolbar`. Renders the insert
 * toolbar above the slide canvas; reflects the editor's actual
 * insert mode (the editor resets it to null after a placement, so a
 * one-way controlled toolbar would get stuck "pressed").
 */
export function SlidesFormattingToolbar({
  editor,
  onToggleThemePanel,
  themePanelOpen,
}: SlidesFormattingToolbarProps) {
  const [insertMode, setInsertMode] = useState<InsertKind | null>(null);

  useEffect(() => {
    if (!editor) return;
    setInsertMode(editor.getInsertMode());
    return editor.onInsertModeChange(() => setInsertMode(editor.getInsertMode()));
  }, [editor]);

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
