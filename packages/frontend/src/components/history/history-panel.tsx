import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader } from "@/components/loader";

import { useRevisionHistory } from "./use-revision-history";
import type { TimelineEntry } from "./group-revisions";

type Props = {
  userId: number;
  onClose: () => void;
  /**
   * Omitted when this document type has no preview surface — today only
   * docs, whose snapshots `YSON.parse` cannot read past three `Tree(...)`
   * brace levels (every docs document nests `doc > block > inline > text`,
   * depth 4). Rather than a dead click (`setPreviewRevisionId` writing to
   * state nothing reads), each row renders its Preview button disabled
   * with a reason so a user can tell preview isn't available here without
   * clicking to find out.
   */
  onPreview?: (revisionId: string) => void;
  /**
   * Called after a successful restore. Forwarded to `useRevisionHistory`
   * verbatim — a restore replaces the whole document root, so the editor
   * that mounts this panel needs the chance to drop its undo stack and
   * caret. The panel is the only thing between the editor and the hook, so
   * without this prop the callback could never be supplied.
   */
  onRestored?: () => void;
};

/** Formats a `TimelineDay.dayKey` ("YYYY-MM-DD") as a section heading. */
function formatDayHeading(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Right-slot version history panel: a day-grouped timeline of Yorkie
 * revisions with "Name current version", and per-entry Preview / Restore.
 * Mirrors the container markup of `CommentSidePanel`, which occupies the
 * same slot in the other panels the document header opens.
 */
export function HistoryPanel({ userId, onClose, onPreview, onRestored }: Props) {
  const { days, isLoading, error, nameCurrentVersion, restore } =
    useRevisionHistory({ enabled: true, userId, onRestored });

  const [label, setLabel] = useState("");
  const [isNaming, setIsNaming] = useState(false);
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);

  const handleNameSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || isNaming) return;
    setIsNaming(true);
    try {
      await nameCurrentVersion(trimmed);
      setLabel("");
    } finally {
      setIsNaming(false);
    }
  };

  const confirmRestore = async () => {
    if (!pendingRestoreId) return;
    const id = pendingRestoreId;
    setPendingRestoreId(null);
    await restore(id);
  };

  return (
    <aside
      className="flex h-full w-72 flex-col border-l bg-background shadow-lg"
      aria-label="Version history"
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-semibold">Version history</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={onClose}
          aria-label="Close version history panel"
        >
          ×
        </Button>
      </header>

      <form
        onSubmit={(e) => {
          void handleNameSubmit(e);
        }}
        className="flex gap-2 border-b px-4 py-3"
      >
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name current version"
          aria-label="Name current version"
          disabled={isNaming}
        />
        <Button type="submit" size="sm" disabled={isNaming || !label.trim()}>
          Save
        </Button>
      </form>

      <ScrollArea className="flex-1">
        {error && (
          <p role="alert" className="px-4 py-6 text-center text-sm text-destructive">
            Couldn't load version history: {error.message}
          </p>
        )}

        {!error && isLoading && <Loader />}

        {!error && !isLoading && days.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No versions yet.
          </p>
        )}

        {!error &&
          !isLoading &&
          days.map((day) => (
            <section key={day.dayKey} className="border-b last:border-0">
              <h3 className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {formatDayHeading(day.dayKey)}
              </h3>
              <ul>
                {day.entries.map((entry) => (
                  <HistoryEntryRow
                    key={entry.id}
                    entry={entry}
                    userId={userId}
                    onPreview={onPreview}
                    onRestoreRequested={() => setPendingRestoreId(entry.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
      </ScrollArea>

      <AlertDialog
        open={pendingRestoreId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRestoreId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              The current version is kept, so you can always come back. But
              comments in the document are part of the restored version — any
              comment added after this version was created will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void confirmRestore();
              }}
            >
              Restore this version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

function HistoryEntryRow({
  entry,
  userId,
  onPreview,
  onRestoreRequested,
}: {
  entry: TimelineEntry;
  userId: number;
  onPreview?: (revisionId: string) => void;
  onRestoreRequested: () => void;
}) {
  const isAutomatic = entry.meta.kind === "automatic";
  const previewUnavailableReason = "not available for this document type yet";

  return (
    <li className="flex flex-col gap-1 border-b px-4 py-3 last:border-0">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">
          {isAutomatic ? "Automatic" : entry.label}
        </span>
        <time className="text-xs text-muted-foreground">
          {formatTime(entry.createdAt)}
        </time>
      </div>
      {!isAutomatic && entry.meta.by === userId && (
        <span className="text-[10px] text-muted-foreground">By you</span>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={!onPreview}
          title={onPreview ? undefined : previewUnavailableReason}
          aria-label={onPreview ? undefined : `Preview: ${previewUnavailableReason}`}
          onClick={onPreview ? () => onPreview(entry.id) : undefined}
        >
          Preview
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={onRestoreRequested}
        >
          Restore
        </Button>
      </div>
    </li>
  );
}
