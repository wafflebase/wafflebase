/**
 * QR code for a link, generated entirely in the browser (the encoding and
 * export helpers live in `@/lib/qr-code`; nothing here calls a server).
 *
 * `QrCodePopover` is the whole affordance (button → QR + URL + exports), so
 * any surface that shows a link can drop it in; `QrCode` is the bare render
 * for anything that only wants the picture.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { IconQrcode, IconDownload, IconCopy } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  encodeQr,
  qrCodePngBlob,
  qrCodeSvgDocument,
  qrModulesPath,
  saveBlob,
} from "@/lib/qr-code";

/**
 * The QR picture for `value`, square and fluid.
 *
 * `role="img"` with a label, because the modules themselves say nothing to a
 * screen reader; the URL is rendered as text beside it by `QrCodePopover`.
 */
export function QrCode({
  value,
  label = "QR code",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const matrix = useMemo(() => encodeQr(value), [value]);
  const path = useMemo(() => qrModulesPath(matrix), [matrix]);
  return (
    <svg
      viewBox={`0 0 ${matrix.size} ${matrix.size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className={className}
    >
      <rect width={matrix.size} height={matrix.size} fill="#fff" />
      <path fill="#000" d={path} />
    </svg>
  );
}

/**
 * A QR button that opens the code for `url`, with the URL below it and
 * Download PNG / Download SVG / Copy image.
 */
export function QrCodePopover({
  url,
  fileName = "qr-code",
  triggerLabel = "Show QR code",
  triggerClassName,
}: {
  url: string;
  /** Base name of the downloaded files, without an extension. */
  fileName?: string;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  const handleDownloadPng = async () => {
    const blob = await qrCodePngBlob(url).catch(() => null);
    if (!blob) {
      toast.error("Couldn't render the QR image. Download the SVG instead.");
      return;
    }
    saveBlob(blob, `${fileName}.png`);
    toast.success("QR code downloaded");
  };

  const handleDownloadSvg = () => {
    saveBlob(
      new Blob([qrCodeSvgDocument(url)], { type: "image/svg+xml" }),
      `${fileName}.svg`,
    );
    toast.success("QR code downloaded");
  };

  const handleCopyImage = async () => {
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("no image clipboard");
      }
      // The blob is handed over as a *promise*, not awaited first: WebKit
      // requires the write to be issued in the same task as the click, and an
      // intervening await spends the user activation — which is why
      // `ClipboardItem` accepts a promise for its data in the first place.
      const png = qrCodePngBlob(url).then((blob) => {
        if (!blob) throw new Error("no PNG");
        return blob;
      });
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      toast.success("QR code copied to clipboard");
    } catch {
      // Image clipboard writes are unsupported in some browsers and denied in
      // others; the downloads stay as the way out.
      toast.error("Couldn't copy the QR image. Download it instead.");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={triggerClassName}
              aria-label={triggerLabel}
            >
              <IconQrcode className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{triggerLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64">
        <div className="grid gap-3">
          {/* The URL stays out of every attribute (aria-label, title): Sentry
              click breadcrumbs serialize those, and a share URL is the
              whole capability. Text content is not serialized. */}
          {/* The white plate is part of the code: it is the quiet zone a
              scanner needs, so it is pinned rather than themed. */}
          <div className="rounded-md bg-white p-2">
            <QrCode
              value={url}
              label="QR code for this link"
              className="w-full"
            />
          </div>
          <p className="text-muted-foreground text-xs break-all">
            {url}
          </p>
          <div className="grid gap-1">
            <Button
              variant="outline"
              size="sm"
              className="justify-start"
              onClick={handleDownloadPng}
            >
              <IconDownload className="h-3.5 w-3.5" aria-hidden="true" />
              Download PNG
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="justify-start"
              onClick={handleDownloadSvg}
            >
              <IconDownload className="h-3.5 w-3.5" aria-hidden="true" />
              Download SVG
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="justify-start"
              onClick={handleCopyImage}
            >
              <IconCopy className="h-3.5 w-3.5" aria-hidden="true" />
              Copy image
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
