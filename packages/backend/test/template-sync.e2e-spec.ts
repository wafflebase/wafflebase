import { createHash, randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/database/prisma.service';
import { ImageService } from 'src/image/image.service';
import { TemplateReviewSyncService } from 'src/template/template-review-sync.service';
import { TemplateService } from 'src/template/template.service';
import { seedDocumentId } from 'src/template/seed/seed-hash';
import {
  TemplateSync,
  type SeedThumbnail,
} from 'src/template/seed/template-sync';
import { seedContentHash } from 'src/template/seed/seed-hash';
import type { TemplateSeed } from 'src/template/seed/types';
import { YorkieService } from 'src/yorkie/yorkie.service';
import { YorkieAdminService } from 'src/yorkie/yorkie-admin.service';
import {
  clearDatabase,
  createUserFactory,
  createWorkspace,
  describeDb,
  setAuthEnvDefaults,
  setIntegrationEnvDefaults,
} from './helpers/integration-helpers';

/**
 * `sync:templates` against the REAL `TemplateService` and Postgres
 * (docs/design/template-catalog-scaling.md §3).
 *
 * `template-sync.spec.ts` drives the state machine against hand-written mocks
 * of the service; this suite is the contract that those mocks describe the
 * service truthfully — that the review rules (`CARD_FIELDS`, the `contentAt`
 * CAS, the public-tier gates) let the command do what it claims and refuse
 * what it must.
 *
 * Yorkie is the one thing faked, as a document store plus an event source
 * this suite controls: a write changes the document's root hash and, after a
 * short delivery delay, feeds the REAL `TemplateReviewSyncService` the
 * `DocumentRootChanged` event exactly as the webhook controller would, with
 * an instant from a Yorkie clock unrelated to this host's.
 */
describeDb('sync:templates (TemplateService + Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let templates: TemplateService;
  let reviewSync: TemplateReviewSyncService;
  let createUser: ReturnType<typeof createUserFactory>;

  let ownerId: number;
  let workspaceId: string;

  /** The fake Yorkie: each document's root hash. */
  let roots: Map<string, string>;
  /** Yorkie's clock — deliberately years away from this host's. */
  let yorkieClock: number;
  let pendingDeliveries: Promise<void>[];

  const SEED: TemplateSeed = {
    slug: 'contract-weekly-notes',
    title: 'Weekly notes',
    description: 'A weekly notes template',
    category: 'work/report-review',
    tags: ['notes'],
    content: { kind: 'note', document: { content: '# Weekly notes' } },
  };
  const DOC_ID = seedDocumentId(SEED.slug);

  function thumbnailFor(seed: TemplateSeed, bytes = 'webp'): SeedThumbnail {
    const buf = Buffer.from(bytes);
    return {
      bytes: buf,
      mimeType: 'image/webp',
      sha256: createHash('sha256').update(buf).digest('hex'),
      contentHash: seedContentHash(seed.content),
    };
  }

  /** Deliver a `DocumentRootChanged` event the way the controller does. */
  function deliverEvent(documentId: string, delayMs = 30): void {
    yorkieClock += 1_000;
    const at = new Date(yorkieClock);
    pendingDeliveries.push(
      new Promise<void>((resolve) =>
        setTimeout(() => {
          void reviewSync
            .onDocumentChanged(documentId, at)
            .finally(() => resolve());
        }, delayMs),
      ),
    );
  }

  /** A stranger's edit: different content, and its own event. */
  function strangerEdit(documentId: string, delayMs = 0): void {
    roots.set(documentId, `stranger-${randomUUID()}`);
    deliverEvent(documentId, delayMs);
  }

  let onWrite: ((documentId: string) => void) | undefined;

  function makeSync(): TemplateSync {
    return new TemplateSync(
      {
        prisma,
        templates,
        images: {
          upload: () =>
            Promise.resolve({ id: `${randomUUID()}.webp`, url: '/images/x' }),
          delete: () => Promise.resolve(),
        },
        config: moduleRef.get(ConfigService),
        writeContent: (documentId, content) => {
          const hash = createHash('sha256')
            .update(`${JSON.stringify(content)}:${randomUUID()}`)
            .digest('hex');
          roots.set(documentId, hash);
          onWrite?.(documentId);
          deliverEvent(documentId);
          return Promise.resolve(hash);
        },
        readContentHash: (documentId) =>
          Promise.resolve(roots.get(documentId) ?? ''),
      },
      {
        authorId: ownerId,
        eventTimeoutMs: 3_000,
        pollIntervalMs: 20,
      },
    );
  }

  async function settle(): Promise<void> {
    await Promise.all(pendingDeliveries);
    pendingDeliveries = [];
  }

  async function listing() {
    return prisma.templateListing.findUniqueOrThrow({
      where: { documentId: DOC_ID },
    });
  }

  beforeAll(async () => {
    setIntegrationEnvDefaults();
    setAuthEnvDefaults();

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Never reached: every Yorkie read and write goes through the fakes
      // passed to `TemplateSync`, and a `note` publish reads no content.
      .overrideProvider(YorkieService)
      .useValue({
        onModuleInit: () => Promise.resolve(),
        onModuleDestroy: () => Promise.resolve(),
        withDocument: () => Promise.reject(new Error('unexpected Yorkie call')),
      })
      .overrideProvider(YorkieAdminService)
      .useValue({
        getEditors: () => Promise.resolve(new Map()),
        getSummaries: () => Promise.resolve(new Map()),
      })
      .overrideProvider(ImageService)
      .useValue({
        onModuleInit: () => Promise.resolve(),
        upload: () => Promise.reject(new Error('unexpected upload')),
        delete: () => Promise.resolve(),
      })
      .compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    templates = moduleRef.get(TemplateService);
    reviewSync = moduleRef.get(TemplateReviewSyncService);
    createUser = createUserFactory(prisma, 'template-sync');
    await prisma.$connect();
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
    roots = new Map();
    yorkieClock = Date.UTC(2031, 0, 1);
    pendingDeliveries = [];
    onWrite = undefined;

    const owner = await createUser();
    ownerId = owner.id;
    workspaceId = (await createWorkspace(prisma, owner.id)).id;
    await prisma.document.create({
      data: {
        id: DOC_ID,
        title: SEED.title,
        type: 'note',
        workspaceId,
        authorID: owner.id,
      },
    });
    process.env.WAFFLEBASE_TEMPLATE_REVIEWER_IDS = `${owner.id}`;
    process.env.YORKIE_AUTH_WEBHOOK_ENFORCE = 'true';
  });

  afterEach(async () => {
    await settle();
  });

  afterAll(async () => {
    await clearDatabase(prisma);
    await moduleRef.close();
  });

  it('first publish: writes the content, observes it, approves a public listing', async () => {
    const outcome = await makeSync().syncOne(SEED, thumbnailFor(SEED));

    expect(outcome).toMatchObject({ result: 'published' });
    const row = await listing();
    expect(row).toMatchObject({ visibility: 'public', status: 'listed' });
    expect(row.contentChangedAt).not.toBeNull();
    expect(row.reviewedContentAt?.getTime()).toBe(
      row.contentChangedAt?.getTime(),
    );
    expect(row.shareLinkId).not.toBeNull();
    // A Yorkie instant years from this host's clock was approved without
    // ever being compared with it.
    expect(row.reviewedContentAt?.getUTCFullYear()).toBe(2031);

    const record = await prisma.templateSeedRecord.findUniqueOrThrow({
      where: { documentId: DOC_ID },
    });
    expect(record.writtenHash).toBe(roots.get(DOC_ID));
    expect(record.appliedAt?.getTime()).toBe(row.contentChangedAt?.getTime());
  });

  it('a second run is a no-op', async () => {
    await makeSync().syncOne(SEED, thumbnailFor(SEED));
    const before = await listing();

    const outcome = await makeSync().syncOne(SEED, thumbnailFor(SEED));

    expect(outcome.result).toBe('unchanged');
    const after = await listing();
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('card change: re-reviewed and re-approved, preview link kept', async () => {
    await makeSync().syncOne(SEED, thumbnailFor(SEED));
    const before = await listing();

    const renamed = { ...SEED, title: 'Weekly notes v2' };
    const outcome = await makeSync().syncOne(
      renamed,
      thumbnailFor(renamed, 'webp-v2'),
    );

    expect(outcome.result).toBe('approved');
    const after = await listing();
    expect(after).toMatchObject({
      title: 'Weekly notes v2',
      visibility: 'public',
      status: 'listed',
      shareLinkId: before.shareLinkId,
    });
    expect(after.thumbnailId).not.toBe(before.thumbnailId);
  });

  it('content change: rewrite, observe the event, approve the new watermark', async () => {
    await makeSync().syncOne(SEED, thumbnailFor(SEED));
    const before = await listing();

    const revised: TemplateSeed = {
      ...SEED,
      content: { kind: 'note', document: { content: '# Weekly notes, v2' } },
    };
    const outcome = await makeSync().syncOne(revised, thumbnailFor(revised));

    expect(outcome.result).toBe('approved');
    const after = await listing();
    expect(after).toMatchObject({ visibility: 'public', status: 'listed' });
    expect(after.contentChangedAt!.getTime()).toBeGreaterThan(
      before.contentChangedAt!.getTime(),
    );
    expect(after.reviewedContentAt?.getTime()).toBe(
      after.contentChangedAt?.getTime(),
    );
  });

  it('third-party edit after approval: refused, listing stays out of the gallery', async () => {
    await makeSync().syncOne(SEED, thumbnailFor(SEED));
    strangerEdit(DOC_ID);
    await settle();
    expect((await listing()).status).toBe('pending');

    const outcome = await makeSync().syncOne(SEED, thumbnailFor(SEED));

    expect(outcome.result).toBe('failed');
    expect(outcome.detail).toMatch(/edited by someone else/);
    expect(await listing()).toMatchObject({
      status: 'pending',
      reviewedBy: null,
    });
  });

  it('third-party edit inside the wait: its event is not mistaken for ours', async () => {
    // The stranger's edit lands right after our write, and its event is
    // delivered first — the first watermark advance the wait sees.
    // Our write's own event follows 30 ms later; the stranger's content is
    // what the document holds when the command reads it back.
    onWrite = (documentId) => {
      onWrite = undefined;
      strangerEdit(documentId, 0);
    };

    const outcome = await makeSync().syncOne(SEED, thumbnailFor(SEED));

    expect(outcome.result).toBe('failed');
    expect(outcome.detail).toMatch(/no longer holds what this command wrote/);
    expect((await listing()).visibility).not.toBe('public');
  });

  it('unpublished seed re-syncs cleanly through the first-publish path', async () => {
    await makeSync().syncOne(SEED, thumbnailFor(SEED));
    const first = await listing();
    await templates.unpublish(first.id, ownerId);
    // The record outlives the listing: nothing deletes it.
    expect(
      await prisma.templateSeedRecord.findUnique({
        where: { documentId: DOC_ID },
      }),
    ).not.toBeNull();

    const outcome = await makeSync().syncOne(SEED, thumbnailFor(SEED));

    expect(outcome.result).toBe('published');
    const second = await listing();
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ visibility: 'public', status: 'listed' });
  });

  it('the review CAS the command relies on refuses a stale contentAt', async () => {
    // Approval echoes the watermark read before the content read-back; an
    // edit after that read must make `review()` refuse, not approve.
    await makeSync().syncOne(SEED, thumbnailFor(SEED));
    const approved = await listing();
    strangerEdit(DOC_ID);
    await settle();

    await expect(
      templates.review(approved.id, ownerId, {
        decision: 'approve',
        contentAt: approved.contentChangedAt!.toISOString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
