/**
 * Recognizing a code-split chunk that would not load.
 *
 * Its own module, with NO imports, because `AppCrashFallback` asks this
 * question and that component renders *because* something already failed — its
 * header comment commits it to pulling in nothing that can fail with it.
 * Importing `lazy-with-retry.ts` for the predicate would have dragged
 * `@sentry/react` and the unsaved-work registry in behind it.
 */

/**
 * Messages the JavaScript engines use when a dynamic import never loads.
 *
 * Matching on message text is unlovely, but there is nothing else: a failed
 * `import()` rejects with a plain `TypeError` carrying no code, no status and
 * no `cause`. The list is deliberately SHORT — everything it does not match is
 * treated as a module that loaded and then threw, which is a real bug and must
 * reach an error boundary on its first throw rather than be retried or
 * reloaded into an undiagnosable loop.
 */
const CHUNK_LOAD_MESSAGES = [
  // WebKit (Safari, and every iOS browser). The one in Sentry WAFFLEBASE-2.
  "importing a module script failed",
  // Chromium.
  "failed to fetch dynamically imported module",
  // Firefox.
  "error loading dynamically imported module",
  // Vite's own preload helper, when the chunk's stylesheet is the casualty.
  "unable to preload css",
];

/**
 * Whether this rejection is a chunk that would not load, as opposed to a
 * module that loaded and then threw.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!message) return false;
  const normalized = message.toLowerCase();
  return CHUNK_LOAD_MESSAGES.some((known) => normalized.includes(known));
}
