import { useId } from "react";
import {
  IconFileTypePdf,
  IconFileTypePpt,
  IconDownload,
  IconLoader2,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { userFacingError } from "@/api/http-error";
import type { SlidesStore } from "@wafflebase/slides";
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
import { exportSlidesPdfAndDownload } from "./pdf-actions";
import { exportSlidesPptxAndDownload } from "./pptx-actions";
import { updateExportToast } from "../docs/export-utils";

interface SlidesExportButtonProps {
  store: SlidesStore | null;
  title: string;
  disabled?: boolean;
}

/**
 * Header "Export" menu for the slides editor. Offers PDF (one slide per
 * page, raster) and PPTX (vector DrawingML round-trip). Either path can
 * take a few seconds on large decks — the trigger shows a spinner and
 * stays disabled until the download fires.
 */
export function SlidesExportButton({
  store,
  title,
  disabled,
}: SlidesExportButtonProps) {
  const [exporting, setExporting] = useHeaderBusy("slides-export");
  const placement = useHeaderPlacement();
  // Inset in the menu so the rows line up with its checked panel rows.
  const inMenu = placement === "menu";
  const labelId = useId();

  const runExport = async (
    label: string,
    fn: (
      doc: ReturnType<SlidesStore["read"]>,
      title: string,
      onProgress: (done: number, total: number, phase: string) => void,
    ) => Promise<void>,
  ) => {
    if (!store || exporting) return;
    setExporting(true);
    const t = title || "presentation";
    let toastId: string | number | undefined;
    try {
      await fn(store.read(), t, (done, total, phase) => {
        toastId = updateExportToast(toastId, t, done, total, phase);
      });
      const message = `Exported "${t}"`;
      if (toastId !== undefined) toast.success(message, { id: toastId });
      else toast.success(message);
    } catch (err) {
      console.error(`Slides ${label} export failed`, err);
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
  const unavailable = disabled || !store || exporting;
  const formats = (
    <>
      <DropdownMenuItem
        className="cursor-pointer"
        inset={inMenu}
        disabled={unavailable}
        onSelect={() => runExport("PDF", exportSlidesPdfAndDownload)}
      >
        <IconFileTypePdf size={16} />
        PDF (.pdf)
      </DropdownMenuItem>
      <DropdownMenuItem
        className="cursor-pointer"
        inset={inMenu}
        disabled={unavailable}
        onSelect={() => runExport("PPTX", exportSlidesPptxAndDownload)}
      >
        <IconFileTypePpt size={16} />
        PowerPoint (.pptx)
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
              disabled={disabled || !store || exporting}
              aria-label="Export presentation"
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
