import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  IconAlertTriangle,
  IconCheck,
  IconCloudUpload,
  IconDeviceDesktop,
  IconRefresh,
} from '@tabler/icons-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useNavigationGuard } from '@/components/navigation-guard/use-navigation-guard';
import { useUnsavedWorkProbe } from './use-unsaved-work-probe';
import { cn } from '@/lib/utils';
import {
  setOfflinePersistenceEnabled,
  useOfflinePersistenceEnabled,
} from '@/lib/offline-persistence-preference';
import { supportsClientKey } from '@/lib/yorkie-capabilities';
import { useDurabilityLapse } from '@/lib/durable-document-context';
import { useSyncStatus } from './use-sync-status';
import { tooltipFor } from './sync-status-tooltip';
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
  'saved-locally': 'Saved to this device',
  'not-saved': 'Not saved',
};

const ICONS: Record<SyncState, typeof IconCheck> = {
  saved: IconCheck,
  saving: IconCloudUpload,
  reconnecting: IconRefresh,
  // Deliberately the same tick as `saved`, not a warning: the work *is* saved,
  // just not where the server can see it yet. An alarm icon would undo the
  // whole point of the state.
  'saved-locally': IconDeviceDesktop,
  'not-saved': IconAlertTriangle,
};


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
  const { state, connected, hasUnsentEdits, pendingSince } = useSyncStatus();
  const stranded = state === 'not-saved';
  const lapse = useDurabilityLapse();
  const offlineEnabled = useOfflinePersistenceEnabled();
  // Offered only where it is both possible and useful: a build that can carry
  // a client key (see `yorkie-capabilities.ts` — without one nothing is
  // persisted), the device has not already opted in, and there is work at risk
  // right now. A call to action on a healthy document would be an
  // advertisement.
  //
  // And never where the answer is already no. `not-permitted` is the subtree
  // that must never persist — the share-link route wraps itself in
  // `NonDurableScope`, and the design excludes anonymous share links from this
  // feature outright — so the offer there promises a visitor something that
  // cannot happen for this document however they answer it, and for an
  // anonymous one there is no account for the preference to ever apply to. The
  // lapse is what carries that fact to the chip: it is published above every
  // editor on that route and nowhere else.
  const offerOffline =
    stranded &&
    supportsClientKey() &&
    !offlineEnabled &&
    lapse !== 'not-permitted';

  const turnOnOfflineSaving = useCallback(() => {
    setOfflinePersistenceEnabled(true);
    // Honest about when it applies. The decision to persist is made when a
    // document is opened — changing it under a mounted editor would tear the
    // editor down and take the very changes this chip is warning about with
    // it — so this one is not rescued retroactively.
    toast.success('Saving on this device is on', {
      description:
        'Documents you open from now on keep un-sent changes on this device, so a reload no longer loses them. Turn it off in Settings; doing so deletes what was stored.',
    });
  }, []);
  // `Saving…` is not safe either — the work is not on the server yet, and a
  // reload during it loses the edit just as surely as one while disconnected.
  //
  // `saved-locally` is deliberately absent, and only from *this* one. A reload
  // is the case the state was designed for: the entry is on the disk and the
  // next attach resumes from it, so prompting would warn about the very loss
  // the feature just prevented.
  const mayHaveUnsent = stranded || state === 'saving';

  // The same moment, on a document whose work *is* on disk. The design states
  // it as a consequence that "follows automatically" from `durable`: the
  // offline-transition toast changes from "keep this tab open" to "saved to
  // this device". Without it the durable case is the one that interrupts
  // nobody — which sounds like restraint, and reads to the user as the app
  // having said nothing about work it has stopped sending to the server.
  const savedLocally = state === 'saved-locally';

  // Leaving the document is **not** the same event as reloading it, and this is
  // the one place the two have to be told apart.
  //
  // An in-app route change unmounts the `DocumentProvider`, which detaches the
  // document — and the SDK's `detachDocument` calls `removeFromStore`
  // unconditionally on its success path (see `wafflebase-doc-store.ts`
  // § `expectLoss`). The store archives a removal only when a
  // `LocalChangesDropped` latched it first, which an ordinary detach never
  // does, so leaving deletes the durable entry *and* the in-memory queue with
  // it. `saved-locally` is reachable while connected — the server rejecting
  // pushes — so this is not a disconnected-only path either.
  //
  // Hence: no `beforeunload` for `saved-locally` (a reload is safe), but the
  // same confirmation every other unsent state gets before the tab walks away
  // from the only copy.
  const leavingLosesWork = mayHaveUnsent || savedLocally;

  // Registered only while something could be at risk; a handler left
  // permanently attached would prompt on every navigation away from a
  // perfectly synced document, which teaches people to click through it.
  //
  // Whether it actually blocks is decided at fire time, because `Saving…`
  // persists through a quiet window after the last keystroke: by then the
  // server has usually taken the work, and prompting anyway would put a dialog
  // in front of every reload for two seconds after any edit.
  useEffect(() => {
    if (!mayHaveUnsent) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsentEdits()) return;
      event.preventDefault();
      // Legacy browsers require a returnValue to show the prompt at all; the
      // string itself has been ignored by every current browser for years.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [mayHaveUnsent, hasUnsentEdits]);

  // `beforeunload` is not enough for a reload this app initiates itself. The
  // chunk-load recovery in `lib/lazy-with-retry.ts` reloads the document to
  // replace a module the browser would not fetch, and iOS — the platform the
  // failure was reported from — routinely ignores `beforeunload` entirely, so
  // that reload would take the queued edits with it and show no prompt. Shared
  // with the headless probe `/f/:id` mounts, which has no chip to hang it on.
  useUnsavedWorkProbe();

  // `beforeunload` does not fire for a route change, and a route change is the
  // *more common* way to leave an editor: one click on a sidebar link unmounts
  // the `DocumentProvider` and discards the change queue with nothing said. So
  // the same condition, asked the same way at fire time, also holds back in-app
  // navigation — the dialog is the confirmation the browser would have shown.
  //
  // Coverage follows this component: the five editable editors through
  // `SiteHeader`'s `syncStatus`, and share-link *editors* through
  // `SharedHeaderStatus`. A viewer gets the "View only" badge instead of a
  // chip, so no guard is ever registered for one.
  useNavigationGuard(
    leavingLosesWork,
    useCallback(
      () =>
        hasUnsentEdits()
          ? {
              title: 'Leave without saving?',
              // The same claim the tooltip makes, in the one place where acting
              // on it is about to cost the work — and on a durable document,
              // the one place where the tooltip's claim stops holding: closing
              // it removes the entry the tooltip is pointing at.
              description: savedLocally
                ? "Your recent changes haven't reached the server. They are saved on this device only while this document stays open — leaving it closes the document and removes that copy, so they would be lost."
                : "Your recent changes haven't reached the server. They exist only in this tab, so leaving this document will lose them.",
              confirmLabel: 'Leave',
            }
          : null,
      [hasUnsentEdits, savedLocally],
    ),
  );

  // Tracks whether the warning is currently on screen, so recovery only
  // confirms when there was something to recover from.
  const warned = useRef(false);

  useEffect(() => {
    if (savedLocally) {
      const timer = setTimeout(() => {
        // Latched like the warning's, so the recovery arm below retracts this
        // one too and confirms once the work actually reaches the server.
        warned.current = true;
        // `info`, not `warning`: nothing is at risk, and dressing it as an
        // alarm would undo the state it is announcing. Finite duration for the
        // same reason — the warning stays until it stops being true because
        // acting on it is urgent; this is a notification.
        toast.info('Saved to this device', {
          id: TOAST_ID,
          description: connected
            ? "The server rejected your recent changes, so they aren't there yet. They are saved on this device and will be sent when syncing resumes."
            : "Your connection dropped, so recent changes haven't reached the server. They are saved on this device and will be sent when the connection returns.",
        });
      }, TOAST_DELAY_MS);
      return () => clearTimeout(timer);
    }

    if (stranded) {
      const timer = setTimeout(() => {
        warned.current = true;
        toast.warning('Not saved', {
          id: TOAST_ID,
          duration: Infinity,
          // `Not saved` is reached two ways, and they call for different
          // advice. Telling someone whose connection is fine that it dropped
          // sends them to debug the wrong thing.
          description: connected
            ? "The server rejected your recent changes, so they haven't been saved. Keep this tab open — closing it will lose them."
            : "Your connection dropped and recent changes haven't reached the server. Keep this tab open; they'll sync when the connection returns.",
          // The second of the design's two entry points, and the one somebody
          // is actually looking at when they discover they wanted the setting.
          // Absent once the device has opted in, and on a build that cannot
          // honour it.
          //
          // Named for what it does: the preference applies to documents opened
          // after it, never to the one this toast is about. `Save on this
          // device`, next to "closing this tab will lose them", reads as an
          // offer to save *them*.
          action: offerOffline
            ? {
                label: 'Turn on for later documents',
                onClick: turnOnOfflineSaving,
              }
            : undefined,
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
  }, [
    savedLocally,
    stranded,
    state,
    connected,
    offerOffline,
    turnOnOfflineSaving,
  ]);

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
        {/* A button only while it has something to do. The chip is a status
            first, so it stays a plain span in every other state rather than
            presenting an action that would do nothing. */}
        {offerOffline ? (
          <button
            type="button"
            role="status"
            aria-live="assertive"
            onClick={turnOnOfflineSaving}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs whitespace-nowrap',
              'text-destructive font-medium underline-offset-2 hover:underline',
              className,
            )}
          >
            <Icon size={14} aria-hidden />
            {LABELS[state]}
          </button>
        ) : (
          <span
            role="status"
            aria-live={stranded ? 'assertive' : 'polite'}
            // Radix adds no tabIndex to a bare span, which would leave the
            // tooltip hover-only — and the tooltip is where the "this tab is
            // the only copy" wording lives.
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
        )}
      </TooltipTrigger>
      <TooltipContent>
        {tooltipFor(state, pendingSince, connected, offerOffline, lapse)}
      </TooltipContent>
    </Tooltip>
  );
}
