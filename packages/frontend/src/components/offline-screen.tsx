import { useEffect } from "react";

/**
 * What a route guard shows when the session check got no response at all.
 *
 * Until now that case fell through to "not signed in" and sent the user to
 * the sign-in page, which is wrong twice: they are probably still signed in,
 * and signing in cannot work without the server either. With the offline app
 * shell (`service-worker/sw.js`) this is also the first screen of an app
 * opened with no network, so it says what is true and nothing more: the app
 * is here, the documents are on the server. It makes no claim that anything
 * is available offline, because nothing is yet.
 *
 * Plain elements and Tailwind classes, like `AppCrashFallback`, so that it
 * lives in the entry bundle and renders from the offline shell's boot set.
 */
export function OfflineScreen({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying: boolean;
}) {
  // The browser's own signal that the connection came back. Unreliable in
  // the positive direction (see `lib/lazy-with-retry.ts`), which is fine
  // here: a false "online" only costs one more failed check.
  useEffect(() => {
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [onRetry]);

  return (
    <div
      role="alert"
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground"
    >
      <h1 className="text-lg font-semibold">You're offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Wafflebase can't reach its server. Your documents are stored there,
        so they open again once the connection is back.
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-ring disabled:opacity-60"
      >
        {retrying ? "Checking…" : "Try again"}
      </button>
    </div>
  );
}
