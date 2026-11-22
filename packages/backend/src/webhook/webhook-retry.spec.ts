import { MAX_ATTEMPTS, RETRY_AFTER_CAP_MS } from './webhook-config';
import {
  classifyStatus,
  nextRetryDelayMs,
  parseRetryAfterMs,
  planFailure,
  streakDecision,
} from './webhook-retry';

const HOUR = 60 * 60 * 1000;
const mid = () => 0.5; // no jitter

describe('classifyStatus', () => {
  it.each([
    [200, 'success'],
    [204, 'success'],
    [299, 'success'],
    [301, 'failure'],
    [302, 'failure'],
    [400, 'failure'],
    [410, 'gone'],
    [429, 'rate_limited'],
    [500, 'failure'],
    [503, 'failure'],
  ])('%i is %s', (status, expected) => {
    expect(classifyStatus(status)).toBe(expected);
  });
});

describe('nextRetryDelayMs', () => {
  it('follows the Svix schedule after each attempt', () => {
    // After attempt n the next one waits schedule[n].
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => nextRetryDelayMs(n, mid))).toEqual([
      5_000, 300_000, 1_800_000, 7_200_000, 18_000_000, 36_000_000, 36_000_000,
    ]);
  });

  it('gives up after eight attempts', () => {
    expect(MAX_ATTEMPTS).toBe(8);
    expect(nextRetryDelayMs(8, mid)).toBeNull();
    expect(nextRetryDelayMs(9, mid)).toBeNull();
  });

  it('jitters by at most ten percent either way', () => {
    expect(nextRetryDelayMs(2, () => 0)).toBe(270_000);
    expect(nextRetryDelayMs(2, () => 1)).toBe(330_000);
  });
});

describe('parseRetryAfterMs', () => {
  const now = new Date('2026-11-22T00:00:00Z');

  it('reads delta-seconds', () => {
    expect(parseRetryAfterMs('120', now)).toBe(120_000);
  });

  it('reads an HTTP date', () => {
    expect(parseRetryAfterMs('Sun, 22 Nov 2026 00:00:30 GMT', now)).toBe(
      30_000,
    );
  });

  it('caps at an hour', () => {
    expect(parseRetryAfterMs('86400', now)).toBe(RETRY_AFTER_CAP_MS);
  });

  it('treats a date in the past as now', () => {
    expect(parseRetryAfterMs('Sat, 21 Nov 2026 00:00:00 GMT', now)).toBe(0);
  });

  it.each([undefined, '', 'soon', '-5', '1.5'])('ignores %p', (value) => {
    expect(parseRetryAfterMs(value, now)).toBeNull();
  });
});

describe('planFailure', () => {
  const now = new Date('2026-11-22T00:00:00Z');

  it('schedules the next attempt', () => {
    expect(planFailure({ attemptsMade: 1, now, random: mid })).toEqual({
      status: 'pending',
      nextAttemptAt: new Date(now.getTime() + 5_000),
    });
  });

  it('fails the row once the schedule is spent', () => {
    expect(planFailure({ attemptsMade: 8, now, random: mid })).toEqual({
      status: 'failed',
    });
  });

  it('waits Retry-After instead of the schedule on a 429', () => {
    expect(
      planFailure({ attemptsMade: 1, now, retryAfterMs: 90_000, random: mid }),
    ).toEqual({
      status: 'pending',
      nextAttemptAt: new Date(now.getTime() + 90_000),
    });
  });

  it('still spends the attempt on a 429', () => {
    expect(
      planFailure({ attemptsMade: 8, now, retryAfterMs: 1_000, random: mid }),
    ).toEqual({ status: 'failed' });
  });
});

describe('streakDecision', () => {
  const now = new Date('2026-11-22T00:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('does nothing without a streak', () => {
    expect(streakDecision({ failingSince: null, warnedAt: null, now })).toBe(
      null,
    );
  });

  it('does nothing in the first two days', () => {
    expect(
      streakDecision({ failingSince: ago(47 * HOUR), warnedAt: null, now }),
    ).toBeNull();
  });

  it('warns once after two days', () => {
    expect(
      streakDecision({ failingSince: ago(48 * HOUR), warnedAt: null, now }),
    ).toBe('warn');
    expect(
      streakDecision({
        failingSince: ago(50 * HOUR),
        warnedAt: ago(2 * HOUR),
        now,
      }),
    ).toBeNull();
  });

  it('disables after three days of failures', () => {
    expect(
      streakDecision({
        failingSince: ago(72 * HOUR),
        warnedAt: ago(24 * HOUR),
        now,
      }),
    ).toBe('disable');
    // Even when the warning never went out (e.g. the worker was down).
    expect(
      streakDecision({ failingSince: ago(80 * HOUR), warnedAt: null, now }),
    ).toBe('disable');
  });
});
