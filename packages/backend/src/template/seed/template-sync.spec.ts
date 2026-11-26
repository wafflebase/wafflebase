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
    contentChangedAt: null,
    reviewedContentAt: null,
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
    appliedAt: new Date(1_000),
    contentWrittenAt: null,
    updatedAt: new Date(1_000),
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
  clock: number;
  /** Called on every listing read — lets a test land an event mid-poll. */
  onRead?: (world: World) => void;
}

function setup(initial: Partial<World> = {}) {
  const world: World = {
    listing: null,
    record: null,
    clock: 10_000,
    ...initial,
  };
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
        world.onRead?.(world);
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
            : { ...create, updatedAt: new Date(world.clock) };
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
  const writeContent = jest.fn(() => Promise.resolve(undefined));
  const deps: TemplateSyncDeps = {
    prisma: prisma as unknown as TemplateSyncDeps['prisma'],
    templates: templates as unknown as TemplateSyncDeps['templates'],
    images: images as unknown as TemplateSyncDeps['images'],
    writeContent,
    now: () => new Date(world.clock),
    sleep: (ms) => {
      world.clock += ms;
      return Promise.resolve();
    },
  };
  const sync = new TemplateSync(deps, {
    authorId: AUTHOR,
    eventTimeoutMs: 5_000,
    pollIntervalMs: 500,
  });
  return { world, sync, prisma, templates, images, writeContent };
}

