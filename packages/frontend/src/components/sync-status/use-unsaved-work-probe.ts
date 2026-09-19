import { useEffect } from 'react';
import { registerUnsavedWorkProbe } from '@/lib/unsaved-work';
import { useSyncStatus } from './use-sync-status';

/**
 * Registers this document's "are there edits the server has not taken?" read
 * into `lib/unsaved-work.ts`, so a reload the app initiates for itself can
 * decline (docs/design/sync-status.md § The third consumer).
 *
 * Split out of `SyncStatusChip` because the chip is not mountable everywhere
 * the answer matters. `/f/:id` attaches a real Yorkie document for PDF
 * comments and annotations, but `FileShell` renders `SiteHeader` — and so the
 * chip — ABOVE the `CollabDocumentProvider`, where `useSyncStatus` has nothing
 * to read. A headless probe can sit inside the provider instead.
 *
 * The `active` split matches the unload guard exactly: registering is keyed on
 * the smoothed state, which is cheap and safe to be wrong about, while the
 * answer is `hasUnsentEdits` asked live at the moment the reload is decided.
 */
export function useUnsavedWorkProbe(): void {
  const { state, hasUnsentEdits } = useSyncStatus();
  // `Saving…` counts: the work is not on the server yet, and a reload during
  // it loses the edit just as surely as one while disconnected.
  const mayHaveUnsent = state === 'not-saved' || state === 'saving';

  useEffect(() => {
    if (!mayHaveUnsent) return;
    return registerUnsavedWorkProbe(hasUnsentEdits);
  }, [mayHaveUnsent, hasUnsentEdits]);
}
