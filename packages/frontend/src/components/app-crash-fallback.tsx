/**
 * What the user sees when a render throw reaches the root error boundary.
 *
 * Deliberately built from plain elements and Tailwind classes rather than the
 * `ui/` primitives: this renders *because* something in the tree already
 * failed, so every import it pulls in is another thing that can fail with it.
 * Reload is a full document load, not a router navigation, because the React
 * tree that a navigation would re-render is the thing that just broke.
 */
export function AppCrashFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This page hit an unexpected error. Reloading usually clears it. Any
        document you had open is stored on the server, not in this tab.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Reload
      </button>
    </div>
  );
}
