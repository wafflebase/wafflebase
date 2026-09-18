/**
 * One place to ask "would replacing this document right now lose the user's
 * work?".
 *
 * `SyncStatusChip` owns the answer: it lives inside the `DocumentProvider`
 * that knows about the change queue, and it already asks the same question for
 * `beforeunload` and for in-app navigation (docs/design/sync-status.md). The
 * recovery reload in `lib/lazy-with-retry.ts` has to ask it too, and that is
 * plain module code with no React context to read. This registry is the seam
 * between them, so neither has to import the other.
 *
 * Deliberately NOT a general "app state" module. The only question it answers
 * is the one above, and the only correct use of the answer is to refuse to
 * discard the page.
 */

type UnsavedWorkProbe = () => boolean;

const probes = new Set<UnsavedWorkProbe>();

/**
 * Registers a probe for as long as something is at risk. Returns the
 * unregister function, so it drops straight into a `useEffect`.
 */
export function registerUnsavedWorkProbe(probe: UnsavedWorkProbe): () => void {
  probes.add(probe);
  return () => {
    probes.delete(probe);
  };
}

/**
 * Whether any mounted document has work that has not reached the server.
 *
 * A probe that throws counts as "yes". The caller is deciding whether to throw
 * the page away, and an unanswerable question is not permission.
 */
export function hasUnsavedWork(): boolean {
  for (const probe of probes) {
    try {
      if (probe()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** Test-only: drops every registration. */
export function resetUnsavedWorkProbes(): void {
  probes.clear();
}
