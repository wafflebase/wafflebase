import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ComponentType,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SyncStatusChip } from "@/components/sync-status/sync-status-chip";
import { userFacingError } from "@/api/http-error";

/**
 * The document-level controls every editor puts in its header, by role.
 *
 * Editors fill slots instead of passing a free-form row, so the order is
 * decided here once and is the same in every document type: the sync chip,
 * then these in `ACTION_ORDER`, then the notifications bell. A type without a
 * capability leaves its slot empty (slides and board have no comments system,
 * so they pass no `comments`); it never moves the others.
 */
export interface HeaderActions {
  /** The document type's own primary action, e.g. slides' Present. */
  primary?: ReactNode;
  /** Show/hide the comments panel. */
  comments?: ReactNode;
  /** Show/hide version history. */
  history?: ReactNode;
  /** Download / export the document. */
  export?: ReactNode;
  /** The Share dialog trigger. */
  share?: ReactNode;
  /** Who else is here (`UserPresence`). */
  presence?: ReactNode;
}

const ACTION_ORDER = [
  "primary",
  "comments",
  "history",
  "export",
  "share",
  "presence",
] as const satisfies readonly (keyof HeaderActions)[];

/**
 * The header's panel toggle (comments, version history): one size, one
 * pressed treatment and one "Show … / Hide …" naming rule for every editor,
 * where each used to hand-build its own and the sheet editor's carried no
 * pressed wash at all.
 *
 * Needs a `TooltipProvider` above it, as every editor layout has.
 */
export function HeaderPanelToggle({
  icon: Icon,
  label,
  pressed,
  onPressedChange,
}: {
  icon: ComponentType<{ size?: number }>;
  /** What the panel holds, lower case: "comments", "version history". */
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}) {
  const name = `${pressed ? "Hide" : "Show"} ${label}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          className="h-8 w-8 min-w-8 cursor-pointer border p-0 pointer-coarse:min-w-11"
          aria-label={name}
          pressed={pressed}
          onPressedChange={onPressedChange}
        >
          <Icon size={16} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}

type SiteHeaderProps = {
  title: string;
  editable?: boolean;
  /**
   * Usually asynchronous — `useDocumentRename` PATCHes the row — so the
   * returned promise is awaited here rather than discarded; see
   * `commitRename`.
   */
  onRename?: (newTitle: string) => void | Promise<void>;
  /** Optional control rendered left of the title (e.g. a back button). */
  leading?: ReactNode;
  /**
   * Show whether local edits have reached the server. Opt-in, and NOT because
   * the chip is optional for an editor — it is because this header is also
   * used by shells with no Yorkie document at all (the documents list in
   * `app/Layout.tsx`, the static-file viewer in `app/files/file-shell.tsx`),
   * and `useDocument()` throws outside a `DocumentProvider`. Pass it from any
   * shell that mounts inside one.
   */
  syncStatus?: boolean;
} & (
  | {
      /** Every editor: the slotted document controls, see `HeaderActions`. */
      actions?: HeaderActions;
      children?: never;
    }
  | {
      /**
       * Shells that are not editors (the static-file viewers) and have a
       * control set of their own. An editor passes `actions` instead.
       */
      children?: ReactNode;
      actions?: never;
    }
);

/**
 * Renders the SiteHeader component.
 */
export function SiteHeader({
  title,
  editable = false,
  onRename,
  leading,
  syncStatus = false,
  actions,
  children,
}: SiteHeaderProps) {
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
      // The input closes immediately, before the rename it started can
      // resolve. So a refused one (403 on a read-only share link, offline, a
      // document deleted under us) would otherwise do two silent things:
      // reject into nobody — an unhandled rejection — and snap the old title
      // back with nothing said. This header is the only place that knows a
      // user asked for the rename, so it is where the failure is reported.
      // The async wrapper catches a synchronous throw as well as a rejection,
      // and the title itself needs no restoring: it is a prop, and a refused
      // `PATCH` leaves the row it is read from unchanged.
      void (async () => onRename(trimmed))().catch((err: unknown) => {
        toast.error(`Couldn't rename to "${trimmed}"`, {
          description: userFacingError(
            err,
            "Check your connection and try again.",
          ),
        });
      });
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
            // The heading stays a heading: the rename control is a button
            // inside it rather than the `<h1>` itself wearing a button role,
            // which took it out of heading navigation. `aria-label` keeps the
            // heading's name the title, not the button's "Rename …".
            //
            // Only the button truncates when editable: an `overflow: hidden`
            // heading around it would clip its focus ring.
            <h1
              className={`min-w-0 text-base font-medium ${editable ? "" : "truncate"}`}
              aria-label={editable ? title : undefined}
            >
              {editable ? (
                <button
                  type="button"
                  className="block max-w-full cursor-pointer truncate rounded px-1 text-left transition-colors hover:bg-muted/50 focus-ring"
                  onClick={openEditing}
                  aria-label={`Rename "${title}"`}
                >
                  {title}
                </button>
              ) : (
                title
              )}
            </h1>
          )}
        </div>

        {/* Always reserve space for the controls to prevent layout shift */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Left of the per-editor controls, so it reads as a property of the
              document rather than as one more button. */}
          {syncStatus && <SyncStatusChip />}
          {actions &&
            ACTION_ORDER.map((slot) =>
              actions[slot] ? (
                // `contents`, so a slot adds no box of its own: one whose
                // control renders nothing (comments withheld during a
                // revision preview) leaves no stray gap.
                <div key={slot} data-header-slot={slot} className="contents">
                  {actions[slot]}
                </div>
              ) : null,
            )}
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
