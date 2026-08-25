import { SyncStatusChip } from "@/components/sync-status/sync-status-chip";

/**
 * The status marker in a share-link layout's top bar.
 *
 * Every shared layout (sheet, docs, notes, slides, board) built the same
 * "View only" badge inline; this is that badge, plus the other half of the
 * question it was already answering. A viewer-role visitor produces no local
 * changes, so a sync state would report a connection whose loss costs them
 * nothing — they keep the badge. An editor-role visitor can strand work
 * exactly like an owned editor can, and reaches none of `SiteHeader`'s
 * wiring, so they get the chip.
 *
 * Must be rendered inside the layout's `DocumentProvider`.
 *
 * Design: docs/design/sync-status.md
 */
export function SharedHeaderStatus({ readOnly }: { readOnly: boolean }) {
  if (readOnly) {
    return (
      <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        View only
      </span>
    );
  }
  return <SyncStatusChip />;
}
