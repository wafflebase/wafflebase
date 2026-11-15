/**
 * Configuration and pure helpers for {@link DemoResetService}. Kept free of
 * Nest and Yorkie so the parsing, the schedule and the revision search can be
 * tested without either.
 */

export const DEFAULT_DEMO_RESET_LABEL = 'demo-golden';

/** 15:00 UTC is midnight in Korea, where the homepage's traffic is. */
export const DEFAULT_DEMO_RESET_HOUR_UTC = 15;

export interface DemoResetTarget {
  /** Share token of the demo document. */
  token: string;
  /**
   * The revision to restore, or `undefined` for an entry that is only being
   * set up: such an entry is never restored, only has its candidate revisions
   * logged so the operator can pick one.
   */
  revisionId?: string;
}

export interface DemoResetConfig {
  targets: DemoResetTarget[];
  /** Label the candidate listing filters on. Never chooses what is restored. */
  label: string;
  /** Hour of day, in UTC, the reset runs at. */
  hourUtc: number;
}

/**
 * Read the `WAFFLEBASE_DEMO_RESET_*` settings. Every value is optional; an
 * empty string counts as unset, which is how "unset" arrives from a k8s
 * `value: ""`.
 *
 * `WAFFLEBASE_DEMO_RESET_TARGETS` is a comma-separated list of
 * `<shareToken>:<revisionId>`. The revision is pinned by id, never looked up
 * by label at reset time: `CreateRevision` is not gated by the auth webhook,
 * and the demos are editor links, so anybody can create a revision with any
 * label — a label search would restore whatever they last named.
 *
 * An hour outside 0..23 falls back to the default rather than disabling the
 * reset, so a typo moves the run instead of silently stopping it.
 */
export function parseDemoResetConfig(
  get: (key: string) => string | undefined,
): DemoResetConfig {
  const byToken = new Map<string, DemoResetTarget>();
  for (const entry of (get('WAFFLEBASE_DEMO_RESET_TARGETS') ?? '').split(',')) {
    const [rawToken, rawRevision] = entry.split(':', 2);
    const token = rawToken?.trim();
    if (!token) continue;
    const revisionId = rawRevision?.trim() || undefined;
    byToken.set(token, { token, revisionId });
  }
  const label =
    get('WAFFLEBASE_DEMO_RESET_LABEL')?.trim() || DEFAULT_DEMO_RESET_LABEL;
  const rawHour = get('WAFFLEBASE_DEMO_RESET_HOUR_UTC')?.trim();
  const hour = rawHour ? Number(rawHour) : NaN;
  const hourUtc =
    Number.isInteger(hour) && hour >= 0 && hour <= 23
      ? hour
      : DEFAULT_DEMO_RESET_HOUR_UTC;
  return { targets: [...byToken.values()], label, hourUtc };
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
 * How many pages the candidate listing reads. Yorkie keeps one automatic
 * revision per 500 changes with no delete RPC, so the listing must stop
 * somewhere; 10 pages (500 revisions) reaches a version named during setup.
 */
export const REVISION_MAX_PAGES = 10;

/** At most this many candidates are logged per document. */
export const MAX_CANDIDATES = 5;

export interface RevisionRef {
  id: string;
  label: string;
  createdAt: Date;
}

/**
 * Collect up to {@link MAX_CANDIDATES} revisions labelled `label`, newest
 * first, reading newest-first pages from `listPage(offset)`.
 */
export async function findCandidateRevisions(
  listPage: (offset: number) => Promise<ReadonlyArray<RevisionRef>>,
  label: string,
): Promise<RevisionRef[]> {
  const found: RevisionRef[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < REVISION_MAX_PAGES; page++) {
    const revisions = await listPage(page * REVISION_PAGE_SIZE);
    for (const revision of revisions) {
      // A revision created between two page reads shifts the offsets by one,
      // so the boundary entry can come back twice.
      if (seen.has(revision.id) || revision.label.trim() !== label) continue;
      seen.add(revision.id);
      found.push(revision);
      if (found.length >= MAX_CANDIDATES) return found;
    }
    if (revisions.length < REVISION_PAGE_SIZE) break;
  }
  return found;
}
