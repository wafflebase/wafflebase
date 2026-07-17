import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Loader2,
  RotateCw,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUploadQueue } from "./use-upload-queue";
import { retry, removeItem, clearFinished, type UploadItem } from "./upload-queue";

function StatusCell({ item }: { item: UploadItem }) {
  if (item.status === "done")
    return item.docPath ? (
      <Link to={item.docPath} className="text-xs text-primary hover:underline">
        Open
      </Link>
    ) : (
      <CheckCircle2 className="h-4 w-4 text-primary" />
    );
  if (item.status === "skipped")
    return <span className="text-xs text-muted-foreground">Unsupported</span>;
  if (item.status === "error")
    return (
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
    );
  const label = item.total > 0 ? `${Math.min(item.done, item.total)}/${item.total}` : "";
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
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
            <li key={item.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex-1 truncate text-sm" title={item.fileName}>
                {item.fileName}
              </span>
              <StatusCell item={item} />
              {(item.status === "done" ||
                item.status === "skipped" ||
                item.status === "error") && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Remove ${item.fileName} from upload list`}
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
