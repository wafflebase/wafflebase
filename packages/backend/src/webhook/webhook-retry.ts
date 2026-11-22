import {
  DISABLE_AFTER_FAILING_MS,
  MAX_ATTEMPTS,
  MIN_FAILURE_SPAN_MS,
  RETRY_AFTER_CAP_MS,
  RETRY_JITTER,
  RETRY_SCHEDULE_SECONDS,
  WARN_AFTER_FAILING_MS,
} from './webhook-config';

/**
 * Pure retry and disable decisions for the delivery worker, kept apart from
 * it so the schedule can be tested without a database or a clock. See
 * `docs/design/webhooks.md` § Retries and disable.
 */

export type ResponseClass = 'success' | 'gone' | 'rate_limited' | 'failure';

/**
 * Only 2xx is success. A 3xx is a failure (redirects are never followed),
 * `410 Gone` disables the webhook, `429` honours `Retry-After`.
 */
export function classifyStatus(status: number): ResponseClass {
  if (status >= 200 && status < 300) return 'success';
  if (status === 410) return 'gone';
  if (status === 429) return 'rate_limited';
  return 'failure';
}

/**
 * How long to wait before the next attempt, given how many attempts have been
 * made (the one that just failed included). `null` once the schedule is
 * spent: the delivery is `failed`. Jittered by ±{@link RETRY_JITTER} so a
 * burst of rows failing together does not retry together.
 */
export function nextRetryDelayMs(
  attemptsMade: number,
  random: () => number = Math.random,
): number | null {
  if (attemptsMade >= MAX_ATTEMPTS) return null;
  const base = RETRY_SCHEDULE_SECONDS[Math.max(attemptsMade, 0)] * 1000;
  const factor = 1 + (random() * 2 - 1) * RETRY_JITTER;
  return Math.round(base * factor);
}

/**
 * A `Retry-After` header as milliseconds from `now`: delta-seconds or an HTTP
 * date, capped at {@link RETRY_AFTER_CAP_MS}. `null` when absent or
 * unparseable, which falls back to the schedule.
 */
export function parseRetryAfterMs(
  value: string | undefined,
  now: Date,
): number | null {
  const text = value?.trim();
  if (!text) return null;
  let ms: number;
  if (/^\d+$/.test(text)) {
    ms = Number(text) * 1000;
  } else {
    // An HTTP date names its month; a bare `-5` or `1.5` would otherwise
    // parse as a year.
    if (!/[a-z]/i.test(text)) return null;
    const at = Date.parse(text);
    if (Number.isNaN(at)) return null;
    ms = at - now.getTime();
  }
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, 0), RETRY_AFTER_CAP_MS);
}

export type FailurePlan =
  | { status: 'pending'; nextAttemptAt: Date }
  | { status: 'failed' };

/**
 * What a failed attempt does to its delivery row. A 429 with a usable
 * `Retry-After` waits that long instead of the scheduled delay, but still
 * spends an attempt: a receiver that answers 429 forever must not keep a row
 * alive forever.
 */
export function planFailure(input: {
  attemptsMade: number;
  now: Date;
  retryAfterMs?: number | null;
  random?: () => number;
}): FailurePlan {
  const delay = nextRetryDelayMs(input.attemptsMade, input.random);
  if (delay === null) return { status: 'failed' };
  const wait =
    input.retryAfterMs !== null && input.retryAfterMs !== undefined
      ? input.retryAfterMs
      : delay;
  return {
    status: 'pending',
    nextAttemptAt: new Date(input.now.getTime() + wait),
  };
}

export type StreakDecision = 'disable' | 'warn' | null;

/**
 * What the current failure streak calls for after another failure.
 *
 * - `disable` once nothing has succeeded for {@link DISABLE_AFTER_FAILING_MS}
 *   (3 days) and the failures span at least {@link MIN_FAILURE_SPAN_MS}
 *   (12 h). `failingSince` is the streak's first failure and `now` its
 *   latest, so a single stale failure followed by silence never disables.
 * - `warn` once, when the streak is {@link WARN_AFTER_FAILING_MS} old
 *   (2 days, so a day before the disable) and nobody has been warned yet.
 */
export function streakDecision(input: {
  failingSince: Date | null;
  warnedAt: Date | null;
  now: Date;
}): StreakDecision {
  const { failingSince, warnedAt, now } = input;
  if (!failingSince) return null;
  const age = now.getTime() - failingSince.getTime();
  if (age >= DISABLE_AFTER_FAILING_MS && age >= MIN_FAILURE_SPAN_MS) {
    return 'disable';
  }
  if (age >= WARN_AFTER_FAILING_MS && !warnedAt) return 'warn';
  return null;
}
