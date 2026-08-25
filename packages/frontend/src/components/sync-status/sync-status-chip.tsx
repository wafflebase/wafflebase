import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  IconAlertTriangle,
  IconCheck,
  IconCloudUpload,
  IconRefresh,
} from '@tabler/icons-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useSyncStatus } from './use-sync-status';
import type { SyncState } from './sync-state';

/**
 * How long a stranded state must persist before it is worth interrupting for.
 * The watch stream drops the occasional frame and recovers on its own; a toast
 * for each of those would train people to dismiss the one that matters.
 *
 * The chip itself is not debounced — it is the ambient surface and can afford
 * to be instant. Only the interruption waits.
 */
const TOAST_DELAY_MS = 2000;

/** Stable id so the recovery path can retract the exact toast it replaced. */
const TOAST_ID = 'wafflebase-sync-status';

/** Likewise stable, so a flapping connection replaces the confirmation rather
 *  than stacking a new one on every recovery. */
const RECOVERY_TOAST_ID = 'wafflebase-sync-status-recovered';

const LABELS: Record<SyncState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  reconnecting: 'Reconnecting…',
  'not-saved': 'Not saved',
};

const ICONS: Record<SyncState, typeof IconCheck> = {
  saved: IconCheck,
  saving: IconCloudUpload,
  reconnecting: IconRefresh,
  'not-saved': IconAlertTriangle,
};

function tooltipFor(state: SyncState, pendingSince: Date | null): string {
  switch (state) {
    case 'saved':
      return 'All changes are on the server.';
    case 'saving':
      return 'Sending your recent changes to the server.';
    case 'reconnecting':
      return 'The connection dropped. Nothing of yours is waiting to be sent.';
    case 'not-saved': {
      const since = pendingSince
        ? `Changes since ${pendingSince.toLocaleTimeString()}`
        : 'Recent changes';
      // Deliberately names the tab as the only copy. Yorkie keeps the change
      // queue in memory, so anything that ends this tab ends these edits —
      // wording that implied local storage would be a false promise.
      return `${since} haven't reached the server. They exist only in this tab, so closing or reloading it will lose them.`;
    }
  }
}

/**
 * Reports whether this document's local edits have reached the server, and
 * escalates when they have not: a chip, a debounced toast, and a guard on
 * closing the tab.
 *
 * Must be rendered inside a `DocumentProvider`. Mounted once in `SiteHeader`
 * (which covers every owned editor) and once in the shared-document top bar,
 * which builds its own header.
 *
 * Design: docs/design/sync-status.md
 */
export function SyncStatusChip({ className }: { className?: string }) {
  const { state, pendingSince } = useSyncStatus();
  const stranded = state === 'not-saved';

  // The guard is registered only while edits are actually at risk. A handler
  // left permanently attached would prompt on every navigation away from a
  // perfectly synced document, which teaches people to click through it.
  useEffect(() => {
    if (!stranded) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers require a returnValue to show the prompt at all; the
      // string itself has been ignored by every current browser for years.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [stranded]);

  // Tracks whether the warning is currently on screen, so recovery only
  // confirms when there was something to recover from.
  const warned = useRef(false);

  useEffect(() => {
    if (stranded) {
      const timer = setTimeout(() => {
        warned.current = true;
        toast.warning('Not saved', {
          id: TOAST_ID,
          duration: Infinity,
          description:
            "Your connection dropped and recent changes haven't reached the server. Keep this tab open; they'll sync when the connection returns.",
        });
      }, TOAST_DELAY_MS);
      return () => clearTimeout(timer);
    }

    if (!warned.current) return;

    // The warning is no longer true, so retract it either way.
    toast.dismiss(TOAST_ID);

    // But only *confirm* once the work is actually on the server. Reconnecting
    // moves the state to `saving`, not `saved` — the push has not been
    // attempted yet and can still be rejected. Saying "reached the server"
    // there would hand out a receipt for work that may not survive, which is
    // the precise failure this feature exists to prevent.
    if (state !== 'saved') return;
    warned.current = false;
    toast.success('Saved', {
      id: RECOVERY_TOAST_ID,
      description: 'Your changes reached the server.',
    });
  }, [stranded, state]);

  // `<Toaster />` is mounted outside the router, and the warning is
  // `duration: Infinity` with no close button. Without this, leaving the
  // editor by any in-app link strands a red "Not saved" on every other page
  // for the rest of the session — undismissable, and beyond the reach of a
  // later recovery, whose freshly mounted chip has no memory of having warned.
  useEffect(
    () => () => {
      if (warned.current) toast.dismiss(TOAST_ID);
    },
    [],
  );

  const Icon = ICONS[state];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-live={stranded ? 'assertive' : 'polite'}
          // Radix adds no tabIndex to a bare span, which would leave the
          // tooltip hover-only — and the tooltip is where the "this tab is the
          // only copy" wording lives.
          tabIndex={0}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs whitespace-nowrap',
            stranded
              ? 'text-destructive font-medium'
              : 'text-muted-foreground',
            // The steady state is the least interesting thing in the header,
            // so it yields its room first when there is none to spare.
            state === 'saved' && 'hidden sm:flex',
            className,
          )}
        >
          <Icon size={14} aria-hidden />
          {LABELS[state]}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltipFor(state, pendingSince)}</TooltipContent>
    </Tooltip>
  );
}
