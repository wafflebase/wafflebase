import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  initialSpreadsheetDocument,
  parseRef,
  updateWorksheetCell,
} from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../database/prisma.service';
import { YorkieService } from '../../yorkie/yorkie.service';
import { YORKIE_DOC_KEY_PREFIXES } from '../../yorkie/yorkie-doc-key';
import { DocsYorkieRoot, writeDocsRoot } from '../../yorkie/docs-tree';
import { SlidesYorkieRoot, writeSlidesRoot } from '../../yorkie/slides-tree';
import { NoteYorkieRoot, writeNoteRoot } from '../../yorkie/note-content';
import { parseReviewerIds } from '../template-review';
import { TemplateService } from '../template.service';
import type { BoardRoot } from './board';
import { TEMPLATE_CATALOG } from './catalog';
import type { SeedContent, TemplateSeed } from './types';

/**
 * Fill the public template gallery (docs/design/template-gallery.md).
 *
 *   pnpm backend seed:templates --workspace <id> --author <userId>
 *
 * A backend command rather than a new HTTP route: filling a gallery is an
 * operator action with database access, not something an API key should be
 * able to do, and a public route would be auth surface to maintain forever.
 * It reuses the writers the v1 content endpoints use and drives
 * `TemplateService` for publish / submit / approve, so **none of the
 * public-tier gates are bypassed** — a deployment that has not configured
 * reviewers or enabled the Yorkie auth webhook is refused here exactly as a
 * person clicking through the UI would be.
 */

const logger = new Logger('SeedTemplates');

/**
 * A stable document id per seed slug.
 *
 * Idempotency has to key on *something*, and every alternative is worse: a
 * title match breaks the moment somebody renames the document, and a
 * side-file of ids is state to lose. Deriving the id from the slug means a
 * re-run finds exactly the document it created last time, on any deployment,
 * with nothing to keep in sync. Formatted as a v5-shaped UUID because the
 * column is one.
 */
export function seedDocumentId(slug: string): string {
  const h = createHash('sha1')
    .update(`wafflebase-template-seed:${slug}`)
    .digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) +
      h.slice(18, 20),
    h.slice(20, 32),
  ].join('-');
}

/** `Document.type` for a seed's content. */
function documentType(content: SeedContent): string {
  return content.kind;
}

// --------------------------------------------------------------------------
// Content
// --------------------------------------------------------------------------

async function writeContent(
  yorkie: YorkieService,
  documentId: string,
  content: SeedContent,
): Promise<void> {
  if (content.kind === 'doc') {
    await yorkie.withDocument<void, DocsYorkieRoot>(
      documentId,
      (doc) => {
        doc.update((root) => writeDocsRoot(root, content.document));
      },
      { docKeyPrefix: YORKIE_DOC_KEY_PREFIXES.doc },
    );
    return;
  }

  if (content.kind === 'slides') {
    await yorkie.withDocument<void, SlidesYorkieRoot>(
      documentId,
      (doc) => {
        doc.update((root) => writeSlidesRoot(root, content.document));
      },
      { docKeyPrefix: YORKIE_DOC_KEY_PREFIXES.slides },
    );
    return;
  }

  if (content.kind === 'note') {
    await yorkie.withDocument<void, NoteYorkieRoot>(
      documentId,
      (doc) => {
        doc.update((root) => writeNoteRoot(root, content.document));
      },
      { docKeyPrefix: YORKIE_DOC_KEY_PREFIXES.note },
    );
    return;
  }

  if (content.kind === 'board') {
    await yorkie.withDocument<void, BoardRoot>(
      documentId,
      (doc) => {
        doc.update((root) => {
          root.meta = content.root.meta;
          root.elements = content.root.elements;
        });
      },
      { docKeyPrefix: YORKIE_DOC_KEY_PREFIXES.board },
    );
    return;
  }

  // Sheets have no whole-document writer — `PUT /documents/:id/content`
  // refuses a spreadsheet — so cells go in one at a time through the same
  // `updateWorksheetCell` the v1 cells endpoint uses.
  await yorkie.withDocument<void, SpreadsheetDocument>(
    documentId,
    (doc) => {
      doc.update((root) => {
        const tabId = root.tabOrder[0];
        const worksheet = root.sheets[tabId];
        root.tabs[tabId].name = content.tabName;
        if (content.frozenRows !== undefined) {
          worksheet.frozenRows = content.frozenRows;
        }
        for (const [ref, value] of Object.entries(content.cells)) {
          updateWorksheetCell(worksheet, parseRef(ref), () => value);
        }
      });
    },
    {
      docKeyPrefix: YORKIE_DOC_KEY_PREFIXES.sheet,
      initialRoot: initialSpreadsheetDocument(),
    },
  );
}

