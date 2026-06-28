import { useState } from "react";
import { IconFileTypePdf, IconDownload, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import type { SlidesStore } from "@wafflebase/slides";
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
import { exportSlidesPdfAndDownload } from "./pdf-actions";
import { updateExportToast } from "../docs/export-utils";

interface SlidesExportButtonProps {
  store: SlidesStore | null;
  title: string;
  disabled?: boolean;
}

/**
 * Header "Export" menu for the slides editor. P0 offers PDF only (one
 * slide per page, raster). The dynamic-imported pdf-lib + per-slide
 * canvas render can take a few seconds on large decks, so the trigger
 * shows a spinner and stays disabled until the download fires.
 */
export function SlidesExportButton({
  store,
  title,
  disabled,
}: SlidesExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handleExportPdf = async () => {
    if (!store) return;
    setExporting(true);
    const t = title || "presentation";
    let toastId: string | number | undefined;
    try {
      await exportSlidesPdfAndDownload(store.read(), t, (done, total, phase) => {
        toastId = updateExportToast(toastId, t, done, total, phase);
      });
      const message = `Exported "${t}"`;
      if (toastId !== undefined) toast.success(message, { id: toastId });
      else toast.success(message);
    } catch (err) {
      console.error("Slides PDF export failed", err);
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
              disabled={disabled || !store || exporting}
              aria-label="Export presentation"
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
          onSelect={handleExportPdf}
        >
          <IconFileTypePdf size={16} />
          PDF (.pdf)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
