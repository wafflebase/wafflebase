import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
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
import type { BoardRoot } from './board';
import { TEMPLATE_CATALOG } from './catalog';
import type { SeedContent, TemplateSeed } from './types';

/**
 * Fill the public template gallery (docs/design/template-gallery.md).
 *
 *   pnpm backend seed:templates --workspace <id> --author <userId>
 *
 * A backend command rather than a new HTTP route: creating a workspace's
 * starter documents is an operator action with database access. It reuses the
 * writers the v1 content endpoints use.
 *
 * It stops at the documents. Registering them as templates is
 * `register-templates.ts`, which drives the product's own Share dialog — see
 * there for why that cannot be done headlessly.
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
// One seed
// --------------------------------------------------------------------------

/**
 * Create the document and write its content — and stop there.
 *
 * Registering it as a template is deliberately **not** here. That happens
 * through the product's own Share dialog, driven by `register-templates.ts`,
 * because the thumbnail is taken by whichever editor is mounted at publish
 * time and a headless publish has none. Leaving a second, service-level
 * publish path in this file would also be exactly the "second unguarded way
 * to swap an approved gallery card" that `publish()` guards against.
 *
 * Content is written only when the document is new, unless asked otherwise: a
 * re-run must not clobber edits somebody made to a seeded template.
 */
async function seedOne(
  ctx: {
    prisma: PrismaService;
    yorkie: YorkieService;
    workspaceId: string;
    authorId: number;
    forceContent: boolean;
  },
  seed: TemplateSeed,
): Promise<'created' | 'exists' | 'rewritten'> {
  const documentId = seedDocumentId(seed.slug);

  const existing = await ctx.prisma.document.findUnique({
    where: { id: documentId },
  });

  // The id is derived from the slug alone, so it is the same in every
  // workspace on a deployment. Without this check, seeding a second workspace
  // reports `exists` and silently creates nothing — and `--force-content`
  // would rewrite the *first* workspace's documents.
  if (existing && existing.workspaceId !== ctx.workspaceId) {
    throw new Error(
      `${seed.slug} is already seeded into workspace ${existing.workspaceId}. ` +
        'A seeded document id is derived from its slug, so one deployment can ' +
        'hold one copy of the catalogue; seed a different deployment, or ' +
        'delete that document first.',
    );
  }

  if (!existing) {
    await ctx.prisma.document.create({
      data: {
        id: documentId,
        title: seed.title,
        type: documentType(seed.content),
        workspaceId: ctx.workspaceId,
        authorID: ctx.authorId,
      },
    });
    try {
      await writeContent(ctx.yorkie, documentId, seed.content);
    } catch (err) {
      // Undo the row. Left behind, the next run would see `exists` and skip
      // the content forever — an empty document that only `--force-content`
      // could repair, and nothing would tell the operator to reach for it.
      await ctx.prisma.document.delete({ where: { id: documentId } });
      throw err;
    }
    return 'created';
  }

  if (ctx.forceContent) {
    await writeContent(ctx.yorkie, documentId, seed.content);
    return 'rewritten';
  }
  return 'exists';
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
    const author = await prisma.user.findUnique({ where: { id: authorId } });
    if (!author) throw new Error(`No such user: ${authorId}`);

    const ctx = {
      prisma,
      yorkie,
      workspaceId,
      authorId,
      forceContent: process.argv.includes('--force-content'),
    };

    const tally: Record<string, number> = {};
    for (const seed of TEMPLATE_CATALOG) {
      const outcome = await seedOne(ctx, seed);
      tally[outcome] = (tally[outcome] ?? 0) + 1;
      logger.log(`${seed.slug}: ${outcome}`);
    }

    logger.log(
      `Done. ${Object.entries(tally)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ')}. ` +
        'Register them with: pnpm backend register:templates --author ' +
        `${authorId}`,
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
