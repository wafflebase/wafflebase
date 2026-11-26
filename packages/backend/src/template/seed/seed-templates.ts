import { createHash, randomUUID } from 'node:crypto';
import yorkieSdk from '@yorkie-js/sdk';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  initialSpreadsheetDocument,
  parseRef,
  replaceWorksheetCells,
} from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../database/prisma.service';
import {
  YorkieService,
  type WithDocumentOptions,
} from '../../yorkie/yorkie.service';
import { YORKIE_DOC_KEY_PREFIXES } from '../../yorkie/yorkie-doc-key';
import { DocsYorkieRoot, writeDocsRoot } from '../../yorkie/docs-tree';
import { SlidesYorkieRoot, writeSlidesRoot } from '../../yorkie/slides-tree';
import { NoteYorkieRoot, writeNoteRoot } from '../../yorkie/note-content';
import type { BoardRoot } from './board';
import { TEMPLATE_CATALOG } from './catalog';
import { seedDocumentId, stableStringify } from './seed-hash';
import type { SeedContent, TemplateSeed } from './types';

export { seedDocumentId };

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
 * `sync-templates.ts`, which publishes them through `TemplateService` with
 * thumbnails rendered offline by `pnpm frontend render:thumbnails`.
 */

const logger = new Logger('SeedTemplates');

/** `Document.type` for a seed's content. */
function documentType(content: SeedContent): string {
  return content.kind;
}

// --------------------------------------------------------------------------
// Content
// --------------------------------------------------------------------------

/** Where each seed kind's Yorkie document lives. */
function documentOptions(kind: SeedContent['kind']): WithDocumentOptions {
  return { docKeyPrefix: YORKIE_DOC_KEY_PREFIXES[kind] };
}

/**
 * sha256 of a document's whole root. Used to tell whether a document holds
 * exactly the root a seed defines.
 *
 * Two canonicalizations, both found by running the real write path against a
 * Yorkie server (`test/seed-content-attached.e2e-spec.ts`):
 *
 * - `toSortedJSON` does not sort a `Tree` node's attributes, and a node read
 *   back from the server lists them in a different order than the node that
 *   was written — so the parsed root is re-serialized with every object's
 *   keys sorted ({@link stableStringify}).
 * - A worksheet keys its cells, sizes and styles by random axis ids that
 *   `replaceWorksheetCells` mints on every write. They are renamed by
 *   position (`rowOrder[i]` → `r<i>`, `colOrder[j]` → `c<j>`), which keeps
 *   every cell's place in the grid — so a changed, added or moved cell still
 *   changes the hash — while making two writes of the same content agree. The
 *   renaming is injective ({@link renameAxisIds}), without which a cell could
 *   be injected under a key that already reads as a positional name and the
 *   hash would not move.
 *
 * Exported for `seed-templates.spec.ts`, which hashes crafted roots directly.
 */
export function hashRootJson(json: string): string {
  const root = JSON.parse(json) as Record<string, unknown>;
  const sheets = root.sheets;
  if (sheets && typeof sheets === 'object') {
    for (const [tabId, ws] of Object.entries(sheets)) {
      (sheets as Record<string, unknown>)[tabId] = renameAxisIds(ws);
    }
  }
  return createHash('sha256').update(stableStringify(root)).digest('hex');
}

/** {@link hashRootJson} of a document's committed root. */
function rootHash(doc: { toSortedJSON(): string }): string {
  return hashRootJson(doc.toSortedJSON());
}

/**
 * {@link hashRootJson} of the root a `doc.update` has built so far — read off
 * the proxy handed to the updater, before the change is committed, so a write
 * can be refused from inside the update it is still assembling.
 *
 * The proxy exposes `toJSON` but not `toSortedJSON`; the two differ only in
 * object key order, which {@link stableStringify} normalizes away. That the
 * two therefore agree is not left to inspection — {@link expectedRootHash}
 * computes both and refuses the seed if they ever diverge.
 */
function pendingRootHash(root: Record<string, unknown>): string {
  return hashRootJson((root as unknown as { toJSON(): string }).toJSON());
}

/**
 * A part that already reads as a positional name (`r0`, `c12`, and any
 * `~`-escaped form of one). Such a part is escaped rather than passed through,
 * which is what keeps the renaming **injective** — see {@link renameAxisIds}.
 */
const POSITIONAL_NAME = /^~*[rc]\d+$/;

