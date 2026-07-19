import { useRef, useState } from 'react';
import { IconTable } from '@tabler/icons-react';
import type { SlidesEditor } from '@wafflebase/slides';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { ToolbarButton } from '@/components/ui/toolbar';
import { TableGridPicker } from '@/components/table-grid-picker';

interface TablePickerProps {
  editor: SlidesEditor | null;
  disabled?: boolean;
  /**
   * Optional custom trigger (mirrors `ShapePicker`/`LinePicker`). When
   * provided it replaces the default 28px icon button — used by the
   * mobile Insert sheet to render a full-width sheet-action button.
   * Rendered `asChild`, so it must forward props/ref to a single DOM
   * element.
   */
  trigger?: React.ReactNode;
  /** Fired after a table is committed — lets a host sheet close. */
  onInsert?: () => void;
}

/**
 * Insert-table button with a Google-Slides-style grid picker. Hover
 * over the cell grid to set the desired `rows × cols`; click to
 * commit. Inserts a default-sized table centered on the current
 * slide via `editor.insertTable(rows, cols)`.
 *
 * The grid body is the shared `TableGridPicker` (same component the Docs
 * and Notes toolbars use), so the highlight colors are token-driven and
 * the sizing behavior is identical across all three editors.
 */
export function TablePicker({
  editor,
  disabled,
  trigger,
  onInsert,
}: TablePickerProps) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const commit = (rows: number, cols: number): void => {
    if (!editor || rows < 1 || cols < 1) return;
    editor.insertTable(rows, cols);
    setOpen(false);
    onInsert?.();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <ToolbarButton disabled={disabled || !editor} aria-label="Insert table">
                <IconTable size={16} />
              </ToolbarButton>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Insert table</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent
        ref={contentRef}
        align="start"
        sideOffset={4}
        // Radix focuses the menu content container on open; redirect
        // focus to the grid so its arrow-key sizing handler is reachable.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current
            ?.querySelector<HTMLElement>('[role="grid"]')
            ?.focus();
        }}
      >
        <TableGridPicker onSelect={commit} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
