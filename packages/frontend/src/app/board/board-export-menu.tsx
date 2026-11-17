import { useEffect, useState } from "react";
import { IconDownload } from "@tabler/icons-react";
import { toast } from "sonner";
import type { SlidesDocument, SlidesEditor, SlidesStore } from "@wafflebase/slides";
import { isAuthExpiredError } from "@/api/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BOARD_OVERLAY_ATTR } from "./fit-insets";
import type { BoardExportFormat } from "./board-export";

export interface BoardExportMenuProps {
  store: SlidesStore | null;
  editor: SlidesEditor | null;
  /** Download file name (the document title). */
  title: string;
}

/**
 * The selected ids an export can frame: top-level elements only. A member
 * selected inside a drilled-into group has a group-local frame, which would
 * frame the wrong place.
 */
function exportableSelection(store: SlidesStore, editor: SlidesEditor): string[] {
  const top = new Set((store.read().slides[0]?.elements ?? []).map((e) => e.id));
  return editor.getSelection().filter((id) => top.has(id));
}

/**
 * "Download as PNG / PDF" for the board — a floating button over the
 * canvas's top-right corner rather than a toolbar entry, because the
 * toolbar is withheld on a read-only mount and a viewer must be able to
 * export too. The exporter is loaded on first use, keeping it (and
 * pdf-lib) out of the board chunk.
 */
export function BoardExportMenu({ store, editor, title }: BoardExportMenuProps) {
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    if (!editor || !store) return;
    const refresh = () => setHasSelection(exportableSelection(store, editor).length > 0);
    refresh();
    return editor.onSelectionChange(refresh);
  }, [editor, store]);

  const run = async (format: BoardExportFormat, selectionOnly: boolean) => {
    if (!store) return;
    const ids = selectionOnly && editor ? exportableSelection(store, editor) : undefined;
    const label = format === "png" ? "PNG" : "PDF";
    const toastId = toast.loading(`Exporting "${title}" as ${label}…`);
    try {
      const { exportBoard } = await import("./board-export");
      await exportBoard({
        doc: store.read() as SlidesDocument,
        format,
        title,
        ids,
      });
      toast.success(`Exported "${title}" as ${label}`, { id: toastId });
    } catch (err) {
      if (isAuthExpiredError(err)) {
        toast.dismiss(toastId);
        return;
      }
      console.error("Board export failed", err);
      toast.error(
        err instanceof Error && err.message === "Nothing to export."
          ? "The board is empty — nothing to export."
          : "Couldn't export the board. Try again.",
        { id: toastId },
      );
    }
  };

  return (
    <div
      {...{ [BOARD_OVERLAY_ATTR]: "" }}
      className="absolute right-3 top-2 z-20"
    >
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Download"
                disabled={!store}
                className="focus-ring inline-flex size-8 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <IconDownload size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void run("png", false)}>
            Download as PNG
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasSelection}
            onSelect={() => void run("png", true)}
          >
            Download selection as PNG
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void run("pdf", false)}>
            Download as PDF
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasSelection}
            onSelect={() => void run("pdf", true)}
          >
            Download selection as PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
