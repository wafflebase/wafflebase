import { isChunkLoadError } from "@/lib/lazy-with-retry";

/**
 * What the user sees when a render throw reaches the root error boundary.
 *
 * Deliberately built from plain elements and Tailwind classes rather than the
 * `ui/` primitives: this renders *because* something in the tree already
 * failed, so every import it pulls in is another thing that can fail with it.
 * Reload is a full document load, not a router navigation, because the React
 * tree that a navigation would re-render is the thing that just broke.
 *
 * `error` is optional so the component still renders something useful when a
 * caller has nothing to hand it.
 */
export function AppCrashFallback({ error }: { error?: unknown }) {
  // A chunk that would not load has already been retried and, where that was
  // safe, reloaded through — see `lib/lazy-with-retry.ts`. Reaching here means
  // neither worked, so "reloading usually clears it" would be a false promise,
  // and the likely cause is the user's connection, which they can act on.
  const chunk = isChunkLoadError(error);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <h1 className="text-lg font-semibold">
        {chunk ? "Couldn't finish loading" : "Something went wrong"}
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {chunk
          ? "Part of the app could not be downloaded. Check your connection and try again. Any document you had open is stored on the server, not in this tab."
          : "This page hit an unexpected error. Reloading usually clears it. Any document you had open is stored on the server, not in this tab."}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        {chunk ? "Try again" : "Reload"}
      </button>
    </div>
  );
}
