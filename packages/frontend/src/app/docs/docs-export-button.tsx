import { useState } from "react";
import { IconDownload, IconLoader2, IconFileDownload } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EditorAPI } from "./docs-view";
import { exportDocxAndDownload } from "./docx-actions";
import { exportPdfAndDownload } from "./pdf-actions";

interface DocsExportButtonProps {
  editor: EditorAPI | null;
  title: string;
}

/**
 * Header "Export" menu for the docs editor — icon-only to save space,
 * mirroring the slides header. Offers DOCX and PDF (the same actions the
 * formatting toolbar's Export dropdown exposes), reading the live
 * document straight off the editor's store.
 */
export function DocsExportButton({ editor, title }: DocsExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const runExport = async (
    kind: "docx" | "pdf",
    fn: typeof exportDocxAndDownload | typeof exportPdfAndDownload,
  ) => {
    if (!editor || exporting) return;
    setExporting(true);
    try {
      await fn(editor.getStore().getDocument(), title || "document");
    } catch (err) {
      console.error(`${kind.toUpperCase()} export failed`, err);
      toast.error(
        err instanceof Error ? `Export failed: ${err.message}` : "Export failed",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={!editor || exporting}
              aria-label="Export document"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              {exporting ? (
                <IconLoader2 size={16} className="animate-spin" />
              ) : (
                <IconDownload size={16} />
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Export</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="cursor-pointer"
          disabled={exporting}
          onSelect={() => runExport("docx", exportDocxAndDownload)}
        >
          <IconFileDownload size={16} className="mr-2" />
          Word (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer"
          disabled={exporting}
          onSelect={() => runExport("pdf", exportPdfAndDownload)}
        >
          <IconFileDownload size={16} className="mr-2" />
          PDF (.pdf)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