/**
 * Rename a worksheet's axis ids by position; see {@link rootHash}.
 *
 * The renaming has to be injective, or the hash it feeds stops distinguishing
 * two different worksheets: a key that is not an axis id but is literally
 * equal to a positional name (`"r0|c0"` among the cells, `"r0"` among
 * `rowHeights`) would otherwise canonicalize to itself and collide with a
 * renamed key, and rebuilding the object silently keeps only one of the two.
 * So the two namespaces are kept disjoint — a renamed part is a bare
 * `r<i>`/`c<j>`, and a literal part that looks like one gains a `~` — and the
 * rebuild still refuses a collision rather than dropping a member, since a
 * hash that cannot be trusted must fail the seed, not pass it. With the
 * namespaces disjoint that refusal is unreachable — it is an assertion of the
 * injectivity `seed-templates.spec.ts` tests, kept so a future change to the
 * renaming fails loudly instead of hashing two worksheets alike.
 *
 * Only structure is renamed: the `cells` map's keys, but never a cell's own
 * members (see the end of this function).
 */
function renameAxisIds(ws: unknown): unknown {
  if (!ws || typeof ws !== 'object') return ws;
  const { rowOrder, colOrder } = ws as {
    rowOrder?: unknown;
    colOrder?: unknown;
  };
  const names = new Map<string, string>();
  if (Array.isArray(rowOrder)) {
    rowOrder.forEach(
      (id, i) => typeof id === 'string' && names.set(id, `r${i}`),
    );
  }
  if (Array.isArray(colOrder)) {
    colOrder.forEach(
      (id, i) => typeof id === 'string' && names.set(id, `c${i}`),
    );
  }
  // Cell keys are `<rowId>|<colId>`; anything else is a bare id or not one.
  const renamePart = (part: string): string => {
    const name = names.get(part);
    if (name !== undefined) return name;
    return POSITIONAL_NAME.test(part) ? `~${part}` : part;
  };
  const rename = (text: string): string =>
    text.split('|').map(renamePart).join('|');
  // Rebuilt through `Object.fromEntries`, never `out[key] = …`: a member named
  // `__proto__` reaches `Object.prototype`'s setter on assignment and vanishes
  // from the hash, which is the dropped member this guard exists to refuse.
  // `JSON.parse` makes such a member an own property, so `Object.entries`
  // does list it.
  const rebuild = (
    value: object,
    mapChild: (key: string, child: unknown) => unknown,
  ): unknown => {
    const seen = new Set<string>();
    const entries: Array<[string, unknown]> = [];
    for (const [k, v] of Object.entries(value)) {
      const key = rename(k);
      if (seen.has(key)) {
        throw new Error(
          `worksheet key ${JSON.stringify(k)} collides with ` +
            `${JSON.stringify(key)} after axis-id renaming, so its root ` +
            'cannot be hashed',
        );
      }
      seen.add(key);
      entries.push([key, mapChild(k, v)]);
    }
    return Object.fromEntries(entries);
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return rename(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object')
      return rebuild(value, (_, child) => walk(child));
    return value;
  };
  // A cell's own members — its value `v`, formula `f`, style and spill anchor
  // (an A1 `Sref`) — hold no axis id, and `v` / `f` are what the user reads,
  // so a cell is hashed exactly as stored and only the `cells` map's *keys*
  // are renamed. Walking into a cell would fold text that equals an axis id
  // into that id's positional name.
  return rebuild(ws, (key, member) =>
    key === 'cells' && member && typeof member === 'object'
      ? rebuild(member, (_, cell) => cell)
      : walk(member),
  );
}

/**
 * Make `root` exactly the root `content` defines: every existing key is
 * deleted first, so nothing that was there before — a tab, a slide, a board
 * element, a comment thread somebody injected — survives the write. A seed
 * document is the catalogue's, and a merge would leave content the operator
 * never wrote behind a listing they approve.
 */
function replaceRoot(
  root: Record<string, unknown>,
  content: SeedContent,
): void {
  const existing = Object.keys(
    JSON.parse((root as { toJSON(): string }).toJSON()) as object,
  );
  for (const key of existing) delete root[key];
  if (content.kind === 'sheet') {
    // A spreadsheet has no whole-document writer; it starts from the
    // canonical empty workbook, which is deterministic (fixed tab id).
    for (const [key, value] of Object.entries(initialSpreadsheetDocument())) {
      root[key] = value;
    }
  }
  applyContent(root, content);
}

/**
 * The {@link rootHash} of the root `content` defines, built in a detached,
 * never-synced Yorkie document — so it depends on the catalogue alone, not on
 * anything a live document held before.
 */
export function expectedRootHash(content: SeedContent): string {
  const doc = new yorkieSdk.Document<Record<string, unknown>>(
    `seed-expected-${randomUUID()}`,
  );
  let pending = '';
  doc.update((root) => {
    replaceRoot(root, content);
    pending = pendingRootHash(root);
  });
  const committed = rootHash(doc);
  // `writeContent` can only refuse a write it has not committed yet, so its
  // guard reads the half-built root rather than the committed one. The two
  // have to be the same hash for that substitution to hold; assert it here,
  // where every seed passes through, rather than trusting it.
  if (pending !== committed) {
    throw new Error(
      'a seed root hashes differently before and after commit, so the ' +
        'write-time guard cannot stand in for the committed one',
    );
  }
  return committed;
}

/**
 * Replace a seeded document's whole root with `content`. Exported for
 * `sync:templates`, which rewrites a listed seed when its catalogue content
 * changes.
 *
 * Returns {@link expectedRootHash}: the hash of the root the catalogue
 * defines. The write is refused — nothing is pushed — unless the document
 * hashes to exactly that after it, and `sync:templates` refuses to approve
 * unless a later read still does. Comparing against the catalogue, not
 * against "whatever was there after our write", is what catches content a
 * merge would have kept.
 */
export async function writeContent(
  yorkie: YorkieService,
  documentId: string,
  content: SeedContent,
): Promise<string> {
  const expected = expectedRootHash(content);
  await yorkie.withDocument<void, Record<string, unknown>>(
    documentId,
    (doc) => {
      doc.update((root) => {
        replaceRoot(root, content);
        if (pendingRootHash(root) !== expected) {
          // Thrown from *inside* the updater, which is the only place a
          // refusal actually withholds the change: Yorkie discards the
          // contaminated clone and records no local change, so neither the
          // sync nor `withDocument`'s unconditional detach — which ships a
          // document's pending change pack — has anything to push. Checking
          // after `doc.update` returned would have refused a write already
          // committed locally and bound for the server.
          throw new Error(
            'the rewritten document does not match the catalogue root; ' +
              'nothing was written',
          );
        }
      });
    },
    documentOptions(content.kind),
  );
  return expected;
}

/** The {@link rootHash} of a seeded document as it stands now. */
export async function readContentHash(
  yorkie: YorkieService,
  documentId: string,
  kind: SeedContent['kind'],
): Promise<string> {
  return yorkie.withDocument<string, Record<string, unknown>>(
    documentId,
    (doc) => rootHash(doc),
    { ...documentOptions(kind), syncMode: 'readonly' },
  );
}

/** Write `content` into a root, inside a `doc.update`. */
function applyContent(
  root: Record<string, unknown>,
  content: SeedContent,
): void {
  if (content.kind === 'doc') {
    writeDocsRoot(root as unknown as DocsYorkieRoot, content.document);
    return;
  }
  if (content.kind === 'slides') {
    writeSlidesRoot(root as unknown as SlidesYorkieRoot, content.document);
    return;
  }
  if (content.kind === 'note') {
    writeNoteRoot(root as unknown as NoteYorkieRoot, content.document);
    return;
  }
  if (content.kind === 'board') {
    const board = root as unknown as BoardRoot;
    board.meta = content.root.meta;
    board.elements = content.root.elements;
    return;
  }

  // Sheets have no whole-document writer — `PUT /documents/:id/content`
  // refuses a spreadsheet — so the worksheet is rebuilt here instead.
  //
  // `replaceWorksheetCells`, not a loop of `updateWorksheetCell`: the other
  // four kinds go through whole-root writers that *replace*, and writing cell
  // by cell would not. Under `--force-content` a catalogue revision that drops
  // a cell would otherwise leave the old value behind and still report
  // `rewritten`, so the document on screen would match no version of the
  // catalogue.
  const sheet = root as unknown as SpreadsheetDocument;
  const tabId = sheet.tabOrder[0];
  const worksheet = sheet.sheets[tabId];
  sheet.tabs[tabId].name = content.tabName;
  // Assigned unconditionally for the same reason: a revision that drops
  // `frozenRows` has to unfreeze the header, not keep the old pane.
  worksheet.frozenRows = content.frozenRows ?? 0;
  replaceWorksheetCells(
    worksheet,
    Object.entries(content.cells).map(
      ([ref, value]) => [parseRef(ref), value] as const,
    ),
  );
}

// --------------------------------------------------------------------------
// One seed
// --------------------------------------------------------------------------

/**
 * Create the document and write its content — and stop there.
 *
 * Registering it as a template is deliberately **not** here: that is
 * `sync-templates.ts`, which needs a rendered thumbnail per seed and calls
 * only the guarded `TemplateService` methods — never a second writer of
 * listing columns.
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

  // A trashed seed document would otherwise read as `exists` and be
  // (re)written into a row no surface shows — say so instead.
  if (existing?.deletedAt) {
    throw new Error(
      `${seed.slug} is in the trash. Restore it, or delete it permanently, ` +
        'before seeding again.',
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
        'Register slides and note seeds with: pnpm backend sync:templates ' +
        `--author ${authorId} --thumbnails <dir>; sheet, doc and board seeds ` +
        `with: pnpm backend register:templates --author ${authorId}`,
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
