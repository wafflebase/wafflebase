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
    // The delivery itself is the promise `settle()` awaits, so a rejected
    // `onDocumentChanged` fails the test at that step rather than surfacing
    // as an unhandled rejection.
    pendingDeliveries.push(
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)).then(() =>
        reviewSync.onDocumentChanged(documentId, at),
      ),
    );
  }

  /** A stranger's edit: different content, and its own event. */
  function strangerEdit(documentId: string, delayMs = 0): void {
    roots.set(documentId, `stranger-${randomUUID()}`);
    deliverEvent(documentId, delayMs);
  }

  let onWrite: ((documentId: string) => void) | undefined;

  function makeSync(
    authorId = ownerId,
    service: ConstructorParameters<
      typeof TemplateSync
    >[0]['templates'] = templates,
  ): TemplateSync {
    return new TemplateSync(
      {
        prisma,
        templates: service,
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
        authorId,
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

  it('a Share-dialog tag edit between runs is detected and re-synced', async () => {
    await makeSync().syncOne(SEED, thumbnailFor(SEED));
    const approved = await listing();
    // The dialog calls the same `update()`, and never touches the record.
    await templates.update(approved.id, ownerId, { tags: ['hand-edited'] });

    const outcome = await makeSync().syncOne(SEED, thumbnailFor(SEED));

    expect(outcome.result).toBe('updated');
    expect(await listing()).toMatchObject({
      tags: SEED.tags,
      visibility: 'public',
      status: 'listed',
    });
  });

  it('a Share-dialog title edit is detected and never approved', async () => {
    await makeSync().syncOne(SEED, thumbnailFor(SEED));
    const approved = await listing();
    // A card field: the service returns the listing to review.
    await templates.update(approved.id, ownerId, { title: 'Hand-edited' });
    expect((await listing()).status).toBe('pending');

    const outcome = await makeSync().syncOne(SEED, thumbnailFor(SEED));

    expect(outcome.result).toBe('skipped');
    expect(await listing()).toMatchObject({
      title: 'Hand-edited',
      status: 'pending',
      reviewedBy: null,
    });
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

  it('third-party edit after approval: rewritten, and only our write approved', async () => {
    await makeSync().syncOne(SEED, thumbnailFor(SEED));
    strangerEdit(DOC_ID);
    await settle();
    const edited = await listing();
    expect(edited.status).toBe('pending');
    const strangers = roots.get(DOC_ID);

    const outcome = await makeSync().syncOne(SEED, thumbnailFor(SEED));

    expect(outcome.result).toBe('approved');
    expect(outcome.detail).toMatch(/edited outside this command/);
    // The stranger's root is gone, and what was approved is our write's
    // watermark — past the stranger's, never equal to it.
    expect(roots.get(DOC_ID)).not.toBe(strangers);
    const after = await listing();
    expect(after).toMatchObject({ visibility: 'public', status: 'listed' });
    expect(after.reviewedContentAt!.getTime()).toBeGreaterThan(
      edited.contentChangedAt!.getTime(),
    );
  });

  it('refuses an author who does not manage the document, before any write', async () => {
    // On the allowlist, but no member of the seed's workspace.
    const outsider = await createUser();
    process.env.WAFFLEBASE_TEMPLATE_REVIEWER_IDS = `${ownerId},${outsider.id}`;
    await makeSync().syncOne(SEED, thumbnailFor(SEED));
    const root = roots.get(DOC_ID);
    await prisma.templateSeedRecord.update({
      where: { documentId: DOC_ID },
      data: { appliedAt: null },
    });

    const outcome = await makeSync(outsider.id).syncOne(
      SEED,
      thumbnailFor(SEED),
    );

    expect(outcome.result).toBe('failed');
    expect(outcome.detail).toMatch(/cannot manage the seeded document/);
    expect(roots.get(DOC_ID)).toBe(root);
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

  describe('a card edit read before a submission and written after it', () => {
    /**
     * Make the service's next listing read return `stale` — the row as the
     * editor saw it before the submission — while the database has moved on.
     * That is the delayed write: validated against `listed`, landing on
     * `pending`.
     */
    function readStaleOnce(stale: Awaited<ReturnType<typeof listing>>): void {
      const original = prisma.templateListing.findUnique.bind(
        prisma.templateListing,
      );
      jest
        .spyOn(prisma.templateListing, 'findUnique')
        .mockImplementationOnce((() => Promise.resolve(stale)) as never)
        .mockImplementation(original as never);
    }

    afterEach(() => jest.restoreAllMocks());

    it('is refused, so sync approves the card it checked', async () => {
      // An unlisted listing (no record) that sync will submit and approve.
      await templates.publish(DOC_ID, ownerId, {
        title: SEED.title,
        description: SEED.description,
        category: SEED.category,
        tags: SEED.tags,
        thumbnailId: 'seed-thumb.webp',
        visibility: 'unlisted',
        acceptLicense: true,
      });
      const beforeSubmit = await listing();
      let delayed: Promise<unknown> | undefined;

      // The edit's write lands after sync submitted and checked the frozen
      // card, immediately before it approves.
      const racing = {
        publish: templates.publish.bind(templates),
        update: templates.update.bind(templates),
        submit: templates.submit.bind(templates),
        assertCanManage: templates.assertCanManage.bind(templates),
        notifyReviewQueued: templates.notifyReviewQueued.bind(templates),
        review: async (...args: Parameters<TemplateService['review']>) => {
          if (!delayed) {
            readStaleOnce(beforeSubmit);
            delayed = templates
              .update(beforeSubmit.id, ownerId, { title: 'Swapped in' })
              .catch((err: unknown) => err);
            await delayed;
          }
          return templates.review(...args);
        },
      };

      const outcome = await makeSync(ownerId, racing).syncOne(
        SEED,
        thumbnailFor(SEED),
      );

      expect(await delayed).toBeInstanceOf(ConflictException);
      expect(outcome.result).toBe('approved');
      expect(await listing()).toMatchObject({
        title: SEED.title,
        visibility: 'public',
        status: 'listed',
      });
    });

    it('is refused on the republish path too', async () => {
      await templates.publish(DOC_ID, ownerId, {
        title: SEED.title,
        visibility: 'unlisted',
        acceptLicense: true,
      });
      const beforeSubmit = await listing();
      await templates.submit(
        beforeSubmit.id,
        ownerId,
        { acceptLicense: true },
        { quiet: true },
      );

      readStaleOnce(beforeSubmit);
      await expect(
        templates.publish(DOC_ID, ownerId, { title: 'Swapped in' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await listing()).toMatchObject({
        title: SEED.title,
        status: 'pending',
      });
    });

    it('still lets a tags-only edit through a concurrent submission', async () => {
      await templates.publish(DOC_ID, ownerId, {
        title: SEED.title,
        visibility: 'unlisted',
        acceptLicense: true,
      });
      const beforeSubmit = await listing();
      await templates.submit(
        beforeSubmit.id,
        ownerId,
        { acceptLicense: true },
        { quiet: true },
      );

      readStaleOnce(beforeSubmit);
      await templates.update(beforeSubmit.id, ownerId, { tags: ['later'] });
      expect(await listing()).toMatchObject({
        tags: ['later'],
        status: 'pending',
      });
    });
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
