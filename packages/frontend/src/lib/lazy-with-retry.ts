import * as Sentry from "@sentry/react";
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { isChunkLoadError } from "@/lib/chunk-load-error";
import { hasUnsavedWork } from "@/lib/unsaved-work";

/**
 * Recovery for a code-split chunk that fails to load.
 *
 * Every route in this app is a `lazy()` import, so a single failed chunk fetch
 * used to take the whole tree to the root error boundary and a full-screen
 * crash page. That is what Sentry `WAFFLEBASE-2` was: one mobile session on
 * `/w/jiyu`, two failures four seconds apart (`Layout` and
 * `WorkspaceDocuments` sit under the same `Suspense`), while every chunk the
 * page named was still being served — `docs/design/frontend.md` § Code
 * splitting and chunk-load recovery holds the evidence that ruled out a stale
 * deploy.
 *
 * The ladder here is retry, then reload, then give up:
 *
 * 1. Retry once in place. Cheap, and it covers the case where only the
 *    preload link failed and the module map was never poisoned.
 * 2. Reload the document. A retry cannot help when the failure IS the module
 *    map — an engine that has recorded a URL as failed keeps returning that
 *    failure — and a reload is also the only thing that fixes the other cause
 *    of this message, an `index.html` naming chunks a later deploy removed.
 * 3. Rethrow, and let the boundary render.
 */

/**
 * How long to wait before the in-place retry. Long enough for a momentary
 * radio dropout to clear, short enough to stay under the time a user would
 * spend deciding the page is broken.
 */
const RETRY_DELAY_MS = 500;

/**
 * Minimum gap between two recovery reloads in one tab.
 *
 * A guard is mandatory: a device that is failing every fetch would otherwise
 * reload forever. A one-SHOT guard would be wrong in the other direction — a
 * tab left open for a day would spend all but its first minute with no
 * recovery at all — so this is a rate limit rather than a latch.
 */
const RELOAD_WINDOW_MS = 10 * 60 * 1000;

/**
 * How long to keep waiting after asking for a reload.
 *
 * `reload()` does not suspend the caller — the document simply stops existing
 * a moment later — so something has to hold the tree on its Suspense fallback
 * across that moment instead of flashing the crash screen over a page that is
 * already being replaced. If the wait ever *finishes*, the reload did not
 * happen (a browser that refused it), and falling through to the boundary is
 * strictly better than leaving the user on a spinner with no way out.
 */
const RELOAD_GRACE_MS = 10_000;

const RELOAD_STAMP_KEY = "wafflebase:chunk-reload-at";

/**
 * The environment `loadWithRetry` touches, injected so the tests can drive it
 * without a real clock, a real `sessionStorage` or a real navigation.
 */
export interface ChunkRecoveryEnv {
  now(): number;
  /** `null` when storage is unavailable — Safari private mode throws. */
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  reload(): void;
  isOnline(): boolean;
  /** Whether a reload right now would discard edits not yet on the server. */
  hasUnsavedWork(): boolean;
  /** Reports the failure and flushes it; resolves either way. */
  report(error: unknown): Promise<void>;
  /**
   * Records a failure the retry absorbed. Not flushed — the page is staying,
   * and this must not delay the render it is about to unblock.
   */
  noteRecovered(error: unknown): void;
  delay(ms: number): Promise<void>;
}

/** The environment used in production. Exported so the tests can drive it. */
export function browserEnv(): ChunkRecoveryEnv {
  return {
    now: () => Date.now(),
    getItem: (key) => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        // Ignored here and caught in `canReload`, which treats a store it
        // cannot write as a reason not to reload at all.
      }
    },
    reload: () => window.location.reload(),
    // Only `false` counts as offline. `navigator.onLine` is unreliable in the
    // positive direction on every platform, so it is read as a veto and never
    // as permission.
    isOnline: () => navigator.onLine !== false,
    hasUnsavedWork,
    report: async (error) => {
      Sentry.captureException(error, {
        tags: { chunk_load_failed: "true", chunk_recovery: "reload" },
      });
      // The reload discards anything still queued, and this event is the only
      // record that the failure happened at all — recovery that hides its own
      // trigger turns a measurable problem into an invisible one.
      try {
        await Sentry.flush(2000);
      } catch {
        // A flush that fails must not cost the user their reload.
      }
    },
    // A retry that WORKS is the outcome this whole module exists to produce,
    // and it is also the one that erases its own evidence: the user sees a
    // normal page and Sentry sees nothing. Without this, a transient mobile
    // failure — WAFFLEBASE-2's exact shape — becomes unmeasurable the moment
    // the recovery ships, and nobody can tell whether rung 1 ever fires.
    // Reported at `warning`, since nothing is broken by the time it is sent.
    noteRecovered: (error) => {
      Sentry.captureException(error, {
        level: "warning",
        tags: { chunk_load_failed: "true", chunk_recovery: "retry" },
      });
    },
    delay: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}

