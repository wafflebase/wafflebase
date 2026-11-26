import type {
  Document as DocumentModel,
  TemplateListing,
  TemplateSeedRecord,
} from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import type { ImageService } from '../../image/image.service';
import type { TemplateService } from '../template.service';
import { seedCardHash, seedContentHash, seedDocumentId } from './seed-hash';
import type { SeedContent, TemplateSeed } from './types';

/**
 * The state machine behind `pnpm backend sync:templates`
 * (docs/design/template-catalog-scaling.md §3, "Idempotency, keyed on slug").
 *
 * Every step is a call to an existing, guarded `TemplateService` method —
 * `publish`, `update`, `submit`, `review` — never a direct write of a
 * `TemplateListing` column. It is a sequence of compare-and-set steps, not a
 * transaction, and every intermediate state is one the next run continues
 * from: progress is recorded in `TemplateSeedRecord` after each step, and the
 * listing's own `status` says which step comes next.
 *
 * Kept free of Nest so a unit test can drive it with plain mocks.
 */

/** A rendered thumbnail, read from `render:thumbnails`' output directory. */
export interface SeedThumbnail {
  bytes: Buffer;
  mimeType: string;
  /** sha256 of `bytes`; also the record's `thumbnailHash`. */
  sha256: string;
  /** The `contentHash` of the content it was rendered from. */
  contentHash: string;
}

export type SyncResult =
  | 'published'
  | 'approved'
  | 'updated'
  | 'unchanged'
  | 'skipped'
  | 'failed';

export interface SyncOutcome {
  slug: string;
  result: SyncResult;
  detail: string;
}

