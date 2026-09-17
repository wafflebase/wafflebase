import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconExternalLink } from "@tabler/icons-react";
import { isSafeUrl } from "@wafflebase/core/url";

interface SheetLinkPopoverProps {
  /** Every link in the hovered cell, in reading order. */
  urls: Array<string>;
  /** Keeps the card open while the pointer is inside it. */
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/**
 * Shows a label short enough to read at a glance.
 *
 * A cell link is written out in full — nobody typed a display text — so the
 * card is the only place the destination is legible. The host is what tells
 * you where you are going, so it survives truncation and the path gives way.
 */
function toLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "mailto:") return parsed.pathname;

    const tail = `${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
    const host = parsed.host.replace(/^www\./, "");
    if (!tail) return host;
    return tail.length > 40 ? `${host}${tail.slice(0, 39)}…` : `${host}${tail}`;
  } catch {
    return url;
  }
}

/**
 * The hyperlinks inside one cell, with a way to reach each of them.
 *
 * Sheets paints links but never stored them, so unlike the Docs popover there
 * is nothing here to edit or unlink — the card exists to make the links
 * *reachable*: a cell holding a release note and a PR link offers two small
 * targets, and picking from a list beats aiming at them.
 */
export function SheetLinkPopover({
  urls,
  onPointerEnter,
  onPointerLeave,
}: SheetLinkPopoverProps) {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  // The engine gates on the same allowlist before it records a span, so this
  // should never filter anything out. It is here because this component is
  // what puts the string into an href.
  const safe = urls.filter(isSafeUrl);
  if (safe.length === 0) return null;

  return (
    <div
      className="flex max-w-sm min-w-64 flex-col rounded-lg border bg-background py-1 shadow-lg"
      role="dialog"
      aria-label="Links in this cell"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {safe.map((url) => (
        <div
          key={url}
          className="flex items-center gap-1 px-2 py-1 hover:bg-accent"
        >
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={url}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-[#1A73E8] hover:underline dark:text-[#8AB4F8]"
          >
            <IconExternalLink size={14} className="shrink-0" />
            <span className="truncate">{toLabel(url)}</span>
          </a>
          <button
            type="button"
            aria-label={`Copy ${url}`}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              setCopied(url);
            }}
          >
            {copied === url ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </button>
        </div>
      ))}
    </div>
  );
}
