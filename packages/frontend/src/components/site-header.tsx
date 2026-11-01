import { useState, useRef, useEffect, useCallback } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SyncStatusChip } from "@/components/sync-status/sync-status-chip";

/**
 * Renders the SiteHeader component.
 */
export function SiteHeader({
  title,
  editable = false,
  onRename,
  leading,
  syncStatus = false,
  children,
}: {
  title: string;
  editable?: boolean;
  onRename?: (newTitle: string) => void;
  /** Optional control rendered left of the title (e.g. a back button). */
  leading?: React.ReactNode;
  /**
   * Show whether local edits have reached the server. Opt-in, and NOT because
   * the chip is optional for an editor — it is because this header is also
   * used by shells with no Yorkie document at all (the documents list in
   * `app/Layout.tsx`, the static-file viewer in `app/files/file-shell.tsx`),
   * and `useDocument()` throws outside a `DocumentProvider`. Pass it from any
   * shell that mounts inside one.
   */
  syncStatus?: boolean;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  // Whether the user has actually typed into the open input. An input that is
  // merely open holds no draft to protect, and treating it as one is what made
  // an idle input revert a peer: the stale value it was opened with would be
  // committed straight back on blur.
  const [dirty, setDirty] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow the title while the input is closed, and also while it is open but
  // untouched. Peers' renames arrive live (`useDocumentRename`), and one
  // landing mid-edit must not replace what the user is typing — but only an
  // edited draft is worth keeping; the draft resyncs once the input closes.
  useEffect(() => {
    if (!editing || !dirty) setEditValue(title);
  }, [title, editing, dirty]);

  const closeEditing = useCallback(() => {
    setEditing(false);
    setDirty(false);
  }, []);

  const openEditing = useCallback(() => {
    setEditValue(title);
    setDirty(false);
    setEditing(true);
  }, [title]);

  // A host revokes `editable` to withhold the rename — a revision preview
  // does it, because committing the input is a write to the live document.
  // Leaving an already-open input mounted would leave the one control the
  // host meant to remove on screen, so revoking closes it, discarding the
  // uncommitted draft rather than saving it.
  useEffect(() => {
    if (!editable) closeEditing();
  }, [editable, closeEditing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // `dirty` and not just `trimmed !== title`: an untouched draft tracks the
  // title, so the two agree — except for a title that is only whitespace
  // different, which would otherwise commit a trim nobody asked for.
  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (dirty && trimmed && trimmed !== title && onRename) {
      onRename(trimmed);
    }
    closeEditing();
  }, [dirty, editValue, title, onRename, closeEditing]);

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center justify-between gap-1 px-4 lg:gap-2 lg:px-6 min-h-[3.5rem]">
        <div className="flex min-w-0 flex-1 items-center gap-1 lg:gap-2">
          <SidebarTrigger className="-ml-1 shrink-0" />
          <Separator
            orientation="vertical"
            className="mx-2 shrink-0 data-[orientation=vertical]:h-4"
          />
          {leading}
          {editing ? (
            <input
              ref={inputRef}
              className="text-base font-medium bg-transparent border-b border-primary px-1 min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              value={editValue}
              aria-label="Document title"
              onChange={(e) => {
                setEditValue(e.target.value);
                setDirty(true);
              }}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setEditValue(title);
                  closeEditing();
                }
              }}
            />
          ) : (
            <h1
              className={`text-base font-medium truncate min-w-0 ${editable ? "cursor-pointer hover:bg-muted/50 px-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : ""}`}
              onClick={() => {
                if (editable) openEditing();
              }}
              onKeyDown={(e) => {
                if (editable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  openEditing();
                }
              }}
              role={editable ? "button" : undefined}
              tabIndex={editable ? 0 : undefined}
              aria-label={editable ? `Rename "${title}"` : undefined}
            >
              {title}
            </h1>
          )}
        </div>

        {/* Always reserve space for children to prevent layout shift */}
        <div className="flex shrink-0 items-center">
          {/* Left of the per-editor controls, so it reads as a property of the
              document rather than as one more button. */}
          {syncStatus && <SyncStatusChip className="mr-2" />}
          {children}
          {/* One mount point for the whole app: this header is used by the
              documents shell and by every editor. Renders nothing for
              anonymous share-link viewers. */}
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