export interface TemplateSyncDeps {
  prisma: Pick<
    PrismaService,
    'document' | 'templateListing' | 'templateSeedRecord'
  >;
  templates: Pick<TemplateService, 'publish' | 'update' | 'submit' | 'review'>;
  images: Pick<ImageService, 'upload' | 'delete'>;
  writeContent: (documentId: string, content: SeedContent) => Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface TemplateSyncOptions {
  authorId: number;
  /** When set, a seed document living in any other workspace is refused. */
  workspaceId?: string;
  /** How long to wait for a content write's `DocumentRootChanged` event. */
  eventTimeoutMs: number;
  pollIntervalMs: number;
}

/** A step that cannot proceed; reported as the seed's outcome. */
class SeedStop extends Error {
  constructor(
    readonly result: 'skipped' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

export class TemplateSync {
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly deps: TemplateSyncDeps,
    private readonly options: TemplateSyncOptions,
  ) {
    this.now = deps.now ?? (() => new Date());
    this.sleep =
      deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Bring one seed's listing in line with the catalogue. Never throws: a
   * failure is this seed's outcome, and the run moves on to the next one.
   */
  async syncOne(
    seed: TemplateSeed,
    thumbnail: SeedThumbnail,
  ): Promise<SyncOutcome> {
    try {
      const { result, detail } = await this.run(seed, thumbnail);
      return { slug: seed.slug, result, detail };
    } catch (err) {
      if (err instanceof SeedStop) {
        return { slug: seed.slug, result: err.result, detail: err.message };
      }
      return {
        slug: seed.slug,
        result: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async run(
    seed: TemplateSeed,
    thumbnail: SeedThumbnail,
  ): Promise<{ result: SyncResult; detail: string }> {
    const { prisma } = this.deps;
    const documentId = seedDocumentId(seed.slug);
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    this.assertSeedDocument(seed, doc);

    const contentHash = seedContentHash(seed.content);
    const cardHash = seedCardHash(seed);
    // The renderer echoes the content hash it was handed. A mismatch is a
    // picture of content the catalogue no longer holds, and publishing it
    // would be exactly the stale card this command exists to avoid.
    if (thumbnail.contentHash !== contentHash) {
      throw new SeedStop(
        'failed',
        'thumbnail was rendered from different content; re-run ' +
          '`template:dump` and `render:thumbnails`',
      );
    }

    let listing = await prisma.templateListing.findUnique({
      where: { documentId },
    });
    let record = await prisma.templateSeedRecord.findUnique({
      where: { documentId },
    });

    // A takedown is terminal, and the operator path never reverses
    // moderation — not even by trying and letting the service refuse.
    if (listing?.status === 'removed') {
      throw new SeedStop('skipped', 'removed by a reviewer; left alone');
    }

    let applied: 'published' | 'updated' | null = null;

    if (!listing) {
      listing = await this.publish(documentId, seed, thumbnail);
      record = await this.saveRecord(documentId, seed.slug, {
        contentHash,
        cardHash,
        thumbnailHash: thumbnail.sha256,
        appliedAt: this.now(),
        contentWrittenAt: null,
      });
      applied = 'published';
    } else {
      this.assertResubmittable(listing);

      // A missing record — a listing this command did not create, such as one
      // `register:templates` made — counts as everything changed, so the
      // command attests only to state it applied itself.
      const cardChanged = record?.cardHash !== cardHash;
      const thumbnailChanged = record?.thumbnailHash !== thumbnail.sha256;
      const contentChanged = record?.contentHash !== contentHash;

      if (cardChanged || thumbnailChanged) {
        // `assertCardEditable` refuses a card edit while a submission is under
        // review, and approving first would publish a card the catalogue no
        // longer describes. Nothing this command may do resolves it.
        if (listing.status === 'pending') {
          throw new SeedStop(
            'skipped',
            'pending review with a card this command has not applied; ' +
              'decide it at /admin/templates, then run again',
          );
        }
        // Card before content: `update()` returns an approved listing to
        // `pending` synchronously, whereas a content write does so only when
        // its event lands — after which a card edit would be refused.
        listing = await this.updateCard(listing, seed, thumbnail, {
          cardChanged,
          thumbnailChanged,
        });
        record = await this.saveRecord(documentId, seed.slug, {
          contentHash: record?.contentHash ?? '',
          cardHash,
          thumbnailHash: thumbnail.sha256,
          appliedAt: record?.appliedAt ?? this.now(),
          contentWrittenAt: record?.contentWrittenAt ?? null,
        });
        applied = 'updated';
      }

      if (contentChanged) {
        const writtenAt = this.now();
        await this.deps.writeContent(documentId, seed.content);
        record = await this.saveRecord(documentId, seed.slug, {
          contentHash,
          cardHash: record?.cardHash ?? cardHash,
          thumbnailHash: record?.thumbnailHash ?? thumbnail.sha256,
          appliedAt: record?.appliedAt ?? writtenAt,
          contentWrittenAt: writtenAt,
        });
        applied = 'updated';
      }
    }

    // ---- Approval ----------------------------------------------------------
    if (!record) {
      // Unreachable: every branch above leaves a record. Guarded so that an
      // approval can never happen for a seed this command has no state for.
      throw new SeedStop('failed', 'no seed record; nothing to attest');
    }

    if (record.contentWrittenAt) {
      listing = await this.awaitContentEvent(
        documentId,
        record.contentWrittenAt,
      );
      // What this command attests to from here on is the watermark its own
      // write produced, not the wall-clock time it wrote at.
      record = await this.saveRecord(documentId, seed.slug, {
        contentHash: record.contentHash,
        cardHash: record.cardHash,
        thumbnailHash: record.thumbnailHash,
        appliedAt: listing.contentChangedAt!,
        contentWrittenAt: null,
      });
    }

    listing = await this.readListing(documentId);
    if (listing.status === 'removed') {
      throw new SeedStop('skipped', 'removed by a reviewer during the run');
    }
    this.assertResubmittable(listing);

    // An operator does not attest to content it did not write.
    if (
      listing.contentChangedAt &&
      listing.contentChangedAt.getTime() > record.appliedAt.getTime()
    ) {
      throw new SeedStop(
        'failed',
        `edited by someone else at ${listing.contentChangedAt.toISOString()}, ` +
          'after this command last applied it; not approving',
      );
    }

    if (listing.visibility === 'public' && listing.status === 'listed') {
      return applied
        ? { result: 'updated', detail: 'applied; still public and listed' }
        : { result: 'unchanged', detail: 'public and listed' };
    }

    const { authorId } = this.options;
    if (listing.status !== 'pending') {
      // `listed` below the public tier (an interrupted first run) or
      // `rejected`. Quiet: this run decides the submission itself, and a
      // queued notification per seed would bury the reviewers' bell.
      await this.deps.templates.submit(
        listing.id,
        authorId,
        { acceptLicense: true },
        { quiet: true },
      );
    }

    // By listing id — never a title match — and echoing the watermark this
    // command just checked, which `review()` re-checks under its own CAS.
    await this.deps.templates.review(listing.id, authorId, {
      decision: 'approve',
      contentAt: listing.contentChangedAt?.toISOString(),
    });
    return {
      result: applied === 'published' ? 'published' : 'approved',
      detail: applied ? `${applied} and approved` : 'approved (resumed)',
    };
  }

  private assertSeedDocument(
    seed: TemplateSeed,
    doc: DocumentModel | null,
  ): asserts doc is DocumentModel {
    if (!doc) {
      throw new SeedStop('skipped', 'not seeded; run `seed:templates` first');
    }
    if (doc.deletedAt) {
      throw new SeedStop('failed', 'the seeded document is in the trash');
    }
    if (
      this.options.workspaceId &&
      doc.workspaceId !== this.options.workspaceId
    ) {
      throw new SeedStop(
        'failed',
        `seeded into workspace ${doc.workspaceId}, not ${this.options.workspaceId}`,
      );
    }
    if (doc.type !== seed.content.kind) {
      throw new SeedStop(
        'failed',
        `the seeded document is a ${doc.type}, the catalogue says ${seed.content.kind}`,
      );
    }
  }

  /**
   * `submit()` refuses any listing that is already `public`, so a public
   * listing a reviewer rejected — re-review after an edit, then a rejection —
   * has no service path back to the gallery. Report it rather than fail at
   * the call.
   */
  private assertResubmittable(listing: TemplateListing): void {
    if (listing.visibility === 'public' && listing.status === 'rejected') {
      throw new SeedStop(
        'skipped',
        'public and rejected; the service cannot resubmit a public listing',
      );
    }
  }

  private async publish(
    documentId: string,
    seed: TemplateSeed,
    thumbnail: SeedThumbnail,
  ): Promise<TemplateListing> {
    // The thumbnail goes in with the publish: after approval `thumbnailId`
    // would return the listing to review, and while pending it is refused.
    const thumbnailId = await this.upload(seed.slug, thumbnail);
    try {
      await this.deps.templates.publish(documentId, this.options.authorId, {
        title: seed.title,
        description: seed.description,
        category: seed.category,
        tags: seed.tags,
        thumbnailId,
        visibility: 'unlisted',
        acceptLicense: true,
      });
    } catch (err) {
      await this.discard(thumbnailId);
      throw err;
    }
    return this.readListing(documentId);
  }

  private async updateCard(
    listing: TemplateListing,
    seed: TemplateSeed,
    thumbnail: SeedThumbnail,
    changed: { cardChanged: boolean; thumbnailChanged: boolean },
  ): Promise<TemplateListing> {
    const thumbnailId = changed.thumbnailChanged
      ? await this.upload(seed.slug, thumbnail)
      : undefined;
    try {
      // `update()`, not `publish()`: it never touches `shareLinkId`, so the
      // preview link already handed out survives, and it discards the old
      // thumbnail object itself.
      await this.deps.templates.update(listing.id, this.options.authorId, {
        ...(changed.cardChanged
          ? {
              title: seed.title,
              description: seed.description,
              category: seed.category,
              tags: seed.tags,
            }
          : {}),
        ...(thumbnailId ? { thumbnailId } : {}),
      });
    } catch (err) {
      if (thumbnailId) await this.discard(thumbnailId);
      throw err;
    }
    return this.readListing(listing.documentId);
  }

  /**
   * Wait for the `DocumentRootChanged` event of this command's own write.
   *
   * The event is what moves an approved listing back to `pending`
   * (`TemplateReviewSyncService`), so approving before it lands would be
   * undone by it. Two halves: the watermark reaching the write, and — for a
   * listing that was public and listed — the status flip that follows it in
   * the same request.
   */
  private async awaitContentEvent(
    documentId: string,
    writtenAt: Date,
  ): Promise<TemplateListing & { contentChangedAt: Date }> {
    const deadline = this.now().getTime() + this.options.eventTimeoutMs;
    let last: TemplateListing | null = null;
    for (;;) {
      last = await this.deps.prisma.templateListing.findUnique({
        where: { documentId },
      });
      const observed =
        !!last?.contentChangedAt &&
        last.contentChangedAt.getTime() >= writtenAt.getTime();
      const flipped =
        !!last && !(last.visibility === 'public' && last.status === 'listed');
      if (last && observed && flipped) {
        return last as TemplateListing & { contentChangedAt: Date };
      }
      if (this.now().getTime() >= deadline) break;
      await this.sleep(this.options.pollIntervalMs);
    }
    const observed =
      !!last?.contentChangedAt &&
      last.contentChangedAt.getTime() >= writtenAt.getTime();
    throw new SeedStop(
      'failed',
      observed
        ? 'the content event landed but the listing never returned to review; ' +
          'not approving'
        : `no content event within ${Math.round(this.options.eventTimeoutMs / 1000)}s ` +
          'of writing (is the Yorkie event webhook registered?); the next run ' +
          'resumes the wait',
    );
  }

  private async readListing(documentId: string): Promise<TemplateListing> {
    const listing = await this.deps.prisma.templateListing.findUnique({
      where: { documentId },
    });
    if (!listing) {
      throw new SeedStop('failed', 'the listing disappeared during the run');
    }
    return listing;
  }

  private async saveRecord(
    documentId: string,
    slug: string,
    data: Omit<TemplateSeedRecord, 'documentId' | 'slug' | 'updatedAt'>,
  ): Promise<TemplateSeedRecord> {
    return this.deps.prisma.templateSeedRecord.upsert({
      where: { documentId },
      create: { documentId, slug, ...data },
      update: data,
    });
  }

  private async upload(
    slug: string,
    thumbnail: SeedThumbnail,
  ): Promise<string> {
    const { id } = await this.deps.images.upload(
      thumbnail.bytes,
      thumbnail.mimeType,
      `${slug}.${thumbnail.mimeType === 'image/png' ? 'png' : 'webp'}`,
    );
    return id;
  }

  private async discard(thumbnailId: string): Promise<void> {
    await this.deps.images.delete(thumbnailId).catch(() => undefined);
  }
}
