import { useEffect, useRef, useState, type FormEvent } from "react";

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

import { useRestoreInProgress } from "./restore-lock";
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
  /**
   * Bump to make the panel re-read its list. The preview overlay owns its
   * own `useRevisionHistory` instance, so a restore started from the preview
   * refreshes *that* list and leaves this one stale — missing the "Before
   * restore" entry the restore just promised. Editors pass the same
   * `historyResetToken` they already bump in `onRestored`, which closes that
   * gap without a second hook instance or a shared store.
   */
  refreshKey?: number;
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
export function HistoryPanel({
  userId,
  onClose,
  onPreview,
  onRestored,
  refreshKey,
}: Props) {
  const { days, isLoading, error, refresh, nameCurrentVersion, restore } =
    useRevisionHistory({ enabled: true, userId, onRestored });

  const [label, setLabel] = useState("");
  const [isNaming, setIsNaming] = useState(false);
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const [isRestoringHere, setIsRestoringHere] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // A restore is two RPCs — a safety revision, then the restore itself — and
  // two of those sequences can interleave. The loser's `restoreRevision`
  // lands last and the document ends up at a version the user did not pick,
  // with the second safety revision recording a state that was never
  // current. The ref is what actually refuses the second call: `isRestoring`
  // re-renders the disabled controls, but a handler captured before that
  // render would still read the stale `false`.
  const restoreInFlight = useRef(false);

  // The preview overlay can start a restore too, and this panel stays mounted
  // and clickable behind it (so a user can switch versions from the list), so
  // the ref above only covers restores that started *here*. `restore` itself
  // refuses the cross-surface case — see `restore-lock.ts` — and this is how
  // that refusal reaches these controls before a user can trigger it.
  const isRestoringElsewhere = useRestoreInProgress();
  const isRestoring = isRestoringHere || isRestoringElsewhere;

  // Skip the initial value: the hook already fetches on mount, and a second
  // request for the same list would just be waste.
  const seenRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === seenRefreshKey.current) return;
    seenRefreshKey.current = refreshKey;
    void refresh();
  }, [refreshKey, refresh]);

  const handleNameSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || isNaming) return;
    setIsNaming(true);
    setNameError(null);
    try {
      await nameCurrentVersion(trimmed);
      setLabel("");
    } catch (err) {
      // `createRevision` is the one revision RPC a deployment is told NOT to
      // register on the auth webhook (Yorkie calls it with `attributes:
      // null`, so registering it denies everyone) — but a deployment that
      // registered it anyway makes this reject for every user. Without a
      // catch the rejection was unhandled, the spinner cleared, the label
      // stayed in the box and the user was told nothing. Every other action
      // in this panel reports its failures; so does this one now.
      setNameError(
        err instanceof Error ? err.message : "The version was not named.",
      );
    } finally {
      setIsNaming(false);
    }
  };

  const confirmRestore = async () => {
    if (!pendingRestoreId || restoreInFlight.current) return;
    const id = pendingRestoreId;
    restoreInFlight.current = true;
    setIsRestoringHere(true);
    setPendingRestoreId(null);
    setRestoreError(null);
    try {
      await restore(id);
    } catch (err) {
      // A restore that failed and said nothing is the worst outcome this
      // feature can produce: the user believes their document was rolled
      // back. Report it the same way the list reports a failed load.
      setRestoreError(
        err instanceof Error ? err.message : "The restore did not complete.",
      );
    } finally {
      restoreInFlight.current = false;
      setIsRestoringHere(false);
    }
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

      {nameError && (
        <p
          role="alert"
          className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          Couldn't name this version: {nameError}
        </p>
      )}

      {restoreError && (
        <p
          role="alert"
          className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          Couldn't restore this version: {restoreError}
        </p>
      )}

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
                    isRestoring={isRestoring}
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
              disabled={isRestoring}
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
  isRestoring,
  onRestoreRequested,
}: {
  entry: TimelineEntry;
  userId: number;
  onPreview?: (revisionId: string) => void;
  /** True while any row's restore is in flight; every row is disabled then. */
  isRestoring: boolean;
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
          disabled={isRestoring}
          title={isRestoring ? "A restore is already in progress" : undefined}
          onClick={onRestoreRequested}
        >
          Restore
        </Button>
      </div>
    </li>
  );
}
