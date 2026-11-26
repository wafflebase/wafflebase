import type { TemplateListing, TemplateSeedRecord } from '@prisma/client';
import { seedContentHash, seedDocumentId, stableStringify } from './seed-hash';
import {
  cardDrift,
  TemplateSync,
  type SeedThumbnail,
  type TemplateSyncDeps,
  type TemplateSyncOptions,
} from './template-sync';
import type { TemplateSeed } from './types';

/**
 * The `sync:templates` state table (docs/design/template-catalog-scaling.md
 * §3), driven against an in-memory listing and record. The service mocks do
 * the one state transition each real method makes and nothing else, so what
 * is asserted is the order and choice of calls, not the service's own rules
 * (those are `template.service.spec.ts`).
 *
 * Two clocks, deliberately far apart: `localClock` is the sync host's, and
 * only measures waiting; `yorkieClock` issues event instants. The sync host
 * is set decades *ahead* of Yorkie, so any comparison between the two would
 * wedge every content write.
 */

const AUTHOR = 7;
const SEED: TemplateSeed = {
  slug: 'demo-deck',
  title: 'Demo deck',
  description: 'A deck',
  category: 'work/report-review',
  tags: ['demo'],
  content: { kind: 'note', document: { content: '# Hello' } },
};
const DOC_ID = seedDocumentId(SEED.slug);
const CONTENT_HASH = seedContentHash(SEED.content);
const THUMB: SeedThumbnail = {
  bytes: Buffer.from('webp-bytes'),
  mimeType: 'image/webp',
  sha256: 'thumb-sha',
  contentHash: CONTENT_HASH,
};
/** A Yorkie-issued watermark from a previous, observed write of ours. */
const OURS = new Date(1_000);
const GOOD_CONFIG: Record<string, string> = {
  WAFFLEBASE_TEMPLATE_REVIEWER_IDS: `${AUTHOR}`,
  YORKIE_AUTH_WEBHOOK_ENFORCE: 'true',
};

