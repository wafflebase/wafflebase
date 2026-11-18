import { useId } from "react";
import { IconDownload, IconLoader2, IconFileDownload } from "@tabler/icons-react";
import { toast } from "sonner";
import { userFacingError } from "@/api/http-error";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HEADER_CONTROL_SIZE,
  useHeaderBusy,
  useHeaderPlacement,
} from "@/components/header-placement";
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
  const [exporting, setExporting] = useHeaderBusy("docs-export");
  const placement = useHeaderPlacement();
  // Inset in the menu so the rows line up with its checked panel rows.
  const inMenu = placement === "menu";
  const labelId = useId();

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
      // Export runs client-side (pdf-lib, font fetches, the DOCX writer),
      // so its errors are a library's wording, not the reader's: log the
      // detail and toast the recovery.
      const message = userFacingError(err, `Couldn't export "${t}". Try again.`);
      if (toastId !== undefined) toast.error(message, { id: toastId });
      else toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  // The menu placement has no trigger to disable, so the rows carry it.
  const unavailable = !editor || exporting;
  const formats = (
    <>
      <DropdownMenuItem
        className="cursor-pointer"
        inset={inMenu}
        disabled={unavailable}
        onSelect={() => runExport("docx", exportDocxAndDownload)}
      >
        <IconFileDownload size={16} />
        Word (.docx)
      </DropdownMenuItem>
      <DropdownMenuItem
        className="cursor-pointer"
        inset={inMenu}
        disabled={unavailable}
        onSelect={() => runExport("pdf", exportPdfAndDownload)}
      >
        <IconFileDownload size={16} />
        PDF (.pdf)
      </DropdownMenuItem>
      <DropdownMenuItem
        className="cursor-pointer"
        inset={inMenu}
        disabled={unavailable}
        onSelect={() => runExport("markdown", exportMarkdownAndDownload)}
      >
        <IconFileDownload size={16} />
        Markdown (.md)
      </DropdownMenuItem>
      <DropdownMenuItem
        className="cursor-pointer"
        inset={inMenu}
        disabled={unavailable}
        onSelect={() => runExport("text", exportTextAndDownload)}
      >
        <IconFileDownload size={16} />
        Plain text (.txt)
      </DropdownMenuItem>
    </>
  );

  // On a phone the formats are rows of the header's More menu: a flat
  // labelled group rather than a submenu, which is fiddly to open by touch.
  if (inMenu) {
    return (
      <>
        {/* Hidden when it would open the menu or follow the primary's. */}
        <DropdownMenuSeparator className="first:hidden [[role=separator]+&]:hidden" />
        {/* A group named by its label, so a screen reader hears "Export"
            with the rows rather than a bare "PDF (.pdf)". */}
        <DropdownMenuGroup aria-labelledby={labelId}>
          <DropdownMenuLabel inset id={labelId}>
            Export
          </DropdownMenuLabel>
          {formats}
        </DropdownMenuGroup>
      </>
    );
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={!editor || exporting}
              aria-label="Export document"
              className={`focus-ring inline-flex ${HEADER_CONTROL_SIZE} cursor-pointer items-center justify-center rounded-md border hover:bg-muted disabled:pointer-events-none disabled:opacity-50`}
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
      <DropdownMenuContent align="end">{formats}</DropdownMenuContent>
    </DropdownMenu>
  );
}