/** The Yorkie event for a write, as `TemplateReviewSyncService` applies it. */
function landEvent(world: World, at: number): void {
  const l = world.listing!;
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

describe('TemplateSync', () => {
  it('publishes with the thumbnail, submits quietly and approves a new seed', async () => {
    const { world, sync, templates, images } = setup();

    const outcome = await sync.syncOne(SEED, THUMB);

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
    expect(templates.submit).toHaveBeenCalledWith(
      'listing-1',
      AUTHOR,
      { acceptLicense: true },
      { quiet: true },
    );
    expect(templates.review).toHaveBeenCalledWith('listing-1', AUTHOR, {
      decision: 'approve',
      contentAt: undefined,
    });
    expect(world.listing).toMatchObject({
      status: 'listed',
      visibility: 'public',
    });
    expect(world.record).toMatchObject({
      contentHash: CONTENT_HASH,
      cardHash: CARD_HASH,
      thumbnailHash: THUMB.sha256,
      contentWrittenAt: null,
    });
  });

  it('is a no-op on a listed public seed whose hashes are equal', async () => {
    const { sync, templates, images, writeContent } = setup({
      listing: listingRow(),
      record: recordRow(),
    });

    const outcome = await sync.syncOne(SEED, THUMB);

    expect(outcome.result).toBe('unchanged');
    expect(images.upload).not.toHaveBeenCalled();
    expect(writeContent).not.toHaveBeenCalled();
    for (const fn of Object.values(templates))
      expect(fn).not.toHaveBeenCalled();
  });

  it('updates a changed card without re-uploading identical thumbnail bytes', async () => {
    const { world, sync, templates, images } = setup({
      listing: listingRow(),
      record: recordRow({ cardHash: 'old-card' }),
    });

    const outcome = await sync.syncOne(SEED, THUMB);

    expect(outcome.result).toBe('approved');
    expect(images.upload).not.toHaveBeenCalled();
    expect(templates.update).toHaveBeenCalledWith('listing-1', AUTHOR, {
      title: SEED.title,
      description: SEED.description,
      category: SEED.category,
      tags: SEED.tags,
    });
    expect(templates.submit).not.toHaveBeenCalled();
    expect(templates.review).toHaveBeenCalledTimes(1);
    expect(world.record?.cardHash).toBe(CARD_HASH);
  });

  it('uploads and attaches a thumbnail only when its bytes changed', async () => {
    const { sync, templates, images } = setup({
      listing: listingRow(),
      record: recordRow({ thumbnailHash: 'older-bytes' }),
    });

    await sync.syncOne(SEED, THUMB);

    expect(images.upload).toHaveBeenCalledTimes(1);
    expect(templates.update).toHaveBeenCalledWith('listing-1', AUTHOR, {
      thumbnailId: 'new-thumb.webp',
    });
    expect(templates.review).toHaveBeenCalledTimes(1);
  });

  it('writes changed content, waits for its event, then approves that watermark', async () => {
    const { world, sync, templates, writeContent } = setup({
      listing: listingRow({ reviewedContentAt: new Date(500) }),
      record: recordRow({ contentHash: 'old-content' }),
    });
    let reads = 0;
    world.onRead = (w) => {
      // The event lands on the third poll, a little after the write.
      if (++reads === 3) landEvent(w, w.clock + 1);
    };

    const outcome = await sync.syncOne(SEED, THUMB);

    expect(outcome.result).toBe('approved');
    expect(writeContent).toHaveBeenCalledWith(DOC_ID, SEED.content);
    const at = world.listing!.reviewedContentAt!.toISOString();
    expect(templates.review).toHaveBeenCalledWith('listing-1', AUTHOR, {
      decision: 'approve',
      contentAt: at,
    });
    expect(world.record).toMatchObject({
      contentHash: CONTENT_HASH,
      contentWrittenAt: null,
    });
    expect(world.record!.appliedAt.toISOString()).toBe(at);
  });

  it('fails loudly when the event never lands, and the next run resumes', async () => {
    const { world, sync, templates } = setup({
      listing: listingRow(),
      record: recordRow({ contentHash: 'old-content' }),
    });

    const first = await sync.syncOne(SEED, THUMB);

    expect(first.result).toBe('failed');
    expect(first.detail).toMatch(/no content event/);
    expect(templates.review).not.toHaveBeenCalled();
    // The write is remembered, so the next run waits instead of rewriting.
    expect(world.record?.contentHash).toBe(CONTENT_HASH);
    expect(world.record?.contentWrittenAt).not.toBeNull();

    landEvent(world, world.clock);
    const second = await sync.syncOne(SEED, THUMB);

    expect(second.result).toBe('approved');
    expect(templates.review).toHaveBeenCalledTimes(1);
  });

  it('approves a pending seed with equal hashes (an interrupted run)', async () => {
    const { sync, templates } = setup({
      listing: listingRow({ visibility: 'unlisted', status: 'pending' }),
      record: recordRow(),
    });

    const outcome = await sync.syncOne(SEED, THUMB);

    expect(outcome).toMatchObject({
      result: 'approved',
      detail: 'approved (resumed)',
    });
    expect(templates.submit).not.toHaveBeenCalled();
    expect(templates.review).toHaveBeenCalledTimes(1);
  });

  it('resubmits and approves a rejected seed below the public tier', async () => {
    const { sync, templates } = setup({
      listing: listingRow({ visibility: 'unlisted', status: 'rejected' }),
      record: recordRow(),
    });

    const outcome = await sync.syncOne(SEED, THUMB);

    expect(outcome.result).toBe('approved');
    expect(templates.submit).toHaveBeenCalledTimes(1);
    expect(templates.review).toHaveBeenCalledTimes(1);
  });

  it('skips a removed listing without calling the service', async () => {
    const { sync, templates, images, writeContent } = setup({
      listing: listingRow({ status: 'removed', visibility: 'unlisted' }),
      record: recordRow({ contentHash: 'old', cardHash: 'old' }),
    });

    const outcome = await sync.syncOne(SEED, THUMB);

    expect(outcome.result).toBe('skipped');
    expect(images.upload).not.toHaveBeenCalled();
    expect(writeContent).not.toHaveBeenCalled();
    for (const fn of Object.values(templates))
      expect(fn).not.toHaveBeenCalled();
  });

  it('refuses to approve content somebody else edited after it was applied', async () => {
    const { sync, templates } = setup({
      listing: listingRow({
        status: 'pending',
        contentChangedAt: new Date(2_000),
      }),
      record: recordRow({ appliedAt: new Date(1_000) }),
    });

    const outcome = await sync.syncOne(SEED, THUMB);

    expect(outcome.result).toBe('failed');
    expect(outcome.detail).toMatch(/edited by someone else/);
    expect(templates.review).not.toHaveBeenCalled();
  });

  it('refuses a thumbnail rendered from other content', async () => {
    const { sync, templates, images } = setup();

    const outcome = await sync.syncOne(SEED, {
      ...THUMB,
      contentHash: 'stale',
    });

    expect(outcome.result).toBe('failed');
    expect(images.upload).not.toHaveBeenCalled();
    expect(templates.publish).not.toHaveBeenCalled();
  });

  it('skips a pending listing whose card it has not applied', async () => {
    const { sync, templates } = setup({
      listing: listingRow({ status: 'pending' }),
      record: recordRow({ cardHash: 'old-card' }),
    });

    const outcome = await sync.syncOne(SEED, THUMB);

    expect(outcome.result).toBe('skipped');
    expect(templates.update).not.toHaveBeenCalled();
    expect(templates.review).not.toHaveBeenCalled();
  });

  it('skips a public rejected listing, which the service cannot resubmit', async () => {
    const { sync, templates } = setup({
      listing: listingRow({ status: 'rejected' }),
      record: recordRow(),
    });

    const outcome = await sync.syncOne(SEED, THUMB);

    expect(outcome.result).toBe('skipped');
    expect(templates.submit).not.toHaveBeenCalled();
  });

  it('treats a listing without a record as entirely changed', async () => {
    const { world, sync, templates, images, writeContent } = setup({
      listing: listingRow({ reviewedContentAt: new Date(500) }),
    });
    world.onRead = (w) => {
      if (w.record?.contentWrittenAt && !w.listing!.contentChangedAt) {
        landEvent(w, w.clock);
      }
    };

    const outcome = await sync.syncOne(SEED, THUMB);

    expect(outcome.result).toBe('approved');
    expect(images.upload).toHaveBeenCalledTimes(1);
    expect(templates.update).toHaveBeenCalledTimes(1);
    expect(writeContent).toHaveBeenCalledTimes(1);
    expect(templates.review).toHaveBeenCalledTimes(1);
  });

  it('deletes the uploaded thumbnail when publishing fails', async () => {
    const { sync, templates, images } = setup();
    templates.publish.mockRejectedValueOnce(new Error('boom'));

    const outcome = await sync.syncOne(SEED, THUMB);

    expect(outcome).toMatchObject({ result: 'failed', detail: 'boom' });
    expect(images.delete).toHaveBeenCalledWith('new-thumb.webp');
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
