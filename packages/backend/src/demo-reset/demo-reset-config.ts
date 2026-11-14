/**
 * Configuration and pure helpers for {@link DemoResetService}. Kept free of
 * Nest and Yorkie so the parsing, the schedule and the revision search can be
 * tested without either.
 */

export const DEFAULT_DEMO_RESET_LABEL = 'demo-golden';

/** 15:00 UTC is midnight in Korea, where the homepage's traffic is. */
export const DEFAULT_DEMO_RESET_HOUR_UTC = 15;

export interface DemoResetConfig {
  /** Share tokens of the documents to reset. Empty disables the feature. */
  tokens: string[];
  /** Label of the named revision each document is restored to. */
  label: string;
  /** Hour of day, in UTC, the reset runs at. */
  hourUtc: number;
}

/**
 * Read the three `WAFFLEBASE_DEMO_RESET_*` settings. Every value is optional;
 * an empty string counts as unset, which is how "unset" arrives from a k8s
 * `value: ""`. An hour outside 0..23 falls back to the default rather than
 * disabling the reset, so a typo moves the run instead of silently stopping it.
 */
export function parseDemoResetConfig(
  get: (key: string) => string | undefined,
): DemoResetConfig {
  const tokens = [
    ...new Set(
      (get('WAFFLEBASE_DEMO_RESET_TOKENS') ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
  const label =
    get('WAFFLEBASE_DEMO_RESET_LABEL')?.trim() || DEFAULT_DEMO_RESET_LABEL;
  const rawHour = get('WAFFLEBASE_DEMO_RESET_HOUR_UTC')?.trim();
  const hour = rawHour ? Number(rawHour) : NaN;
  const hourUtc =
    Number.isInteger(hour) && hour >= 0 && hour <= 23
      ? hour
      : DEFAULT_DEMO_RESET_HOUR_UTC;
  return { tokens, label, hourUtc };
}

/**
 * Milliseconds from `now` until the next `hourUtc`:00:00 UTC. Exactly on the
 * hour counts as already past, so a run that fires on time schedules the next
 * one a day later rather than immediately again.
 */
export function msUntilNextRun(now: Date, hourUtc: number): number {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hourUtc,
    ),
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export const REVISION_PAGE_SIZE = 50;

/**
 * How many pages the search reads before giving up. Yorkie keeps one
 * automatic revision per 500 changes with no delete RPC, so on a busy demo
 * the golden revision sinks over time; 40 pages (2,000 revisions) is far
 * deeper than a daily reset lets it sink, and still bounds a missing label to
 * a fixed amount of work.
 */
export const REVISION_MAX_PAGES = 40;

export interface RevisionRef {
  id: string;
  label: string;
}

/**
 * Find the newest revision labelled `label`, reading newest-first pages from
 * `listPage(offset)`. Returns `null` when no such revision exists within
 * {@link REVISION_MAX_PAGES}.
 */
export async function findNewestRevision(
  listPage: (offset: number) => Promise<ReadonlyArray<RevisionRef>>,
  label: string,
): Promise<RevisionRef | null> {
  for (let page = 0; page < REVISION_MAX_PAGES; page++) {
    const revisions = await listPage(page * REVISION_PAGE_SIZE);
    const match = revisions.find((r) => r.label.trim() === label);
    if (match) return match;
    if (revisions.length < REVISION_PAGE_SIZE) return null;
  }
  return null;
}