/**
 * Whether a recovery reload is allowed right now.
 *
 * Every branch fails toward NOT reloading. A missed reload costs the user one
 * error screen with a working button on it; a reload loop costs them the page.
 */
function canReload(env: ChunkRecoveryEnv): boolean {
  // A reload while offline lands on the browser's own error page, which is
  // strictly worse than our fallback: no explanation, and no button that will
  // work when the connection returns.
  if (!env.isOnline()) return false;

  // The reload is ours, not the user's, and a document with edits still in the
  // change queue would lose them. `beforeunload` is not a backstop here: iOS —
  // the platform WAFFLEBASE-2 came from — routinely ignores it. Showing the
  // fallback keeps both the page and the work, and its button puts the same
  // reload one deliberate click away, behind whatever prompt the browser does
  // honor. Checked before the stamp below, so declining costs no budget.
  if (env.hasUnsavedWork()) return false;

  const stamp = env.getItem(RELOAD_STAMP_KEY);
  if (stamp === null) {
    // Either nothing is recorded, or the store is unreadable. Writing is the
    // only thing that makes the guard real, so prove the write took.
    env.setItem(RELOAD_STAMP_KEY, String(env.now()));
    return env.getItem(RELOAD_STAMP_KEY) !== null;
  }

  const last = Number(stamp);
  // An unparseable stamp is someone else's value or a corrupted one. Refusing
  // is safe; overwriting it would hand a loop a fresh budget on every pass.
  if (!Number.isFinite(last)) return false;

  const elapsed = env.now() - last;
  // A stamp from the future means the clock moved backwards, or a restored tab
  // carried one in. Refuse this pass, but CLAMP it to now rather than latching:
  // nothing else ever rewrites it, so leaving it would disable recovery for the
  // rest of the tab's life. Writing `now` cannot open a loop — the window check
  // below blocks the next pass just the same.
  if (elapsed < 0) {
    env.setItem(RELOAD_STAMP_KEY, String(env.now()));
    return false;
  }
  if (elapsed < RELOAD_WINDOW_MS) return false;

  env.setItem(RELOAD_STAMP_KEY, String(env.now()));
  return true;
}

/**
 * Runs `importer`, recovering from a chunk that will not load.
 *
 * Resolves with the module on success. On an unrecoverable failure it rejects
 * with the ORIGINAL error, so what the boundary and Sentry see is the real
 * cause rather than whatever the last retry happened to produce.
 */
export async function loadWithRetry<T>(
  importer: () => Promise<T>,
  env: ChunkRecoveryEnv = browserEnv(),
): Promise<T> {
  try {
    return await importer();
  } catch (error) {
    if (!isChunkLoadError(error)) throw error;

    await env.delay(RETRY_DELAY_MS);
    try {
      const recovered = await importer();
      env.noteRecovered(error);
      return recovered;
    } catch (retryError) {
      if (!isChunkLoadError(retryError)) throw retryError;
    }

    if (canReload(env)) {
      try {
        await env.report(error);
      } catch {
        // Best-effort. Reporting must never cost the user the reload, and the
        // budget for that reload has already been spent.
      }
      try {
        env.reload();
        // Holds the tree on its Suspense fallback while the document is
        // replaced. If this ever returns, the reload did not take — see
        // `RELOAD_GRACE_MS` — and the throw below renders the boundary.
        await env.delay(RELOAD_GRACE_MS);
      } catch {
        // A reload that threw is a reload that did not happen.
      }
    }

    throw error;
  }
}

/**
 * `React.lazy`, with the recovery above. A drop-in replacement: on the happy
 * path it adds one `await` and nothing else.
 *
 * The constraint is copied verbatim from `React.lazy`, `any` included. A
 * narrower one does not work: props are contravariant, so `ComponentType<never>`
 * admits the component types but leaves the returned `LazyExoticComponent<T>`
 * unassignable at every call site.
 */
export function lazyWithRetry<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends ComponentType<any>,
>(importer: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  return lazy(() => loadWithRetry(importer));
}

/** Exported for the tests, which must not restate the literals above. */
export const CHUNK_RECOVERY_INTERNALS = {
  RETRY_DELAY_MS,
  RELOAD_WINDOW_MS,
  RELOAD_GRACE_MS,
  RELOAD_STAMP_KEY,
};
