import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../database/prisma.service';
import { ImageService } from '../../image/image.service';
import { YorkieService } from '../../yorkie/yorkie.service';
import {
  assertPublicTierOpen,
  assertYorkieAuthEnforced,
  parseReviewerIds,
} from '../template-review';
import { TemplateService } from '../template.service';
import { TEMPLATE_CATALOG } from './catalog';
import { writeContent } from './seed-templates';
import { TemplateSync, type SyncOutcome } from './template-sync';
import { ThumbnailDirectory } from './thumbnail-manifest';

/**
 * Publish, update and approve the seeded documents as public templates
 * (docs/design/template-catalog-scaling.md §3).
 *
 *   pnpm backend sync:templates --author <userId> --thumbnails <dir> \
 *     [--workspace <id>] [--event-timeout <seconds>] [slug...]
 *
 * In-process, and only through the guarded `TemplateService` methods: no HTTP
 * route, no session cookie, no API key. Thumbnails come from
 * `pnpm frontend render:thumbnails`; a seed without one is not published,
 * since an icon-only card is the failure this command exists to prevent.
 *
 * Idempotent and resumable: re-running after an interruption, or after the
 * catalogue changes, does only what is still needed. See `template-sync.ts`
 * for the state table.
 */

const logger = new Logger('SyncTemplates');

/**
 * One run at a time per deployment. Two concurrent runs would both see a seed
 * without a listing and both publish; the service's CAS writes would keep the
 * listings consistent, but the second run would orphan a thumbnail upload and
 * report confusing failures.
 */
const LOCK_KEY = 0x7761_6673_796e; // "wafsyn"

interface Args {
  authorId: number;
  thumbnails: string;
  workspaceId?: string;
  eventTimeoutMs: number;
  slugs: string[];
}

function parseArgs(argv: string[]): Args {
  const usage =
    'Usage: pnpm backend sync:templates --author <userId> --thumbnails <dir> ' +
    '[--workspace <id>] [--event-timeout <seconds>] [slug...]';
  const values: Record<string, string> = {};
  const slugs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const v = argv[++i];
      if (v === undefined) throw new Error(usage);
      values[a.slice(2)] = v;
    } else {
      slugs.push(a);
    }
  }
  const unknown = Object.keys(values).filter(
    (k) => !['author', 'thumbnails', 'workspace', 'event-timeout'].includes(k),
  );
  if (unknown.length > 0) throw new Error(`${usage}\nUnknown: --${unknown[0]}`);

  const authorId = Number(values.author ?? process.env.SEED_AUTHOR_ID);
  const thumbnails = values.thumbnails;
  const timeout = Number(values['event-timeout'] ?? 30);
  if (
    !Number.isSafeInteger(authorId) ||
    authorId <= 0 ||
    !thumbnails ||
    !(timeout > 0)
  ) {
    throw new Error(usage);
  }
  return {
    authorId,
    // `pnpm --filter` runs this from the package directory.
    thumbnails: path.resolve(process.env.INIT_CWD ?? process.cwd(), thumbnails),
    workspaceId: values.workspace,
    eventTimeoutMs: timeout * 1000,
    slugs,
  };
}

/**
 * A session-level advisory lock on a dedicated connection — not through
 * Prisma, whose pool would hand the unlock to a different session. Needs a
 * direct (session-mode) connection; a transaction-mode pooler drops it.
 */
async function acquireLock(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [LOCK_KEY],
  );
  if (!rows[0]?.locked) {
    await client.end();
    throw new Error(
      'Another sync:templates run holds the lock; try again later.',
    );
  }
  return client;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const unknown = args.slugs.filter(
    (slug) => !TEMPLATE_CATALOG.some((seed) => seed.slug === slug),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown seed slug(s): ${unknown.join(', ')}`);
  }
  const seeds =
    args.slugs.length > 0
      ? TEMPLATE_CATALOG.filter((seed) => args.slugs.includes(seed.slug))
      : TEMPLATE_CATALOG;
  const thumbnails = await ThumbnailDirectory.open(args.thumbnails);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  let lock: Client | null = null;
  try {
    const prisma = app.get(PrismaService);
    const config = app.get(ConfigService);
    const yorkie = app.get(YorkieService);

    const user = await prisma.user.findUnique({ where: { id: args.authorId } });
    if (!user) throw new Error(`No such user: ${args.authorId}`);

    // The reviewer guard sits on the HTTP route, not on `review()`, so this
    // command re-checks it: `--author` approves its own submissions and must
    // be somebody the deployment already trusts to.
    const reviewers = parseReviewerIds(
      config.get<string>('WAFFLEBASE_TEMPLATE_REVIEWER_IDS'),
    );
    if (!reviewers.has(args.authorId)) {
      throw new Error(
        `User ${args.authorId} is not in WAFFLEBASE_TEMPLATE_REVIEWER_IDS.`,
      );
    }
    // Checked up front so the run fails before publishing anything; `submit`
    // and `review` check both again on every call.
    assertPublicTierOpen();
    assertYorkieAuthEnforced(config.get<string>('YORKIE_AUTH_WEBHOOK_ENFORCE'));

    lock = await acquireLock();

    const sync = new TemplateSync(
      {
        prisma,
        templates: app.get(TemplateService),
        images: app.get(ImageService),
        writeContent: (documentId, content) =>
          writeContent(yorkie, documentId, content),
      },
      {
        authorId: args.authorId,
        workspaceId: args.workspaceId,
        eventTimeoutMs: args.eventTimeoutMs,
        pollIntervalMs: 500,
      },
    );

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
      const line = `${outcome.slug}: ${outcome.result} — ${outcome.detail}`;
      if (outcome.result === 'failed') logger.error(line);
      else logger.log(line);
    }

    const tally = new Map<string, number>();
    for (const { result } of outcomes) {
      tally.set(result, (tally.get(result) ?? 0) + 1);
    }
    logger.log(`Done. ${[...tally].map(([k, n]) => `${n} ${k}`).join(', ')}.`);
    if (tally.has('failed')) process.exitCode = 1;
  } finally {
    if (lock) {
      await lock
        .query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
        .catch(() => undefined);
      await lock.end().catch(() => undefined);
    }
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
