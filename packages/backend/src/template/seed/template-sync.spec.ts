import type { TemplateListing, TemplateSeedRecord } from '@prisma/client';
import {
  seedCardHash,
  seedContentHash,
  seedDocumentId,
  stableStringify,
} from './seed-hash';
import {
  TemplateSync,
  type SeedThumbnail,
  type TemplateSyncDeps,
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
const CARD_HASH = seedCardHash(SEED);
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
    cardHash: CARD_HASH,
    thumbnailHash: THUMB.sha256,
    appliedAt: OURS,
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
    ...initial,
  };
  let readsSinceWrite = 0;
  const prisma = {
    document: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: DOC_ID,
          type: 'note',
          workspaceId: 'ws',
          deletedAt: null,
        }),
      ),
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
    review: jest.fn(() => {
      world.listing = {
        ...world.listing!,
        status: 'listed',
        visibility: 'public',
        reviewedContentAt: world.listing!.contentChangedAt,
      };
      return Promise.resolve({});
    }),
  };
  const images = {
    upload: jest.fn(() => Promise.resolve({ id: 'new-thumb.webp', url: '/x' })),
    delete: jest.fn(() => Promise.resolve(undefined)),
  };
  const writeContent = jest.fn(() => {
    if (world.eventsRegistered) {
      world.pendingEvents += 1;
      readsSinceWrite = 0;
    }
    return Promise.resolve(undefined);
  });
  const deps: TemplateSyncDeps = {
    prisma: prisma as unknown as TemplateSyncDeps['prisma'],
    templates: templates as unknown as TemplateSyncDeps['templates'],
    images: images as unknown as TemplateSyncDeps['images'],
    config: { get: <T>(key: string) => config[key] as T | undefined },
    writeContent,
    now: () => new Date(world.localClock),
    sleep: (ms) => {
      world.localClock += ms;
      return Promise.resolve();
    },
  };
  const make = () =>
    new TemplateSync(deps, {
      authorId: AUTHOR,
      eventTimeoutMs: 5_000,
      pollIntervalMs: 500,
    });
  return { world, make, prisma, templates, images, writeContent };
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
      cardHash: CARD_HASH,
      thumbnailHash: THUMB.sha256,
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
    for (const fn of Object.values(templates)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('updates a changed card without re-uploading identical thumbnail bytes', async () => {
    const { world, make, templates, images, writeContent } = setup({
      listing: listingRow(),
      record: recordRow({ cardHash: 'old-card' }),
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
    expect(world.record?.cardHash).toBe(CARD_HASH);
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
      record: recordRow({ contentHash: 'old', cardHash: 'old' }),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('skipped');
    expect(images.upload).not.toHaveBeenCalled();
    expect(writeContent).not.toHaveBeenCalled();
    for (const fn of Object.values(templates)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('refuses to approve content somebody else edited after it was applied', async () => {
    const { make, templates } = setup({
      listing: listingRow({
        status: 'pending',
        contentChangedAt: new Date(2_000),
      }),
      record: recordRow(),
    });

    const outcome = await make().syncOne(SEED, THUMB);

    expect(outcome.result).toBe('failed');
    expect(outcome.detail).toMatch(/edited by someone else/);
    expect(templates.review).not.toHaveBeenCalled();
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
      listing: listingRow({ status: 'pending' }),
      record: recordRow({ cardHash: 'old-card' }),
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
      expect(make).toThrow();
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

  it('changes the card hash when tags change', () => {
    expect(seedCardHash({ ...SEED, tags: ['other'] })).not.toBe(CARD_HASH);
  });
});
