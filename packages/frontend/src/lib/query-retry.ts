import { isAuthExpiredError } from "@/api/auth";
import { HttpError } from "@/api/http-error";

/** React Query's own default: three retries after the first attempt. */
const MAX_RETRIES = 3;

/**
 * The app-wide default `retry` for React Query.
 *
 * The library default retries every failure three times with exponential
 * backoff — about seven seconds of skeleton before an error screen. That is
 * the right wait for a dropped connection or a 503, and the wrong one for a
 * 404 or a 403: the server has answered, and asking again gets the same
 * answer. So a 4xx fails at once, except 408 and 429, which say "later" by
 * definition. An expired session is not retried either; the auth layer
 * already tried a refresh before throwing it.
 *
 * Queries that must not retry at all keep their own `retry: false`.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isAuthExpiredError(error)) return false;
  if (
    error instanceof HttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  ) {
    return false;
  }
  return failureCount < MAX_RETRIES;
}