// --------------------------------------------------------------------------
// The content watermark
// --------------------------------------------------------------------------

const SETTLE_POLL_MS = 1500;
const SETTLE_STABLE_READS = 2;
const SETTLE_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until a listing's `contentChangedAt` stops moving.
 *
 * `review({ decision: 'approve', contentAt })` pins `reviewedContentAt` to the
 * watermark the reviewer attested to, and `isVisibleTo` hides the listing once
 * live content moves past it. That watermark is driven by the **asynchronous**
 * Yorkie `DocumentRootChanged` event webhook — so a script that writes content
 * and approves a second later can have its own write land *after* the
 * approval, which both hides the listing and knocks it back to `pending`.
 *
 * A human reviewer never hits this because they open a queue minutes later.
 * This is that pause, made explicit: poll until the value has been stable
 * across consecutive reads, then approve *that* value.
 *
 * On a deployment with no event webhook registered the watermark simply never
 * moves, so this settles on the first two reads and costs one poll interval.
 */
async function settleWatermark(
  prisma: PrismaService,
  listingId: string,
): Promise<Date | null> {
  const startedAt = Date.now();
  let last: number | null | undefined = undefined;
  let stable = 0;

  for (;;) {
    const row = await prisma.templateListing.findUnique({
      where: { id: listingId },
      select: { contentChangedAt: true },
    });
    const current = row?.contentChangedAt?.getTime() ?? null;

    stable = current === last ? stable + 1 : 0;
    last = current;
    if (stable >= SETTLE_STABLE_READS - 1) {
      return current === null ? null : new Date(current);
    }
    if (Date.now() - startedAt > SETTLE_TIMEOUT_MS) {
      throw new Error(
        `Content watermark for listing ${listingId} never settled. ` +
          `Something is still writing to the document; re-run the seed when it is quiet.`,
      );
    }
    await sleep(SETTLE_POLL_MS);
  }
}

// --------------------------------------------------------------------------
// One seed
// --------------------------------------------------------------------------

interface SeedContext {
  prisma: PrismaService;
  yorkie: YorkieService;
  templates: TemplateService;
  workspaceId: string;
  authorId: number;
  reviewerId: number;
  forceContent: boolean;
}

type SeedOutcome = 'created' | 'refreshed' | 'already-live' | 'needs-review';

