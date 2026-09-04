import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RotateCw,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUploadQueue } from "./use-upload-queue";
import {
  retry,
  dismissItem,
  clearFinished,
  isRetryable,
  type UploadItem,
} from "./upload-queue";

function StatusCell({ item }: { item: UploadItem }) {
  if (item.status === "done")
    return item.docPath ? (
      <Link to={item.docPath} className="text-xs text-primary hover:underline">
        Open
      </Link>
    ) : (
      <CheckCircle2 className="h-4 w-4 text-primary" />
    );
  if (item.status === "error")
    // An item with nothing to replay from (an externally driven import, whose
    // credential is deliberately not kept) gets a plain failure marker. A
    // retry button that cannot possibly work is worse than none.
    return isRetryable(item) ? (
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => retry(item.id)}
        title={item.reason}
        aria-label={`Retry uploading ${item.fileName}`}
      >
        <RotateCw className="h-3.5 w-3.5 text-destructive" />
      </Button>
    ) : (
      <AlertCircle
        className="h-4 w-4 text-destructive"
        aria-label={`${item.fileName} failed`}
      />
    );
  // `detail` wins when the driver supplied wording: an import's early stages
  // have a running count but no denominator, so the fraction alone would show
  // nothing at all and read as a hung row.
  const label =
    item.detail ??
    (item.total > 0 ? `${Math.min(item.done, item.total)}/${item.total}` : "");
  return (
    <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      {label}
    </span>
  );
}

export function UploadPanel() {
  const items = useUploadQueue();
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;

  // Intentionally includes "pending" (queued but not yet started), unlike
  // the store's activeCount() which counts only in-flight (parsing |
  // uploading) items — this header count is meant to read as "work left
  // in this batch", not strictly "currently running".
  const active = items.filter(
    (i) => i.status === "pending" || i.status === "parsing" || i.status === "uploading",
  ).length;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-background shadow-lg">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">
          {active > 0 ? `Uploading ${active} item${active > 1 ? "s" : ""}…` : "Uploads"}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand uploads panel" : "Collapse uploads panel"}
          >
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={clearFinished}
            aria-label="Clear finished uploads"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {!collapsed && (
        <ul className="max-h-72 overflow-y-auto py-1" aria-live="polite">
          {items.map((item) => (
            <li key={item.id} className="px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm" title={item.fileName}>
                  {item.fileName}
                </span>
                <StatusCell item={item} />
                {(item.status === "done" || item.status === "error") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => dismissItem(item.id)}
                    aria-label={`Remove ${item.fileName} from upload list`}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
              {item.status === "error" && item.reason && (
                // Render the failure reason as visible text, not just the
                // retry button's title tooltip, so it's available to keyboard
                // and screen-reader users. When the row cannot be retried in
                // place, say what the user has to do instead — otherwise the
                // absence of a retry control just reads as a missing feature.
                <p className="mt-0.5 text-xs text-destructive">
                  {item.reason}
                  {!isRetryable(item) && " — start the import again to retry."}
                </p>
              )}
              {item.warning && (
                // The item succeeded — its document exists and the row keeps
                // its Open link — but it arrived qualified: rows past the CSV
                // budget were dropped, or a PPTX lost fidelity. The toast that
                // says so is transient, so a user who missed it would read the
                // bare Open link as unqualified success. Amber and a warning
                // triangle, not the destructive red a failure gets.
                //
                // Not gated on `status === "done"`: only `finish()` sets the
                // field today, and a producer that later sets it elsewhere
                // should not have it silently swallowed again.
                //
                // `text-warning`, not a raw amber stop with a `dark:` variant:
                // the per-theme split this needs (no single amber stop clears
                // 4.5:1 on both backgrounds — in fact no colour does) now lives
                // in the token, which is where the contrast derivation is
                // recorded — see `packages/core/src/tokens/semantic.ts`.
                <p className="mt-0.5 flex items-start gap-1 text-xs text-warning">
                  <AlertTriangle
                    className="mt-[0.15rem] h-3 w-3 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{item.warning}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
