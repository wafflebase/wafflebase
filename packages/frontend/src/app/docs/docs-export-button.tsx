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
import type { Document as DocsDocument } from "@wafflebase/docs";
import type { EditorAPI } from "./docs-view";
import { exportDocxAndDownload } from "./docx-actions";
import { exportPdfAndDownload } from "./pdf-actions";
import { exportMarkdownAndDownload, exportTextAndDownload } from "./text-actions";
import { updateExportToast } from "./export-utils";

interface DocsExportButtonProps {
  editor: EditorAPI | null;
  title: string;
}

/**
 * Header "Export" menu for the docs editor — icon-only to save space,
 * mirroring the slides header. Offers DOCX, PDF, Markdown and plain text,
 * reading the live document straight off the editor's store.
 *
 * The two text formats reuse the serializers the CLI already prints from
 * (`wafflebase docs content --format md|text`); they report no progress
 * because they walk the document in one synchronous pass.
 */
export function DocsExportButton({ editor, title }: DocsExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  type ExportAction = (
    doc: DocsDocument,
    title: string,
    onProgress?: (d: number, t: number, p: string) => void,
  ) => Promise<void>;

  type ExportKind = "docx" | "pdf" | "markdown" | "text";

  const runExport = async (kind: ExportKind, fn: ExportAction) => {
    if (!editor || exporting) return;
    setExporting(true);
    const t = title || "document";
    let toastId: string | number | undefined;
    try {
      await fn(editor.getStore().getDocument(), t, (done, total, phase) => {
        toastId = updateExportToast(toastId, t, done, total, phase);
      });
      const message = `Exported "${t}"`;
      if (toastId !== undefined) toast.success(message, { id: toastId });
      else toast.success(message);
    } catch (err) {
      console.error(`${kind.toUpperCase()} export failed`, err);
      const message =
        err instanceof Error ? `Export failed: ${err.message}` : "Export failed";
      if (toastId !== undefined) toast.error(message, { id: toastId });
      else toast.error(message);
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
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
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
        <DropdownMenuItem
          className="cursor-pointer"
          disabled={exporting}
          onSelect={() => runExport("markdown", exportMarkdownAndDownload)}
        >
          <IconFileDownload size={16} className="mr-2" />
          Markdown (.md)
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer"
          disabled={exporting}
          onSelect={() => runExport("text", exportTextAndDownload)}
        >
          <IconFileDownload size={16} className="mr-2" />
          Plain text (.txt)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