function listingRow(overrides: Partial<TemplateListing> = {}): TemplateListing {
  return {
    id: 'listing-1',
    documentId: DOC_ID,
    workspaceId: 'ws',
    createdBy: AUTHOR,
    shareLinkId: 'link-1',
    title: SEED.title,
    description: SEED.description,
    category: SEED.category,
    tags: SEED.tags,
    thumbnailId: 'old-thumb.webp',
    visibility: 'public',
    status: 'listed',
    submittedAt: null,
    contentChangedAt: OURS,
    reviewedContentAt: OURS,
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
    useCount: 0,
    licensedAt: new Date(0),
    originId: null,
    publishedAt: new Date(0),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as TemplateListing;
}

function recordRow(
  overrides: Partial<TemplateSeedRecord> = {},
): TemplateSeedRecord {
  return {
    documentId: DOC_ID,
    slug: SEED.slug,
    contentHash: CONTENT_HASH,
    thumbnailHash: THUMB.sha256,
    thumbnailId: 'old-thumb.webp',
    appliedAt: OURS,
    writtenHash: 'h-ours',
    updatedAt: new Date(0),
    ...overrides,
  };
}

/** The card fields a publish/update body carries, as the mocks read them. */
type CardDto = {
  title?: string;
  description?: string | null;
  category?: string | null;
  tags?: string[];
  thumbnailId?: string;
};

interface World {
  listing: TemplateListing | null;
  record: TemplateSeedRecord | null;
  /** The sync host's clock (ms). */
  localClock: number;
  /** Yorkie's clock (ms); every event instant comes from here. */
  yorkieClock: number;
  /** Whether the Yorkie event webhook reaches this backend at all. */
  eventsRegistered: boolean;
  /** Listing reads to let pass before a pending event lands. */
  eventDelayReads: number;
  /** Writes whose event has not landed yet. */
  pendingEvents: number;
  /** The document's root hash as Yorkie would serialize it now. */
  docHash: string;
  /** The seeded `Document` row, or null when it was never seeded. */
  doc: {
    id: string;
    type: string;
    workspaceId: string;
    deletedAt: Date | null;
  } | null;
  /**
   * Runs right after a content read-back — an edit racing the approval.
   * `call` counts read-backs in this run: the first is the drift check made
   * before anything is written, the last the one approval relies on.
   */
  afterReadback?: (world: World, call: number) => void;
}

/** The Yorkie event for a write, as `TemplateReviewSyncService` applies it. */
function landEvent(world: World): void {
  world.yorkieClock += 10;
  const at = world.yorkieClock;
  const l = world.listing;
  if (!l) return; // no listing → the watermark is not recorded anywhere
  world.listing = {
    ...l,
    contentChangedAt: new Date(at),
    ...(l.visibility === 'public' &&
    l.status === 'listed' &&
    (!l.reviewedContentAt || l.reviewedContentAt.getTime() < at)
      ? { status: 'pending' }
      : {}),
  };
}

function setup(
  initial: Partial<World> = {},
  config: Record<string, string> = GOOD_CONFIG,
) {
  const world: World = {
    listing: null,
    record: null,
    localClock: Date.UTC(2090, 0, 1),
    yorkieClock: 5_000,
    eventsRegistered: true,
    eventDelayReads: 2,
    pendingEvents: 0,
    docHash: 'h-ours',
    doc: { id: DOC_ID, type: 'note', workspaceId: 'ws', deletedAt: null },
    ...initial,
  };
  let writes = 0;
  let readsSinceWrite = 0;
  let readbacks = 0;
  const prisma = {
    document: {
      findUnique: jest.fn(() => Promise.resolve(world.doc)),
    },
    templateListing: {
      findUnique: jest.fn(() => {
        if (
          world.pendingEvents > 0 &&
          ++readsSinceWrite > world.eventDelayReads
        ) {
          world.pendingEvents -= 1;
          landEvent(world);
        }
        return Promise.resolve(world.listing ? { ...world.listing } : null);
      }),
    },
    templateSeedRecord: {
      findUnique: jest.fn(() =>
        Promise.resolve(world.record ? { ...world.record } : null),
      ),
      upsert: jest.fn(
        ({
          create,
          update,
        }: {
          create: TemplateSeedRecord;
          update: Partial<TemplateSeedRecord>;
        }) => {
          world.record = world.record
            ? { ...world.record, ...update }
            : { ...create, updatedAt: new Date(0) };
          return Promise.resolve({ ...world.record });
        },
      ),
    },
  };
  const templates = {
    publish: jest.fn((_doc: string, _user: number, dto: CardDto) => {
      world.listing = listingRow({
        visibility: 'unlisted',
        status: 'listed',
        thumbnailId: dto.thumbnailId,
        contentChangedAt: null,
        reviewedContentAt: null,
      });
      return Promise.resolve({});
    }),
    update: jest.fn((_id: string, _user: number, dto: CardDto) => {
      const l = world.listing!;
      // `cardReviewReset`: a card field on a public listed listing → pending.
      const cardTouched = (
        ['title', 'description', 'category', 'thumbnailId'] as const
      ).some((k) => dto[k] !== undefined);
      world.listing = {
        ...l,
        ...dto,
        ...(cardTouched && l.visibility === 'public' && l.status === 'listed'
          ? { status: 'pending' }
          : {}),
      } as TemplateListing;
      return Promise.resolve({});
    }),
    submit: jest.fn(() => {
      world.listing = { ...world.listing!, status: 'pending' };
      return Promise.resolve({});
    }),
    assertCanManage: jest.fn(() => Promise.resolve()),
    notifyReviewQueued: jest.fn(() => Promise.resolve()),
    review: jest.fn(
      (_id: string, _user: number, dto: { contentAt?: string }) => {
        // `review()`'s CAS (template.service.ts, `seen !== actual`): the
        // watermark echoed must still be the listing's current one.
        const actual = world.listing!.contentChangedAt?.getTime() ?? null;
        const seen = dto.contentAt ? new Date(dto.contentAt).getTime() : null;
        if (seen !== actual) {
          return Promise.reject(
            new Error('This template changed while you were reviewing it'),
          );
        }
        world.listing = {
          ...world.listing!,
          status: 'listed',
          visibility: 'public',
          reviewedContentAt: world.listing!.contentChangedAt,
        };
        return Promise.resolve({});
      },
    ),
  };
  const images = {
    upload: jest.fn(() => Promise.resolve({ id: 'new-thumb.webp', url: '/x' })),
    delete: jest.fn(() => Promise.resolve(undefined)),
  };
  const writeContent = jest.fn(() => {
    writes += 1;
    world.docHash = `h-write-${writes}`;
    if (world.eventsRegistered) {
      world.pendingEvents += 1;
      readsSinceWrite = 0;
    }
    return Promise.resolve(world.docHash);
  });
  const readContentHash = jest.fn(() => {
    const hash = world.docHash;
    world.afterReadback?.(world, ++readbacks);
    return Promise.resolve(hash);
  });
  const deps: TemplateSyncDeps = {
    prisma: prisma as unknown as TemplateSyncDeps['prisma'],
    templates: templates as unknown as TemplateSyncDeps['templates'],
    images: images as unknown as TemplateSyncDeps['images'],
    config: { get: <T>(key: string) => config[key] as T | undefined },
    writeContent,
    readContentHash,
    now: () => new Date(world.localClock),
    sleep: (ms) => {
      world.localClock += ms;
      return Promise.resolve();
    },
  };
  const make = (extra: Partial<TemplateSyncOptions> = {}) =>
    new TemplateSync(deps, {
      authorId: AUTHOR,
      eventTimeoutMs: 5_000,
      pollIntervalMs: 500,
      ...extra,
    });
  return {
    world,
    make,
    prisma,
    templates,
    images,
    writeContent,
    readContentHash,
  };
}

/** No service method that writes was called (`assertCanManage` only reads). */
function expectNoServiceWrites(templates: Record<string, jest.Mock>): void {
  for (const [name, fn] of Object.entries(templates)) {
    if (name === 'assertCanManage') continue;
    expect(fn).not.toHaveBeenCalled();
  }
}

describe('TemplateSync', () => {
  it('publishes, writes the catalogue content itself, then approves its own watermark', async () => {
    const { world, make, templates, images, writeContent } = setup();

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome).toMatchObject({ result: 'published' });
    expect(images.upload).toHaveBeenCalledWith(
      THUMB.bytes,
      'image/webp',
      'demo-deck.webp',
    );
    expect(templates.publish).toHaveBeenCalledWith(DOC_ID, AUTHOR, {
      title: SEED.title,
      description: SEED.description,
      category: SEED.category,
      tags: SEED.tags,
      thumbnailId: 'new-thumb.webp',
      visibility: 'unlisted',
      acceptLicense: true,
    });
    // Written after the listing exists, so its event is recorded on it.
    expect(writeContent).toHaveBeenCalledWith(DOC_ID, SEED.content);
    expect(templates.publish.mock.invocationCallOrder[0]).toBeLessThan(
      writeContent.mock.invocationCallOrder[0],
    );
    expect(templates.submit).toHaveBeenCalledWith(
      'listing-1',
      AUTHOR,
      { acceptLicense: true },
      { quiet: true },
    );
    const watermark = new Date(world.yorkieClock).toISOString();
    expect(templates.review).toHaveBeenCalledWith('listing-1', AUTHOR, {
      decision: 'approve',
      contentAt: watermark,
    });
    expect(world.listing).toMatchObject({
      status: 'listed',
      visibility: 'public',
    });
    expect(world.record).toMatchObject({
      contentHash: CONTENT_HASH,
      thumbnailHash: THUMB.sha256,
      thumbnailId: 'new-thumb.webp',
    });
    expect(world.record!.appliedAt!.toISOString()).toBe(watermark);
  });

  it('never compares Yorkie instants with the host clock (skew in either direction)', async () => {
    for (const localClock of [Date.UTC(2090, 0, 1), 0]) {
      const { make, templates } = setup({
        localClock,
        yorkieClock: Date.UTC(2040, 0, 1),
      });
      const outcome = await make().syncOne(SEED, THUMB);
      expect(outcome.result).toBe('published');
      expect(templates.review).toHaveBeenCalledTimes(1);
    }
  });

  it('fails closed without the event webhook: content written, nothing approved', async () => {
    const { world, make, templates, writeContent } = setup({
      eventsRegistered: false,
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('failed');
    expect(outcome.detail).toMatch(/Register the Yorkie event webhook/);
    expect(writeContent).toHaveBeenCalledTimes(1);
    expect(templates.submit).not.toHaveBeenCalled();
    expect(templates.review).not.toHaveBeenCalled();
    // Nothing attested, so the next run rewrites and waits again.
    expect(world.record?.appliedAt).toBeNull();

    world.eventsRegistered = true;
    const retry = await make().syncOne(SEED, THUMB);
    expect(retry.result).toBe('approved');
    expect(writeContent).toHaveBeenCalledTimes(2);
    expect(templates.review).toHaveBeenCalledWith('listing-1', AUTHOR, {
      decision: 'approve',
      contentAt: new Date(world.yorkieClock).toISOString(),
    });
  });

  it('never approves with an undefined watermark', async () => {
    // An existing listing, never written by this command, events off.
    const { make, templates } = setup({
      listing: listingRow({ visibility: 'unlisted', contentChangedAt: null }),
      eventsRegistered: false,
    });

    await make().syncOne(SEED, THUMB);

    expect(templates.review).not.toHaveBeenCalled();
  });

  it('is a no-op on a listed public seed whose hashes are equal', async () => {
    const { make, templates, images, writeContent } = setup({
      listing: listingRow(),
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('unchanged');
    expect(images.upload).not.toHaveBeenCalled();
    expect(writeContent).not.toHaveBeenCalled();
    expectNoServiceWrites(templates);
  });

  it('updates a drifted card without re-uploading identical thumbnail bytes', async () => {
    // The catalogue changed its card: the listing still shows the old one.
    const { make, templates, images, writeContent } = setup({
      listing: listingRow({
        title: 'Old title',
        description: 'Old',
        category: 'other',
        tags: ['old'],
      }),
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('approved');
    expect(images.upload).not.toHaveBeenCalled();
    expect(writeContent).not.toHaveBeenCalled();
    expect(templates.update).toHaveBeenCalledWith('listing-1', AUTHOR, {
      title: SEED.title,
      description: SEED.description,
      category: SEED.category,
      tags: SEED.tags,
    });
    expect(templates.submit).not.toHaveBeenCalled();
    expect(templates.review).toHaveBeenCalledWith('listing-1', AUTHOR, {
      decision: 'approve',
      contentAt: OURS.toISOString(),
    });
  });

  it('reads card drift off the listing: a Share-dialog tag edit is re-synced', async () => {
    // `update()` from the dialog never touches the seed record, so a record
    // holding the catalogue's card would call this listing unchanged.
    const { world, make, templates } = setup({
      listing: listingRow({ tags: ['hand-edited'] }),
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(templates.update).toHaveBeenCalledWith('listing-1', AUTHOR, {
      tags: SEED.tags,
    });
    // Tags are not a CARD_FIELD: the listing stays public, nothing to review.
    expect(outcome.result).toBe('updated');
    expect(world.listing?.tags).toEqual(SEED.tags);
  });

  it('refuses to approve a card hand-edited into review from the dialog', async () => {
    // A title edit on an approved listing returns it to `pending`; the old
    // record-based check saw equal hashes and approved the stranger's card.
    const { make, templates } = setup({
      listing: listingRow({ status: 'pending', title: 'Hand-edited title' }),
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('skipped');
    expect(outcome.detail).toMatch(/card this command has not applied/);
    expect(templates.review).not.toHaveBeenCalled();
  });

  it('re-syncs a thumbnail replaced from the dialog ("Update preview")', async () => {
    const { make, templates, images } = setup({
      listing: listingRow({ thumbnailId: 'dialog-thumb.webp' }),
      record: recordRow(),
    });

    await make().syncOne(SEED, THUMB);

    expect(images.upload).toHaveBeenCalledTimes(1);
    expect(templates.update).toHaveBeenCalledWith('listing-1', AUTHOR, {
      thumbnailId: 'new-thumb.webp',
    });
  });

  it('uploads and attaches a thumbnail only when its bytes changed', async () => {
    const { make, templates, images } = setup({
      listing: listingRow(),
      record: recordRow({ thumbnailHash: 'older-bytes' }),
    });

    await make().syncOne(SEED, THUMB);

    expect(images.upload).toHaveBeenCalledTimes(1);
    expect(templates.update).toHaveBeenCalledWith('listing-1', AUTHOR, {
      thumbnailId: 'new-thumb.webp',
    });
    expect(templates.review).toHaveBeenCalledTimes(1);
  });

  it('rewrites changed content, waits for its event, then approves that watermark', async () => {
    const { world, make, templates, writeContent } = setup({
      listing: listingRow(),
      record: recordRow({ contentHash: 'old-content' }),
      eventDelayReads: 4,
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('approved');
    expect(writeContent).toHaveBeenCalledWith(DOC_ID, SEED.content);
    const at = new Date(world.yorkieClock).toISOString();
    expect(templates.review).toHaveBeenCalledWith('listing-1', AUTHOR, {
      decision: 'approve',
      contentAt: at,
    });
    expect(world.record!.appliedAt!.toISOString()).toBe(at);
    expect(world.record!.contentHash).toBe(CONTENT_HASH);
  });

  it('approves a pending seed whose watermark is still its own (an interrupted run)', async () => {
    const { make, templates } = setup({
      listing: listingRow({ visibility: 'unlisted', status: 'pending' }),
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome).toMatchObject({
      result: 'approved',
      detail: 'approved (resumed)',
    });
    expect(templates.submit).not.toHaveBeenCalled();
    expect(templates.review).toHaveBeenCalledTimes(1);
  });

  it('resubmits and approves a rejected seed below the public tier', async () => {
    const { make, templates } = setup({
      listing: listingRow({ visibility: 'unlisted', status: 'rejected' }),
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('approved');
    expect(templates.submit).toHaveBeenCalledTimes(1);
    expect(templates.review).toHaveBeenCalledTimes(1);
  });

  it('skips a removed listing without calling the service', async () => {
    const { make, templates, images, writeContent } = setup({
      listing: listingRow({ status: 'removed', visibility: 'unlisted' }),
      record: recordRow({ contentHash: 'old' }),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('skipped');
    expect(images.upload).not.toHaveBeenCalled();
    expect(writeContent).not.toHaveBeenCalled();
    expectNoServiceWrites(templates);
  });

  it('rewrites a seed somebody else edited, then approves only its own write', async () => {
    // Without the rewrite `contentChanged` stays false and the read-back
    // refuses on every run: a seed edited once would never return.
    const { world, make, templates, writeContent } = setup({
      listing: listingRow({
        status: 'pending',
        contentChangedAt: new Date(2_000),
      }),
      record: recordRow(),
      docHash: 'h-stranger',
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(writeContent).toHaveBeenCalledWith(DOC_ID, SEED.content);
    expect(outcome).toMatchObject({ result: 'approved' });
    expect(outcome.detail).toMatch(/edited outside this command/);
    // The watermark approved is our write's, never the stranger's 2_000.
    expect(templates.review).toHaveBeenCalledWith('listing-1', AUTHOR, {
      decision: 'approve',
      contentAt: new Date(world.yorkieClock).toISOString(),
    });
    expect(world.record!.writtenHash).toBe('h-write-1');
  });

  it('does not report a public seed unchanged when its document drifted', async () => {
    // The edit event was missed, so the listing still reads public + listed.
    const { world, make, writeContent, templates } = setup({
      listing: listingRow(),
      record: recordRow(),
      docHash: 'h-stranger',
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(writeContent).toHaveBeenCalledTimes(1);
    expect(outcome.result).toBe('approved');
    expect(templates.review).toHaveBeenCalledTimes(1);
    expect(world.listing).toMatchObject({
      visibility: 'public',
      status: 'listed',
    });
  });

  it('refuses a stranger edit whose event was credited to our write', async () => {
    // The stranger edits right after our write; the first watermark advance
    // the wait sees could be theirs. The read-back catches it.
    const { world, make, templates, writeContent } = setup();
    writeContent.mockImplementationOnce(() => {
      world.docHash = 'h-write-1';
      world.pendingEvents += 1;
      world.docHash = 'h-stranger';
      return Promise.resolve('h-write-1');
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('failed');
    expect(outcome.detail).toMatch(/no longer holds what this command wrote/);
    expect(templates.review).not.toHaveBeenCalled();
  });

  it('does not wedge when our own late event moved the watermark', async () => {
    // Content is still exactly ours; only the watermark moved (our event
    // arriving after a previous run attested an earlier one).
    const { make, templates } = setup({
      listing: listingRow({
        status: 'pending',
        contentChangedAt: new Date(2_000),
      }),
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('approved');
    expect(templates.review).toHaveBeenCalledWith('listing-1', AUTHOR, {
      decision: 'approve',
      contentAt: new Date(2_000).toISOString(),
    });
  });

  it('relies on the review CAS for an edit landing after the read-back', async () => {
    const { world, make, templates } = setup({
      listing: listingRow({ status: 'pending' }),
      record: recordRow(),
      afterReadback: (w, call) => {
        // A stranger's edit lands, event and all, between read-back and
        // approval: the watermark moves past the one we will echo. Call 1 is
        // the drift check before any write; call 2 is the approval's.
        if (call !== 2) return;
        w.docHash = 'h-stranger';
        w.pendingEvents += 1;
        w.eventDelayReads = -1;
        landEvent(w);
      },
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(templates.review).toHaveBeenCalledTimes(1);
    expect(outcome.result).toBe('failed');
    expect(outcome.detail).toMatch(/changed while you were reviewing/);
    expect(world.listing?.visibility).toBe('public');
    expect(world.listing?.status).toBe('pending');
  });

  it('re-syncs an unpublished seed: the stale record is discarded', async () => {
    // `unpublish` deleted the listing; the record from the earlier run
    // remains and must not be trusted.
    const { world, make, templates, writeContent } = setup({
      listing: null,
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('published');
    expect(templates.publish).toHaveBeenCalledTimes(1);
    expect(writeContent).toHaveBeenCalledTimes(1);
    expect(templates.review).toHaveBeenCalledWith('listing-1', AUTHOR, {
      decision: 'approve',
      contentAt: new Date(world.yorkieClock).toISOString(),
    });
    expect(world.record).toMatchObject({
      contentHash: CONTENT_HASH,
      writtenHash: 'h-write-1',
    });
  });

  describe('the seeded document must be the one this catalogue made', () => {
    it.each([
      ['missing', null, 'skipped', /not seeded/],
      [
        'trashed',
        { id: DOC_ID, type: 'note', workspaceId: 'ws', deletedAt: new Date(1) },
        'failed',
        /in the trash/,
      ],
      [
        'in another workspace',
        { id: DOC_ID, type: 'note', workspaceId: 'other', deletedAt: null },
        'failed',
        /seeded into workspace other/,
      ],
      [
        'of another type',
        { id: DOC_ID, type: 'sheet', workspaceId: 'ws', deletedAt: null },
        'failed',
        /is a sheet, the catalogue says note/,
      ],
    ])(
      'refuses a document that is %s',
      async (_label, doc, result, message) => {
        const { make, templates, images, writeContent } = setup({ doc });
        const sync = make({ workspaceId: 'ws' });

        const outcome = await sync.syncOne(SEED, THUMB);

        expect(outcome.result).toBe(result);
        expect(outcome.detail).toMatch(message);
        expect(images.upload).not.toHaveBeenCalled();
        expect(writeContent).not.toHaveBeenCalled();
        expect(templates.publish).not.toHaveBeenCalled();
      },
    );
  });

  it('refuses a thumbnail rendered from other content', async () => {
    const { make, templates, images } = setup();

    const outcome = await make().syncOne(SEED, {
      ...THUMB,
      contentHash: 'stale',
    });

    expect(outcome.result).toBe('failed');
    expect(images.upload).not.toHaveBeenCalled();
    expect(templates.publish).not.toHaveBeenCalled();
  });

  it('skips a pending listing whose card it has not applied', async () => {
    const { make, templates } = setup({
      listing: listingRow({ status: 'pending', title: 'Other title' }),
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('skipped');
    expect(templates.update).not.toHaveBeenCalled();
    expect(templates.review).not.toHaveBeenCalled();
  });

  it('skips a public rejected listing, which the service cannot resubmit', async () => {
    const { make, templates } = setup({
      listing: listingRow({ status: 'rejected' }),
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('skipped');
    expect(templates.submit).not.toHaveBeenCalled();
  });

  it('treats a listing without a record as entirely changed', async () => {
    const { make, templates, images, writeContent } = setup({
      listing: listingRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('approved');
    expect(images.upload).toHaveBeenCalledTimes(1);
    expect(templates.update).toHaveBeenCalledTimes(1);
    expect(writeContent).toHaveBeenCalledTimes(1);
    expect(templates.review).toHaveBeenCalledTimes(1);
  });

  it('deletes the uploaded thumbnail when publishing fails', async () => {
    const { make, templates, images } = setup();
    templates.publish.mockRejectedValueOnce(new Error('boom'));

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome).toMatchObject({ result: 'failed', detail: 'boom' });
    expect(images.delete).toHaveBeenCalledWith('new-thumb.webp');
  });

  it('applies a tags-only drift to a pending listing, then approves', async () => {
    // Tags are not a card field: the service lets them change under review,
    // so they are no reason to refuse the seed.
    const { make, templates } = setup({
      listing: listingRow({
        visibility: 'unlisted',
        status: 'pending',
        tags: ['old'],
      }),
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(templates.update).toHaveBeenCalledWith('listing-1', AUTHOR, {
      tags: SEED.tags,
    });
    expect(outcome.result).toBe('approved');
  });

  it('names a pending listing whose only drift is a newer thumbnail render', async () => {
    const { make, templates, images } = setup({
      listing: listingRow({ status: 'pending' }),
      record: recordRow({ thumbnailHash: 'older-bytes' }),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('skipped');
    expect(outcome.detail).toMatch(/older render of its thumbnail/);
    expect(outcome.detail).not.toMatch(/card this command has not applied/);
    expect(images.upload).not.toHaveBeenCalled();
    expect(templates.review).not.toHaveBeenCalled();
  });

  it('resumes after a thumbnail update that committed and then failed', async () => {
    // The update committed (new thumbnail attached, listing back to
    // `pending`) and the call still reported an error. Read as somebody
    // else's attachment, that pending listing would be refused every run.
    const { world, make, templates, images } = setup({
      listing: listingRow(),
      record: recordRow({ thumbnailHash: 'older-bytes' }),
    });
    templates.update.mockImplementationOnce(
      (_id: string, _user: number, dto: CardDto) => {
        world.listing = {
          ...world.listing!,
          ...dto,
          status: 'pending',
        } as TemplateListing;
        return Promise.reject(new Error('lost the reply'));
      },
    );

    const first = await make().syncOne(SEED, THUMB);

    expect(first.result).toBe('failed');
    // Attached, so neither discarded nor rolled back out of the record.
    expect(images.delete).not.toHaveBeenCalled();
    expect(world.record).toMatchObject({
      thumbnailId: 'new-thumb.webp',
      thumbnailHash: THUMB.sha256,
    });

    const second = await make().syncOne(SEED, THUMB);

    expect(second.result).toBe('approved');
    expect(world.listing).toMatchObject({
      status: 'listed',
      visibility: 'public',
      thumbnailId: 'new-thumb.webp',
    });
  });

  it('records the new thumbnail before attaching it', async () => {
    const { world, make, templates } = setup({
      listing: listingRow(),
      record: recordRow({ thumbnailHash: 'older-bytes' }),
    });
    let recordedAtUpdate: string | null | undefined;
    templates.update.mockImplementationOnce(
      (_id: string, _user: number, dto: CardDto) => {
        recordedAtUpdate = world.record?.thumbnailId;
        world.listing = {
          ...world.listing!,
          ...dto,
          status: 'pending',
        } as TemplateListing;
        return Promise.resolve({});
      },
    );

    await make().syncOne(SEED, THUMB);

    expect(recordedAtUpdate).toBe('new-thumb.webp');
  });

  it('discards an upload and restores the record when the update did not commit', async () => {
    const { world, make, templates, images } = setup({
      listing: listingRow(),
      record: recordRow({ thumbnailHash: 'older-bytes' }),
    });
    templates.update.mockRejectedValueOnce(new Error('refused'));

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome).toMatchObject({ result: 'failed', detail: 'refused' });
    expect(images.delete).toHaveBeenCalledWith('new-thumb.webp');
    expect(world.record).toMatchObject({
      thumbnailId: 'old-thumb.webp',
      thumbnailHash: 'older-bytes',
    });
  });

  it('refuses to write a document the author does not manage', async () => {
    const { make, templates, writeContent, images } = setup({
      listing: listingRow({ visibility: 'unlisted' }),
      record: recordRow({ appliedAt: null }),
    });
    templates.assertCanManage.mockRejectedValueOnce(
      new Error('Only the workspace owner or document owner can publish'),
    );

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('failed');
    expect(outcome.detail).toMatch(/--author 7 cannot manage the seeded/);
    expect(writeContent).not.toHaveBeenCalled();
    expect(images.upload).not.toHaveBeenCalled();
    expect(templates.submit).not.toHaveBeenCalled();
  });

  it('does not approve a card edited between the drift check and submit', async () => {
    const { world, make, templates } = setup({
      listing: listingRow({ visibility: 'unlisted' }),
      record: recordRow(),
    });
    templates.submit.mockImplementationOnce(() => {
      // A manager renamed it just before `submit()` froze the card.
      world.listing = {
        ...world.listing!,
        title: 'Renamed by hand',
        status: 'pending',
      };
      return Promise.resolve({});
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('failed');
    expect(outcome.detail).toMatch(/not the card this command checked/);
    expect(templates.review).not.toHaveBeenCalled();
    // The quiet submission it cannot decide is handed to the reviewers.
    expect(templates.notifyReviewQueued).toHaveBeenCalledWith(
      'listing-1',
      AUTHOR,
    );
  });

  it('notifies the reviewers when a quiet submission is then refused', async () => {
    const { make, templates } = setup({
      listing: listingRow({ visibility: 'unlisted' }),
      record: recordRow(),
    });
    templates.review.mockRejectedValueOnce(
      new Error('This template changed while you were reviewing it'),
    );

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('failed');
    expect(templates.notifyReviewQueued).toHaveBeenCalledTimes(1);
  });

  it('sends no extra notification for a submission it did not make', async () => {
    const { make, templates } = setup({
      listing: listingRow({ visibility: 'unlisted', status: 'pending' }),
      record: recordRow(),
    });
    templates.review.mockRejectedValueOnce(new Error('conflict'));

    await make().syncOne(SEED, THUMB);

    expect(templates.submit).not.toHaveBeenCalled();
    expect(templates.notifyReviewQueued).not.toHaveBeenCalled();
  });

  describe('authorization lives in the class, not only the CLI', () => {
    it('refuses an author outside the reviewer allowlist', () => {
      const { make } = setup(
        {},
        { ...GOOD_CONFIG, WAFFLEBASE_TEMPLATE_REVIEWER_IDS: '1,2' },
      );
      expect(make).toThrow(/not in WAFFLEBASE_TEMPLATE_REVIEWER_IDS/);
    });

    it('refuses a deployment whose Yorkie auth webhook is not enforced', () => {
      const { make } = setup(
        {},
        { WAFFLEBASE_TEMPLATE_REVIEWER_IDS: `${AUTHOR}` },
      );
      expect(make).toThrow(/requires YORKIE_AUTH_WEBHOOK_ENFORCE=true/);
    });

    it('re-checks before each seed, so a run cannot outlive a revoked author', async () => {
      const config = { ...GOOD_CONFIG };
      const { make, templates } = setup({}, config);
      const sync = make();
      config.WAFFLEBASE_TEMPLATE_REVIEWER_IDS = '99';

      const outcome = await sync.syncOne(SEED, THUMB);

      expect(outcome.result).toBe('failed');
      expect(templates.publish).not.toHaveBeenCalled();
      expect(templates.review).not.toHaveBeenCalled();
    });
  });
});

describe('seed hashes', () => {
  it('ignores key order and undefined members', () => {
    expect(stableStringify({ b: 1, a: [1, { d: undefined, c: 2 }] })).toBe(
      stableStringify({ a: [1, { c: 2 }], b: 1 }),
    );
  });

  it('hashes content independent of generated ids, but not of what they link', () => {
    // `applyLayoutToSlide` keys placeholders with random ids, and the builder
    // counters move whenever a template is added before another; neither may
    // make a seed look changed.
    const deck = (el: string, block: string, ref: string, text: string) =>
      ({
        kind: 'slides',
        document: {
          slides: [
            {
              id: 's-1',
              elements: [
                { id: el, data: { blocks: [{ id: block, text }] } },
                { id: 'c-1', type: 'connector', from: ref },
              ],
            },
          ],
        },
      }) as never;
    const base = seedContentHash(
      deck('a1b2c3d4', 'a1b2c3d4-p0', 'a1b2c3d4', 'Hi'),
    );
    expect(
      seedContentHash(deck('9f8e7d6c', '9f8e7d6c-p0', '9f8e7d6c', 'Hi')),
    ).toBe(base);
    expect(
      seedContentHash(deck('9f8e7d6c', '9f8e7d6c-p0', '9f8e7d6c', 'Bye')),
    ).not.toBe(base);
    // Same ids, but the connector now points at itself: a different deck.
    expect(
      seedContentHash(deck('a1b2c3d4', 'a1b2c3d4-p0', 'c-1', 'Hi')),
    ).not.toBe(base);
  });

  it('compares card fields as the service stores them', () => {
    const listing = {
      title: SEED.title,
      description: SEED.description,
      category: SEED.category,
      tags: SEED.tags,
    };
    expect(cardDrift(listing, SEED)).toEqual({});
    // `normalizeTags` lowercases and trims: not drift.
    expect(cardDrift(listing, { ...SEED, tags: [' DEMO '] })).toEqual({});
    expect(cardDrift({ ...listing, tags: ['other'] }, SEED)).toEqual({
      tags: SEED.tags,
    });
    expect(cardDrift({ ...listing, description: null }, SEED)).toEqual({
      description: SEED.description,
    });
  });
});
