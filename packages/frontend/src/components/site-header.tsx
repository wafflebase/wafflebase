import {
  Fragment,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { IconDotsVertical, IconLoader2 } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useIsMobile } from "@/hooks/use-mobile";
import {
  HEADER_CONTROL_SIZE,
  HeaderBusyContext,
  HeaderPlacementContext,
  useHeaderPlacement,
  type HeaderBusy,
} from "@/components/header-placement";

/**
 * The document-level controls every editor puts in its header, by role.
 *
 * Editors fill slots instead of passing a free-form row, so the order is
 * decided here once and is the same in every document type: the sync chip,
 * then these in `ACTION_ORDER`, then the notifications bell. A type without a
 * capability leaves its slot empty (slides has no comments system, so it
 * passes no `comments`); it never moves the others.
 */
export interface HeaderActions {
  /**
   * The document type's own primary action, e.g. slides' Present. On a
   * phone it renders twice — once in the row (`compact` placement) and once
   * in the More menu (`menu`) for whatever it moved out of the row — so it
   * must read `useHeaderPlacement()` and return menu items or nothing there.
   */
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
 * The slots a phone header moves into its More menu. What stays in the row
 * is what a phone user reaches for from the header: the document type's own
 * action and Share. The panels and export are one tap further, as in the
 * Google suite's phone apps, and the title gets the room back.
 */
const MENU_SLOTS = [
  "comments",
  "history",
  "export",
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
  icon: ComponentType<{ size?: number; className?: string }>;
  /** What the panel holds, lower case: "comments", "version history". */
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}) {
  const placement = useHeaderPlacement();
  if (placement === "menu") {
    // A checked row rather than "Show … / Hide …": the check mark carries
    // the state, the way a menu says it.
    return (
      <DropdownMenuCheckboxItem
        checked={pressed}
        onCheckedChange={onPressedChange}
      >
        <Icon size={16} className="text-muted-foreground" />
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </DropdownMenuCheckboxItem>
    );
  }
  const name = `${pressed ? "Hide" : "Show"} ${label}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          className={`${HEADER_CONTROL_SIZE} min-w-8 cursor-pointer border p-0`}
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
  // The app's mobile branch (768px), the same one the slides shell and the
  // sidebar switch on.
  const isMobile = useIsMobile();
  const [busy, setBusySet] = useState<ReadonlySet<string>>(() => new Set());
  const setBusy = useCallback((key: string, on: boolean) => {
    setBusySet((prev) => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const headerBusy = useMemo<HeaderBusy>(() => ({ busy, setBusy }), [busy, setBusy]);
  const hasMenu =
    isMobile &&
    !!actions &&
    (!!actions.primary || MENU_SLOTS.some((slot) => actions[slot]));

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
        {/* Below `sm` the title keeps ~96px (the trigger takes the rest of
            the 8rem floor) and the action cluster below gives way instead:
            with every control `shrink-0`, a 393px phone squeezed the title to
            "M." and let the cluster paint over the sidebar trigger. The
            decorative separator is the first thing dropped. */}
        <div className="flex min-w-0 flex-1 items-center gap-1 max-sm:min-w-32 lg:gap-2">
          <SidebarTrigger className="-ml-1 shrink-0" />
          <Separator
            orientation="vertical"
            className="mx-2 shrink-0 max-sm:hidden data-[orientation=vertical]:h-4"
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

        {/* Always reserve space for the controls to prevent layout shift.
            On a phone the cluster tightens its gaps, drops the presence
            avatars (the lowest-priority slot), and — as a last resort, e.g.
            while the sync chip is showing — scrolls rather than overlapping
            the title. `py-1` keeps focus rings clear of that scroll box. */}
        <div className="flex shrink-0 items-center gap-2 max-sm:min-w-0 max-sm:shrink max-sm:gap-1 max-sm:overflow-x-auto max-sm:py-1 max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
          {/* Left of the per-editor controls, so it reads as a property of the
              document rather than as one more button. */}
          {syncStatus && <SyncStatusChip />}
          <HeaderBusyContext.Provider value={headerBusy}>
          {actions && (
            <HeaderPlacementContext.Provider value={isMobile ? "compact" : "bar"}>
              {ACTION_ORDER.map((slot) =>
                actions[slot] &&
                !(isMobile && (MENU_SLOTS as readonly string[]).includes(slot)) ? (
                  // `contents`, so a slot adds no box of its own: one whose
                  // control renders nothing (comments withheld during a
                  // revision preview) leaves no stray gap.
                  <div
                    key={slot}
                    data-header-slot={slot}
                    className={slot === "presence" ? "contents max-sm:hidden" : "contents"}
                  >
                    {actions[slot]}
                  </div>
                ) : null,
              )}
            </HeaderPlacementContext.Provider>
          )}
          {hasMenu && actions && (
            <HeaderMoreMenu actions={actions} busy={busy.size > 0} />
          )}
          </HeaderBusyContext.Provider>
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

/**
 * The phone header's overflow: `primary` (for what it moved out of the row)
 * and the `MENU_SLOTS`, each rendered as menu rows through the `menu`
 * placement. The content mounts only while open, so work a slot starts there
 * keeps its in-flight flag in `HeaderBusyContext`, not in the slot.
 */
function HeaderMoreMenu({
  actions,
  busy,
}: {
  actions: HeaderActions;
  /** Something started from the menu is still running (an export). */
  busy: boolean;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More document actions"
              aria-busy={busy || undefined}
              className={`focus-ring inline-flex ${HEADER_CONTROL_SIZE} shrink-0 cursor-pointer items-center justify-center rounded-md border hover:bg-muted`}
            >
              {/* The menu's rows are gone once it closes, so the spinner an
                  export trigger shows on a wide screen shows here instead. */}
              {busy ? (
                <IconLoader2 size={16} className="animate-spin" />
              ) : (
                <IconDotsVertical size={16} />
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-56">
        <HeaderPlacementContext.Provider value="menu">
          {actions.primary}
          {/* Splits the type's own action from the panels; hidden when the
              primary drew nothing or nothing follows it. */}
          {actions.primary && (
            <DropdownMenuSeparator className="first:hidden last:hidden" />
          )}
          {/* Fragments, not the row's `contents` boxes: a slot's leading
              separator hides itself with `first:`, which a wrapper would
              make true of every slot. */}
          {MENU_SLOTS.map((slot) => (
            <Fragment key={slot}>{actions[slot]}</Fragment>
          ))}
        </HeaderPlacementContext.Provider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