async function seedOne(
  ctx: SeedContext,
  seed: TemplateSeed,
): Promise<SeedOutcome> {
  const documentId = seedDocumentId(seed.slug);
  const type = documentType(seed.content);

  const existingDoc = await ctx.prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!existingDoc) {
    await ctx.prisma.document.create({
      data: {
        id: documentId,
        title: seed.title,
        type,
        workspaceId: ctx.workspaceId,
        authorID: ctx.authorId,
      },
    });
  }

  // Content is written only when the document is new, unless asked otherwise.
  // A re-run must not clobber edits somebody made to a seeded template — and
  // rewriting content also moves the watermark, which takes an approved
  // listing back out of the gallery for no reason.
  const wroteContent = !existingDoc || ctx.forceContent;
  if (wroteContent) {
    await writeContent(ctx.yorkie, documentId, seed.content);
  }

  const existingListing = await ctx.prisma.templateListing.findUnique({
    where: { documentId },
  });

  const listing = await ctx.templates.publish(documentId, ctx.authorId, {
    title: seed.title,
    description: seed.description,
    category: seed.category,
    tags: seed.tags,
    // Only on first publish. Passing it on a re-run would narrow an
    // already-approved listing back down to workspace scope.
    ...(existingListing ? {} : { visibility: 'workspace' as const }),
  });

  const current = await ctx.prisma.templateListing.findUniqueOrThrow({
    where: { id: listing.id },
  });

  if (current.visibility === 'public' && current.status === 'listed') {
    const stale =
      current.contentChangedAt !== null &&
      (current.reviewedContentAt === null ||
        current.contentChangedAt > current.reviewedContentAt);
    if (!stale) return existingDoc ? 'refreshed' : 'already-live';
    // Already public but the content has moved past its approval. `submit`
    // refuses a public listing ("re-reviewing a published template is not
    // supported yet"), so the seed cannot fix this — a reviewer has to.
    logger.warn(
      `${seed.slug}: public but its content is ahead of the approval. ` +
        `Re-approve it from the reviewer queue.`,
    );
    return 'needs-review';
  }

  if (current.status !== 'pending') {
    await ctx.templates.submit(listing.id, ctx.authorId, {
      acceptLicense: true,
    });
  }

  const contentAt = await settleWatermark(ctx.prisma, listing.id);
  await ctx.templates.review(listing.id, ctx.reviewerId, {
    decision: 'approve',
    contentAt: contentAt ? contentAt.toISOString() : undefined,
  });

  const after = await ctx.prisma.templateListing.findUniqueOrThrow({
    where: { id: listing.id },
  });
  if (after.visibility !== 'public' || after.status !== 'listed') {
    throw new Error(
      `${seed.slug}: approve did not leave the listing public+listed ` +
        `(visibility=${after.visibility}, status=${after.status})`,
    );
  }
  return existingDoc ? 'refreshed' : 'created';
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const yorkie = app.get(YorkieService);
    const templates = app.get(TemplateService);
    const config = app.get(ConfigService);

    const workspaceId = arg('workspace') ?? process.env.SEED_WORKSPACE_ID;
    const authorId = Number(arg('author') ?? process.env.SEED_AUTHOR_ID);
    if (!workspaceId || !Number.isSafeInteger(authorId) || authorId <= 0) {
      throw new Error(
        'Usage: pnpm backend seed:templates --workspace <workspaceId> --author <userId>',
      );
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) throw new Error(`No such workspace: ${workspaceId}`);

    // Checked here rather than left to the first `submit` so the run fails
    // before creating ten documents it cannot publish.
    const reviewers = parseReviewerIds(
      config.get<string>('WAFFLEBASE_TEMPLATE_REVIEWER_IDS'),
    );
    if (!reviewers.has(authorId)) {
      throw new Error(
        `User ${authorId} is not in WAFFLEBASE_TEMPLATE_REVIEWER_IDS, so this run ` +
          `could publish templates but never approve them. Add them, or pass an ` +
          `--author who is a reviewer.`,
      );
    }
    if (config.get<string>('YORKIE_AUTH_WEBHOOK_ENFORCE') !== 'true') {
      throw new Error(
        'The public tier requires YORKIE_AUTH_WEBHOOK_ENFORCE=true. In shadow mode ' +
          "each listing's preview token also grants write access to its document.",
      );
    }

    const ctx: SeedContext = {
      prisma,
      yorkie,
      templates,
      workspaceId,
      authorId,
      // The author approves their own submissions. That is the point of a
      // seed — this content is ours — and it is why the command needs an
      // author who is already a configured reviewer rather than minting any
      // new authority of its own.
      reviewerId: authorId,
      forceContent: process.argv.includes('--force-content'),
    };

    const tally: Record<SeedOutcome, number> = {
      created: 0,
      refreshed: 0,
      'already-live': 0,
      'needs-review': 0,
    };

    for (const seed of TEMPLATE_CATALOG) {
      const outcome = await seedOne(ctx, seed);
      tally[outcome] += 1;
      logger.log(`${seed.slug}: ${outcome}`);
    }

    logger.log(
      `Done. ${Object.entries(tally)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ')}.`,
    );
  } finally {
    await app.close();
  }
}

// `require.main` rather than a bare call so the module can be imported by a
// test without launching a Nest context.
if (require.main === module) {
  main().catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
