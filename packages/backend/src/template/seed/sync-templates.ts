import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../database/prisma.service';
import { ImageService } from '../../image/image.service';
import { YorkieService } from '../../yorkie/yorkie.service';
import { TemplateService } from '../template.service';
import { TEMPLATE_CATALOG } from './catalog';
import { readContentHash, writeContent } from './seed-templates';
import {
  acquireSyncLock,
  parseSyncArgs,
  releaseSyncLock,
  selectSeeds,
  syncSeeds,
} from './sync-run';
import { TemplateSync } from './template-sync';
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

async function main(): Promise<void> {
  const args = parseSyncArgs(process.argv.slice(2));
  const seeds = selectSeeds(TEMPLATE_CATALOG, args.slugs);
  const thumbnails = await ThumbnailDirectory.open(args.thumbnails);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  let lock: Client | null = null;
  try {
    const prisma = app.get(PrismaService);
    const yorkie = app.get(YorkieService);

    const user = await prisma.user.findUnique({ where: { id: args.authorId } });
    if (!user) throw new Error(`No such user: ${args.authorId}`);

    // Constructed before the lock: `TemplateSync` refuses an `--author`
    // outside the reviewer allowlist, or a deployment whose Yorkie auth
    // webhook is not enforcing, before anything is touched.
    const sync = new TemplateSync(
      {
        prisma,
        templates: app.get(TemplateService),
        images: app.get(ImageService),
        config: app.get(ConfigService),
        writeContent: (documentId, content) =>
          writeContent(yorkie, documentId, content),
        readContentHash: (documentId, kind) =>
          readContentHash(yorkie, documentId, kind),
      },
      {
        authorId: args.authorId,
        workspaceId: args.workspaceId,
        eventTimeoutMs: args.eventTimeoutMs,
        pollIntervalMs: 500,
      },
    );

    lock = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await acquireSyncLock(lock);
    } catch (err) {
      lock = null;
      throw err;
    }

    const outcomes = await syncSeeds(seeds, thumbnails, sync, (outcome) => {
      const line = `${outcome.slug}: ${outcome.result} — ${outcome.detail}`;
      if (outcome.result === 'failed') logger.error(line);
      else logger.log(line);
    });

    const tally = new Map<string, number>();
    for (const { result } of outcomes) {
      tally.set(result, (tally.get(result) ?? 0) + 1);
    }
    logger.log(`Done. ${[...tally].map(([k, n]) => `${n} ${k}`).join(', ')}.`);
    if (tally.has('failed')) process.exitCode = 1;
  } finally {
    if (lock) await releaseSyncLock(lock);
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
