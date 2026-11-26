import * as path from 'node:path';
import type { SyncOutcome } from './template-sync';
import type { ThumbnailLookup } from './thumbnail-manifest';
import type { SeedThumbnail } from './template-sync';
import type { TemplateSeed } from './types';

/**
 * The parts of `sync-templates.ts` that are not Nest wiring: argument
 * parsing, the single-run lock, seed selection and the per-seed loop. Kept
 * here so they can be tested without booting an application context.
 */

export interface SyncArgs {
  authorId: number;
  thumbnails: string;
  workspaceId?: string;
  eventTimeoutMs: number;
  slugs: string[];
}

export const SYNC_USAGE =
  'Usage: pnpm backend sync:templates --author <userId> --thumbnails <dir> ' +
  '[--workspace <id>] [--event-timeout <seconds>] [slug...]';

const OPTIONS = ['author', 'thumbnails', 'workspace', 'event-timeout'];

export function parseSyncArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): SyncArgs {
  const values: Record<string, string> = {};
  const slugs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!OPTIONS.includes(name)) {
        throw new Error(`${SYNC_USAGE}\nUnknown option: ${a}`);
      }
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) {
        throw new Error(`${SYNC_USAGE}\n${a} needs a value`);
      }
      values[name] = v;
    } else {
      slugs.push(a);
    }
  }

  const authorId = Number(values.author ?? env.SEED_AUTHOR_ID);
  const thumbnails = values.thumbnails;
  const timeout = Number(values['event-timeout'] ?? 30);
  if (!Number.isSafeInteger(authorId) || authorId <= 0) {
    throw new Error(`${SYNC_USAGE}\n--author must be a positive user id`);
  }
  if (!thumbnails) throw new Error(`${SYNC_USAGE}\n--thumbnails is required`);
  if (!(timeout > 0) || !Number.isFinite(timeout)) {
    throw new Error(`${SYNC_USAGE}\n--event-timeout must be positive seconds`);
  }
  return {
    authorId,
    // `pnpm --filter` runs this from the package directory.
    thumbnails: path.resolve(env.INIT_CWD ?? process.cwd(), thumbnails),
    workspaceId: values.workspace,
    eventTimeoutMs: timeout * 1000,
    slugs,
  };
}

/** The catalogue entries a run covers: all of them, or the named slugs. */
export function selectSeeds(
  catalog: readonly TemplateSeed[],
  slugs: readonly string[],
): readonly TemplateSeed[] {
  const unknown = slugs.filter((s) => !catalog.some((seed) => seed.slug === s));
  if (unknown.length > 0) {
    throw new Error(`Unknown seed slug(s): ${unknown.join(', ')}`);
  }
  return slugs.length > 0
    ? catalog.filter((seed) => slugs.includes(seed.slug))
    : catalog;
}

/**
 * One run at a time per deployment. Two concurrent runs would both see a seed
 * without a listing and both publish; the service's CAS writes would keep the
 * listings consistent, but the second run would orphan a thumbnail upload and
 * report confusing failures.
 */
export const SYNC_LOCK_KEY = 0x7761_6673_796e; // "wafsyn"

/** The slice of `pg.Client` the lock uses. */
export interface LockClient {
  connect(): Promise<unknown>;
  query<R extends Record<string, unknown>>(
    text: string,
    values: unknown[],
  ): Promise<{ rows: R[] }>;
  end(): Promise<unknown>;
}

/**
 * A session-level advisory lock on a dedicated connection — not through
 * Prisma, whose pool would hand the unlock to a different session. Needs a
 * direct (session-mode) connection; a transaction-mode pooler drops it.
 */
export async function acquireSyncLock(client: LockClient): Promise<void> {
  await client.connect();
  const { rows } = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [SYNC_LOCK_KEY],
  );
  if (!rows[0]?.locked) {
    await client.end().catch(() => undefined);
    throw new Error(
      'Another sync:templates run holds the lock; try again later.',
    );
  }
}

export async function releaseSyncLock(client: LockClient): Promise<void> {
  await client
    .query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY])
    .catch(() => undefined);
  await client.end().catch(() => undefined);
}

/**
 * Sync each seed in turn. A seed without a usable thumbnail is never handed
 * to the state machine — publishing it would make an icon-only card — and is
 * reported as `skipped` (a type with no renderer yet) or `failed`.
 */
export async function syncSeeds(
  seeds: readonly TemplateSeed[],
  thumbnails: { get(slug: string): Promise<ThumbnailLookup> },
  sync: {
    syncOne(seed: TemplateSeed, thumb: SeedThumbnail): Promise<SyncOutcome>;
  },
  report: (outcome: SyncOutcome) => void = () => undefined,
): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (const seed of seeds) {
    const found = await thumbnails.get(seed.slug);
    const outcome: SyncOutcome =
      found.kind === 'ok'
        ? await sync.syncOne(seed, found.thumbnail)
        : {
            slug: seed.slug,
            result: found.kind,
            detail: `no thumbnail: ${found.reason}`,
          };
    outcomes.push(outcome);
    report(outcome);
  }
  return outcomes;
}
