import type {
  Document as DocumentModel,
  TemplateListing,
  TemplateSeedRecord,
} from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import type { ImageService } from '../../image/image.service';
import {
  assertPublicTierOpen,
  assertYorkieAuthEnforced,
  parseReviewerIds,
} from '../template-review';
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
  /**
   * Write `content` and return a hash of the document's root right after the
   * write — what {@link readContentHash} returns while nobody else has
   * touched the document since.
   */
  writeContent: (documentId: string, content: SeedContent) => Promise<string>;
  /** Hash the document's root as it stands now (same serializer). */
  readContentHash: (
    documentId: string,
    kind: SeedContent['kind'],
  ) => Promise<string>;
  /** Reads `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` and `YORKIE_AUTH_WEBHOOK_ENFORCE`. */
  config: { get<T = string>(key: string): T | undefined };
  /** Measures elapsed time while waiting; never compared with Yorkie's. */
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

/** The data columns of a record, for re-saving it with one field changed. */
function pickRecord(
  r: TemplateSeedRecord,
): Omit<TemplateSeedRecord, 'documentId' | 'slug' | 'updatedAt'> {
  return {
    contentHash: r.contentHash,
    writtenHash: r.writtenHash,
    cardHash: r.cardHash,
    thumbnailHash: r.thumbnailHash,
    appliedAt: r.appliedAt,
  };
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
    this.assertAuthorized();
  }

  /**
   * The gates `review(approve)` relies on its HTTP route for. The reviewer
   * allowlist is enforced by `TemplateReviewerGuard` on the route, not inside
   * `TemplateService.review()`, so any in-process caller of this class has to
   * be held to it here — not only the CLI entry that happens to construct it.
   * Checked at construction (fail before touching anything) and again before
   * every seed, since a setting can change during a long run.
   */
  private assertAuthorized(): void {
    const reviewers = parseReviewerIds(
      this.deps.config.get<string>('WAFFLEBASE_TEMPLATE_REVIEWER_IDS'),
    );
    if (!reviewers.has(this.options.authorId)) {
      throw new Error(
        `User ${this.options.authorId} is not in WAFFLEBASE_TEMPLATE_REVIEWER_IDS; ` +
          'only a reviewer may approve seeded templates.',
      );
    }
    assertPublicTierOpen();
    assertYorkieAuthEnforced(
      this.deps.config.get<string>('YORKIE_AUTH_WEBHOOK_ENFORCE'),
    );
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
    this.assertAuthorized();
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

    // A record without a listing is stale: the listing was unpublished (which
    // deletes the row and its preview link) since this command last ran.
    // Nothing it recorded still describes anything, so it is discarded and
    // the seed takes the first-publish path. Handled here rather than by
    // having `TemplateService.unpublish` know about seed records: the record
    // is this command's own bookkeeping, and the service should not grow a
    // dependency on an operator tool's table.
    if (!listing && record) record = null;

    // A takedown is terminal, and the operator path never reverses
    // moderation — not even by trying and letting the service refuse.
    if (listing?.status === 'removed') {
      throw new SeedStop('skipped', 'removed by a reviewer; left alone');
    }

    // No record, or no observed write of ours, counts as content changed: an
    // approval may only attest to content this command wrote and saw land.
    // A first publish therefore writes the catalogue content too, rather
    // than trusting whatever `seed:templates` (or anyone since) left there.
    const contentChanged =
      !record || !record.appliedAt || record.contentHash !== contentHash;
    let applied: 'published' | 'updated' | null = null;

    if (!listing) {
      listing = await this.publish(documentId, seed, thumbnail);
      record = await this.saveRecord(documentId, seed.slug, {
        contentHash: '',
        writtenHash: '',
        cardHash,
        thumbnailHash: thumbnail.sha256,
        appliedAt: null,
      });
      applied = 'published';
    } else {
      this.assertResubmittable(listing);

      // A missing record — a listing this command did not create, such as one
      // the retired Playwright command made — counts as everything changed.
      const cardChanged = record?.cardHash !== cardHash;
      const thumbnailChanged = record?.thumbnailHash !== thumbnail.sha256;

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
          writtenHash: record?.writtenHash ?? '',
          cardHash,
          thumbnailHash: thumbnail.sha256,
          appliedAt: record?.appliedAt ?? null,
        });
        applied = 'updated';
      }
    }

    if (contentChanged) {
      // After the listing exists, so this write's event is recorded on it
      // (`TemplateReviewSyncService` keeps a watermark only for a document
      // with a listing). The baseline is read just before the write and is
      // compared only with Yorkie-issued instants — never with this
      // process's clock.
      const baseline = (await this.readListing(documentId)).contentChangedAt;
      const writtenHash = await this.deps.writeContent(
        documentId,
        seed.content,
      );
      // Recorded before the wait with `appliedAt` cleared: a wait that times
      // out leaves nothing to attest, and the next run rewrites.
      record = await this.saveRecord(documentId, seed.slug, {
        contentHash,
        writtenHash,
        cardHash: record?.cardHash ?? cardHash,
        thumbnailHash: record?.thumbnailHash ?? thumbnail.sha256,
        appliedAt: null,
      });
      const observed = await this.awaitContentEvent(documentId, baseline);
      record = await this.saveRecord(documentId, seed.slug, {
        ...pickRecord(record),
        appliedAt: observed.contentChangedAt,
      });
      applied ??= 'updated';
    }

    // ---- Approval ----------------------------------------------------------
    // Only content this command wrote, and whose event it saw land, can be
    // attested. Without that there is nothing to approve.
    if (!record || !record.appliedAt || !record.writtenHash) {
      throw new SeedStop(
        'failed',
        'no observed content write to attest to; not approving',
      );
    }

    listing = await this.readListing(documentId);
    if (listing.status === 'removed') {
      throw new SeedStop('skipped', 'removed by a reviewer during the run');
    }
    this.assertResubmittable(listing);

    if (listing.visibility === 'public' && listing.status === 'listed') {
      return applied
        ? { result: 'updated', detail: 'applied; still public and listed' }
        : { result: 'unchanged', detail: 'public and listed' };
    }

    // The watermark is read *before* the content, and approval echoes it.
    // An edit landing before the read below changes the content, which is
    // refused here; one landing after it moves `contentChangedAt` past this
    // watermark, which `review()` refuses with a 409 (its `contentAt` CAS),
    // or — if its event arrives only after the approval — returns the
    // listing to `pending` and hides it (`TemplateReviewSyncService`).
    const contentAt = listing.contentChangedAt;
    if (!contentAt) {
      throw new SeedStop('failed', 'the listing has no content watermark');
    }
    // An operator does not attest to content it did not write: the document
    // must still hold exactly what this command's write left there. This,
    // not the watermark, is what tells our own event from a stranger's — the
    // first advance after the write is not necessarily ours.
    const current = await this.deps.readContentHash(
      documentId,
      seed.content.kind,
    );
    if (current !== record.writtenHash) {
      throw new SeedStop(
        'failed',
        'edited by someone else during or after the sync: the document no ' +
          'longer holds what this command wrote; not approving',
      );
    }

    const { authorId } = this.options;
    if (listing.status !== 'pending') {
      // `listed` below the public tier (a first publish, or an interrupted
      // one) or `rejected`. Quiet: this run decides the submission itself,
      // and a queued notification per seed would bury the reviewers' bell.
      await this.deps.templates.submit(
        listing.id,
        authorId,
        { acceptLicense: true },
        { quiet: true },
      );
    }

    // By listing id — never a title match — and echoing the watermark this
    // command observed, which `review()` re-checks under its own CAS.
    await this.deps.templates.review(listing.id, authorId, {
      decision: 'approve',
      contentAt: contentAt.toISOString(),
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
   * Wait for the `DocumentRootChanged` event of this command's own write: the
   * listing's `contentChangedAt` strictly advancing past `baseline`, the value
   * read just before the write. Both sides are Yorkie-issued instants, so the
   * sync host's clock never enters the comparison; this process's clock only
   * measures how long it has waited.
   *
   * The event is also what moves an approved listing back to `pending`
   * (`TemplateReviewSyncService`), so for a listing that was public and
   * listed the wait includes the status flip that follows the watermark in
   * the same request — approving before it would be undone by it.
   *
   * Fails closed: an event never observed (an unregistered event webhook)
   * leaves no watermark to attest to, so the seed is not approved.
   */
  private async awaitContentEvent(
    documentId: string,
    baseline: Date | null,
  ): Promise<TemplateListing & { contentChangedAt: Date }> {
    const advanced = (l: TemplateListing | null): boolean =>
      !!l?.contentChangedAt &&
      (baseline === null || l.contentChangedAt.getTime() > baseline.getTime());
    const deadline = this.now().getTime() + this.options.eventTimeoutMs;
    let last: TemplateListing | null = null;
    for (;;) {
      last = await this.deps.prisma.templateListing.findUnique({
        where: { documentId },
      });
      const flipped =
        !!last && !(last.visibility === 'public' && last.status === 'listed');
      if (advanced(last) && flipped) {
        return last as TemplateListing & { contentChangedAt: Date };
      }
      if (this.now().getTime() >= deadline) break;
      await this.sleep(this.options.pollIntervalMs);
    }
    throw new SeedStop(
      'failed',
      advanced(last)
        ? 'the content event landed but the listing never returned to review; ' +
          'not approving'
        : 'wrote the content but observed no DocumentRootChanged event within ' +
          `${Math.round(this.options.eventTimeoutMs / 1000)}s. Register the ` +
          'Yorkie event webhook (POST /internal/yorkie/events) on the project; ' +
          'without it nothing can be attested. Not approving; the next run ' +
          'rewrites and waits again',
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
