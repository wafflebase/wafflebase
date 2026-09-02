import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Document as DocumentModel,
  Prisma,
  TemplateListing,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/database/prisma.service';
import { isDocumentManager } from '../document/document-access';
import { DocumentCopyService } from '../document/document-copy.service';
import { ShareLinkService } from '../share-link/share-link.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { FolderService } from '../folder/folder.service';
import {
  BrowseTemplatesDto,
  PublishTemplateDto,
  ReviewTemplateDto,
  SubmitTemplateDto,
  UpdateTemplateDto,
  UseTemplateDto,
} from './template.dto';
import { normalizeTags } from './template-taxonomy';
import { findExternalDataTabs } from './template-content-guard';
import {
  assertDecisionAllowed,
  assertPublicTierOpen,
  assertYorkieAuthEnforced,
} from './template-review';
import { YorkieService } from '../yorkie/yorkie.service';
import { ImageService } from '../image/image.service';
import { NotificationService } from '../notification/notification.service';

/**
 * How many pending submissions the queue page shows at once. A ceiling rather
 * than paging: the allowlist keeps the reviewer pool small by construction, so
 * a queue deeper than this is an operational signal, not a page to turn.
 */
const REVIEW_QUEUE_LIMIT = 100;

/**
 * The listing fields a gallery visitor actually sees on a card. Changing one
 * of these on an approved public listing is a change to what was approved, so
 * it re-enters review; `tags` and `visibility` are excluded because they steer
 * discovery rather than represent the template.
 */
const CARD_FIELDS = [
  'title',
  'description',
  'category',
  'thumbnailId',
] as const;

/** Treats `null` and `undefined` as the same absence, which Prisma does not. */
function isSame(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * What a caller is told about a listing. Deliberately not the raw row:
 * `workspaceId` and `createdBy` are internal, and `previewToken` is a
 * capability that only a permitted viewer may receive.
 */
export interface TemplateListingView {
  id: string;
  documentId: string;
  documentType: string;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  thumbnailId: string | null;
  visibility: string;
  status: string;
  useCount: number;
  publishedAt: string | null;
  author: { id: number; username: string; photo: string | null } | null;
  /**
   * The `viewer` share-link token backing the read-only preview, or `null` if
   * that link was revoked — in which case the landing page shows the card
   * without a live preview rather than failing.
   */
  previewToken: string | null;
  /** Whether the caller may edit or unpublish this listing. */
  canManage: boolean;
  /**
   * The review decision, and only for a manager.
   *
   * A rejected or removed listing is one its publisher can no longer edit,
   * republish or unpublish, so "why" has to be reachable somewhere they can
   * see it. The notification carries the same note, but it is best-effort and
   * is suppressed entirely when the reviewer *is* the publisher — the listing
   * itself is the durable copy.
   *
   * Withheld from everyone else: a reviewer's note is written for the
   * publisher, not for the gallery.
   */
  review: {
    submittedAt: string | null;
    reviewedAt: string | null;
    note: string | null;
    /**
     * The content watermark as of this response. A reviewer echoes it back
     * with an approval, which is what makes the approval about the version
     * they actually read rather than about whatever the row holds by then.
     */
    contentAt: string | null;
  } | null;
}

/**
 * A gallery card. `TemplateListingView` minus `previewToken` — deliberately a
 * separate type rather than an optional field, so a collection response cannot
 * grow one back by accident.
 */
export type TemplateCardView = Omit<TemplateListingView, 'previewToken'>;

export interface TemplateBrowsePage {
  items: TemplateCardView[];
  /** Pass back as `cursor`; `null` on the last page. */
  nextCursor: string | null;
}

type ListingWithRelations = TemplateListing & {
  document: DocumentModel;
  shareLink: { token: string } | null;
  creator: { id: number; username: string; photo: string | null } | null;
};

/**
 * The template gallery — publishing a document as a template and starting a
 * new document from one (docs/design/template-gallery.md).
 *
 * Two rules run through everything here:
 *
 * - **Publishing is manager-gated at every tier.** It hands the document's
 *   content to an audience workspace membership no longer bounds, which is the
 *   same escalation an editor share link is, so it takes the same bar.
 * - **Using inverts authorization.** Read authority comes from the listing's
 *   visibility; write authority comes from membership of the *destination*
 *   workspace. This is the only path where a document crosses a workspace
 *   boundary.
 */
@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentCopyService: DocumentCopyService,
    private readonly shareLinkService: ShareLinkService,
    private readonly workspaceService: WorkspaceService,
    private readonly folderService: FolderService,
    private readonly yorkieService: YorkieService,
    private readonly imageService: ImageService,
    private readonly notificationService: NotificationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resolve the caller's authority over a document's listing, throwing unless
   * they are its manager (workspace owner or document author). Mirrors
   * `ShareLinkService.resolveCapability`: it queries `workspaceMember`
   * directly so the author-who-is-no-longer-a-member case still resolves.
   */
  private async assertManager(
    documentId: string,
    userId: number,
  ): Promise<DocumentModel> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: doc.workspaceId, userId } },
    });
    if (!isDocumentManager(membership?.role, doc.authorID, userId)) {
      throw new ForbiddenException(
        'Only the workspace owner or document owner can publish this document as a template',
      );
    }
    return doc;
  }

  /**
   * Refuse to publish a document holding a `datasource` / `lakehouse` tab.
   * Those tabs reference a workspace-scoped connection row, so a copy made in
   * someone else's workspace opens with a dead tab
   * (`template-content-guard.ts`).
   *
   * Only `sheet` documents can hold one, and only they are read — the check
   * costs a Yorkie attach, so no other type pays for it. Run from both
   * `publish()` and `use()`: the listing tracks a live document, so passing
   * once is not a property the content keeps.
   *
   * **Fails closed.** A document we could not read is not a document we can
   * clear, and publishing is a deliberate one-off action a person can repeat;
   * silently skipping the check on a transient error would make the guard
   * something an unlucky moment removes.
   */
  private async assertContentIsShareable(doc: DocumentModel): Promise<void> {
    if (doc.type !== 'sheet') return;

    let externalTabs: string[];
    try {
      externalTabs = await this.yorkieService.withDocument(
        doc.id,
        (yorkieDoc) => {
          const root = yorkieDoc.getRoot();
          return findExternalDataTabs(root.tabs, root.tabOrder);
        },
        { syncMode: 'readonly' },
      );
    } catch (err) {
      this.logger.warn(`failed to read ${doc.id} before publishing: ${err}`);
      throw new ServiceUnavailableException(
        'Could not read the document to check it for external data tabs. Try again.',
      );
    }

    if (externalTabs.length === 0) return;
    throw new BadRequestException(
      `This document cannot be published as a template because it connects to ` +
        `external data (${externalTabs.join(', ')}). A connection belongs to ` +
        `this workspace, so the tab would be empty for anyone who used the ` +
        `template.`,
    );
  }

  async publish(
    documentId: string,
    userId: number,
    dto: PublishTemplateDto,
  ): Promise<TemplateListingView> {
    const doc = await this.assertManager(documentId, userId);
    await this.assertContentIsShareable(doc);

    const existing = await this.prisma.templateListing.findUnique({
      where: { documentId },
    });

    // Every field falls back to the *existing* listing before its first-publish
    // default. `publish` is an upsert on a re-publishable route, so a partial
    // body — `{ thumbnailId }` to attach a thumbnail, say — must not blank the
    // fields it does not mention. Getting this wrong is not merely data loss:
    // `visibility` defaulting to `unlisted` would silently widen a
    // workspace-scoped listing to anyone holding its id.
    const visibility = dto.visibility ?? existing?.visibility ?? 'unlisted';
    assertPublishable(visibility, existing?.visibility);

    // A taken-down listing is not re-publishable. Everything below would
    // otherwise undo the takedown: `status` would return to `listed` and the
    // revoked preview link would be re-minted, handing the publisher a
    // one-call reversal of a moderation decision.
    if (existing?.status === 'removed') {
      throw new BadRequestException(
        'This template was removed by a reviewer and cannot be republished',
      );
    }

    // Minted through `ShareLinkService` rather than Prisma directly so link
    // creation keeps a single source of truth. A republish reuses the live
    // link; one revoked from the Share dialog is replaced here.
    const shareLinkId =
      existing?.shareLinkId ??
      (await this.shareLinkService.create(documentId, 'viewer', userId, null))
        .id;

    const data = {
      title: dto.title ?? existing?.title ?? doc.title,
      description: dto.description ?? existing?.description ?? null,
      category: dto.category ?? existing?.category ?? null,
      tags: dto.tags ? normalizeTags(dto.tags) : (existing?.tags ?? []),
      thumbnailId: dto.thumbnailId ?? existing?.thumbnailId ?? null,
      visibility,
      // Preserved, never reset. `publish` is an upsert on a re-publishable
      // route, and a listing under review or already decided has a review
      // state that is not the publisher's to clear: writing `'listed'` here
      // unconditionally let one republish reverse a reviewer's decision. Only
      // a first publish gets the default, which the `create` branch supplies.
      ...(existing ? { status: existing.status } : { status: 'listed' }),
      licensedAt: dto.acceptLicense
        ? new Date()
        : (existing?.licensedAt ?? null),
      publishedAt: existing?.publishedAt ?? new Date(),
      shareLinkId,
    };

    const listing = await this.prisma.templateListing.upsert({
      where: { documentId },
      create: {
        documentId,
        workspaceId: doc.workspaceId,
        createdBy: userId,
        ...data,
      },
      update: data,
      include: LISTING_INCLUDE,
    });
    return toView(listing, true);
  }

  async update(
    id: string,
    userId: number,
    dto: UpdateTemplateDto,
  ): Promise<TemplateListingView> {
    const listing = await this.prisma.templateListing.findUnique({
      where: { id },
    });
    if (!listing) throw new NotFoundException('Template not found');
    await this.assertManager(listing.documentId, userId);

    const visibility = dto.visibility ?? listing.visibility;
    assertPublishable(visibility, listing.visibility);
    if (listing.status === 'removed') {
      throw new BadRequestException(
        'This template was removed by a reviewer and cannot be edited',
      );
    }

    // The gallery card *is* the title, description and thumbnail, so editing
    // them on an approved public listing is the same bait-and-switch as editing
    // the document — and it needs no Yorkie edit at all, so the webhook path
    // would never see it. A metadata change therefore re-enters review too.
    const reenters =
      listing.visibility === 'public' &&
      listing.status === 'listed' &&
      CARD_FIELDS.some(
        (field) =>
          dto[field] !== undefined && !isSame(dto[field], listing[field]),
      );

    const updated = await this.prisma.templateListing.update({
      where: { id },
      data: {
        ...(reenters
          ? {
              status: 'pending',
              submittedAt: new Date(),
              reviewedAt: null,
              reviewedBy: null,
              reviewNote: null,
              reviewedContentAt: null,
            }
          : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.tags !== undefined ? { tags: normalizeTags(dto.tags) } : {}),
        ...(dto.thumbnailId !== undefined
          ? { thumbnailId: dto.thumbnailId }
          : {}),
        ...(dto.visibility !== undefined ? { visibility } : {}),
        ...(dto.acceptLicense ? { licensedAt: new Date() } : {}),
      },
      include: LISTING_INCLUDE,
    });
    // A refreshed thumbnail replaces the old object rather than orphaning it —
    // "Update preview" is a repeatable action, so without this every press
    // leaks one publicly readable snapshot forever.
    if (updated.thumbnailId !== listing.thumbnailId) {
      await this.discardThumbnail(listing.thumbnailId);
    }
    return toView(updated, true);
  }

  /**
   * Deployment-level preconditions for anything public, checked at both ends
   * of the review pipeline rather than once at submission — they are settings,
   * and a setting can change between a submission and its decision.
   */
  private assertPublicTierPreconditions(): void {
    assertYorkieAuthEnforced(
      this.config.get<string>('YORKIE_AUTH_WEBHOOK_ENFORCE'),
    );
  }

  /**
   * Ask for the public tier.
   *
   * The one thing this does **not** do is change what anyone can see. It moves
   * `status` to `pending` and leaves `visibility` exactly where it was, so an
   * unlisted link already handed out keeps resolving and a workspace listing
   * stays workspace-scoped while a reviewer looks at it. Approval is the only
   * writer of `visibility: 'public'`.
   *
   * Manager-gated like publishing, and for the same reason: it offers the
   * document to an audience membership no longer bounds.
   */
  async submit(
    id: string,
    userId: number,
    dto: SubmitTemplateDto,
  ): Promise<TemplateListingView> {
    assertPublicTierOpen();
    this.assertPublicTierPreconditions();

    const listing = await this.prisma.templateListing.findUnique({
      where: { id },
    });
    if (!listing) throw new NotFoundException('Template not found');
    await this.assertManager(listing.documentId, userId);

    if (!dto.acceptLicense) {
      throw new BadRequestException(
        'Submitting to the public gallery requires granting others permission to copy and modify this template',
      );
    }
    if (listing.status === 'pending') {
      throw new BadRequestException('This template is already under review');
    }
    if (listing.status === 'removed') {
      throw new BadRequestException(
        'This template was removed by a reviewer and cannot be resubmitted',
      );
    }
    // Re-review of a listing that is *already* public is refused here, and the
    // reason is no longer "it would take the listing offline" — an edit does
    // exactly that automatically now (see `TemplateReviewSyncService`). It is
    // that a *manual* re-request is meaningless while the automatic signal
    // exists: nothing has changed, so there is nothing new to judge. A
    // publisher who wants their revision reviewed makes the revision, which
    // returns the listing to the queue on its own.
    if (listing.visibility === 'public') {
      throw new BadRequestException(
        'This template is already public. Re-reviewing a published template is not supported yet',
      );
    }

    // Conditional on the status this submission was validated against, for the
    // same reason `review()` is: without it a submit racing a reviewer's
    // takedown moves a decided listing back to `pending`, quietly undoing the
    // decision. The publisher is told to look again rather than silently
    // winning the race.
    const changed = await this.prisma.templateListing.updateMany({
      where: { id, status: listing.status },
      data: {
        status: 'pending',
        submittedAt: new Date(),
        licensedAt: listing.licensedAt ?? new Date(),
        // The previous decision is cleared, not kept: a resubmission is a new
        // question, and leaving a stale rejection note attached would show the
        // publisher a reason that no longer refers to anything.
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: null,
      },
    });
    if (changed.count === 0) {
      throw new ConflictException(
        'This template changed while you were submitting it. Reload and try again',
      );
    }

    const updated = await this.prisma.templateListing.findUniqueOrThrow({
      where: { id },
      include: LISTING_INCLUDE,
    });
    return toView(updated, true);
  }

  /**
   * Decide a submission, or take a listing down.
   *
   * Authorization is the reviewer allowlist, checked by `TemplateReviewerGuard`
   * on the route — this method is reached only by someone on it, and takes the
   * reviewer's id so the decision is attributable.
   *
   * `approve` re-checks {@link assertPublicTierOpen} rather than trusting that
   * `submit` did: the two are separate requests, and a listing could have been
   * submitted while the tier was open and decided after it closed.
   */
  async review(
    id: string,
    reviewerId: number,
    dto: ReviewTemplateDto,
  ): Promise<TemplateListingView> {
    const listing = await this.prisma.templateListing.findUnique({
      where: { id },
      include: LISTING_INCLUDE,
    });
    if (!listing) throw new NotFoundException('Template not found');
    assertDecisionAllowed(listing.status, dto.decision);
    if (dto.decision === 'approve') {
      assertPublicTierOpen();
      this.assertPublicTierPreconditions();
      // The reviewer echoes the content watermark their queue row carried, and
      // it must still be current. Without it the review *window* is the whole
      // attack: submit clean content, let a reviewer read it, edit the document
      // into something else, and the approve that lands afterwards publishes
      // what nobody looked at. Returning to `pending` on edit does not cover
      // this — the listing is already `pending`, so there is no transition to
      // make.
      //
      // An ETag, not a timestamp comparison: the reviewer is attesting to a
      // specific version, so "unchanged since I looked" is the only question
      // worth asking, and a `null` watermark is as much a version as a date.
      const seen = dto.contentAt ? new Date(dto.contentAt).getTime() : null;
      const actual = listing.contentChangedAt?.getTime() ?? null;
      if (seen !== actual) {
        throw new ConflictException(
          'This template changed while you were reviewing it. Reload the queue and look again',
        );
      }
    }

    const decidedAt = new Date();
    const decided = {
      reviewedAt: decidedAt,
      reviewedBy: reviewerId,
      reviewNote: dto.note ?? null,
    };

    const data =
      dto.decision === 'approve'
        ? {
            ...decided,
            status: 'listed',
            visibility: 'public',
            // What the reviewer attested to. `isVisibleTo` compares the live
            // watermark against this, so an edit after approval hides the
            // listing even if the webhook never fires.
            reviewedContentAt: listing.contentChangedAt,
          }
        : dto.decision === 'reject'
          ? // `visibility` untouched: a rejection is a verdict on the gallery
            // submission, not on the publisher's own sharing, so the listing
            // keeps working at the tier it already had.
            { ...decided, status: 'rejected' }
          : { ...decided, status: 'removed', visibility: 'unlisted' };

    // One transaction, and the write is conditional on the status the decision
    // was validated against.
    //
    // Both halves matter. Without the condition, two reviewers deciding at once
    // both pass `assertDecisionAllowed` and the later write simply wins — a
    // takedown followed by a concurrent approve leaves `status: 'listed',
    // visibility: 'public'` on a listing whose preview link was already
    // deleted: a public listing nobody approved. Without the transaction, the
    // link revoke and the row update can land apart, and neither order is safe
    // (revoke-first leaves a listing that looks live with no preview; row-first
    // leaves a row reading "removed" while the content stays anonymously
    // readable). Together they are all-or-nothing, so the ordering question
    // stops existing.
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.templateListing.updateMany({
        where: { id, status: listing.status },
        data,
      });
      if (changed.count === 0) {
        throw new ConflictException(
          'This template was decided by someone else while you were reviewing it',
        );
      }
      if (dto.decision === 'takedown' && listing.shareLinkId) {
        // `deleteMany`, not `delete`: a manager revoking the preview link from
        // the Share dialog in the meantime must not turn a takedown into a
        // `P2025`. The link being gone already is the outcome we wanted.
        await tx.shareLink.deleteMany({ where: { id: listing.shareLinkId } });
      }
      return tx.templateListing.findUniqueOrThrow({
        where: { id },
        include: LISTING_INCLUDE,
      });
    });

    // Best-effort, like `useCount`: the decision is recorded and the publisher
    // can see it on their own listing, so a notification failure must not undo
    // a takedown or strand a reviewer mid-queue.
    await this.notificationService
      .createTemplateReviewed({
        listing: updated,
        reviewerId,
        decision: dto.decision,
        note: dto.note,
        decidedAt,
      })
      .catch((err) => {
        this.logger.warn(`failed to notify review of ${id}: ${err}`);
      });

    return toView(updated, false, true);
  }

  /**
   * The reviewer queue: submissions awaiting a decision, **oldest first** —
   * it is a queue, so the longest wait is the next decision.
   *
   * Unlike every other collection here this **does** carry `previewToken`, and
   * that is deliberate rather than an oversight of the rule that keeps it out
   * of `browse()`. A reviewer is neither a member of the publisher's workspace
   * nor a manager of the document, so `findForViewer` would answer `404` for
   * exactly the listings they are meant to look at — and reviewing content
   * means being able to see it. The capability is bounded to submissions,
   * which their publisher volunteered for review, and to the allowlist the
   * route's guard enforces.
   */
  async listForReview(): Promise<TemplateListingView[]> {
    const rows = await this.prisma.templateListing.findMany({
      where: { status: 'pending' },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: REVIEW_QUEUE_LIMIT,
      include: LISTING_INCLUDE,
    });
    return rows.map((listing) => toView(listing, false, true));
  }

  /**
   * Unpublish: the listing goes, the document stays. The preview share link is
   * revoked with it — leaving it behind would keep the document anonymously
   * readable after the publisher believed they had withdrawn it.
   *
   * Order matters, and it is the opposite of the intuitive one. The share link
   * is revoked **first** and its failure is allowed to throw: the link is
   * non-expiring and nothing sweeps it, so a listing deleted before a failed
   * revoke would leave a permanent anonymous read capability with nothing left
   * in the UI to surface or revoke it. Failing first instead destroys nothing —
   * the listing still points at the live link, the caller is told the unpublish
   * failed, and a retry works. This is why the counter in `use()` may be
   * best-effort and this may not.
   */
  async unpublish(id: string, userId: number): Promise<{ deleted: true }> {
    const listing = await this.prisma.templateListing.findUnique({
      where: { id },
    });
    if (!listing) throw new NotFoundException('Template not found');
    await this.assertManager(listing.documentId, userId);

    // A taken-down listing is not the publisher's to delete, and the reason is
    // not tidiness. `publish` refuses to republish a `removed` row — but it
    // reads that status off the *existing* row, so deleting it first makes the
    // next publish a `create`, which mints a fresh non-expiring anonymous
    // preview link to the very content a reviewer removed. Unpublish → publish
    // would otherwise reverse a takedown with two buttons that already ship.
    // The row stays as the tombstone the state machine needs; it is already
    // invisible to everyone but its manager, so keeping it costs nothing.
    if (listing.status === 'removed') {
      throw new BadRequestException(
        'This template was removed by a reviewer and cannot be unpublished',
      );
    }

    if (listing.shareLinkId) {
      await this.prisma.shareLink.delete({
        where: { id: listing.shareLinkId },
      });
    }
    await this.prisma.templateListing.delete({ where: { id } });
    // Only once the listing is gone: a thumbnail deleted before a failed row
    // delete would leave a live card pointing at nothing.
    await this.discardThumbnail(listing.thumbnailId);
    return { deleted: true };
  }

  /**
   * Delete a thumbnail object, best-effort.
   *
   * Deliberately best-effort, unlike the share-link revoke above, and the
   * difference is what each one grants. The link is a live capability on the
   * *document* — it keeps working, so failing to revoke it must fail the whole
   * unpublish. A thumbnail is a stale picture at an unguessable id: leaving
   * one behind costs storage and a snapshot the publisher meant to withdraw,
   * neither of which is worth stranding a listing the caller asked to delete.
   */
  private async discardThumbnail(thumbnailId: string | null): Promise<void> {
    if (!thumbnailId) return;
    await this.imageService.delete(thumbnailId).catch((err) => {
      this.logger.warn(`failed to delete thumbnail ${thumbnailId}: ${err}`);
    });
  }

  /**
   * Read a listing as `userId` (undefined = anonymous).
   *
   * A tier the caller may not see answers `404`, not `403`: whether a given
   * workspace has published a template is itself workspace information.
   */
  async findForViewer(
    id: string,
    userId?: number,
  ): Promise<TemplateListingView> {
    const listing = await this.prisma.templateListing.findUnique({
      where: { id },
      include: LISTING_INCLUDE,
    });
    if (!listing) throw new NotFoundException('Template not found');

    const canManage = userId ? await this.isManagerOf(listing, userId) : false;
    if (!canManage && !(await this.isVisibleTo(listing, userId))) {
      throw new NotFoundException('Template not found');
    }
    return toView(listing, canManage);
  }

  /**
   * Start a new document from a template.
   *
   * Read authority is the listing's visibility; write authority is membership
   * of the destination workspace. The copy is authored by the caller, so the
   * audit trail names whoever used the template, not the publisher.
   */
  async use(
    id: string,
    userId: number,
    dto: UseTemplateDto,
  ): Promise<DocumentModel> {
    const listing = await this.prisma.templateListing.findUnique({
      where: { id },
      include: LISTING_INCLUDE,
    });
    if (!listing) throw new NotFoundException('Template not found');
    // A takedown refuses everyone, including the publisher — unlike a *read*,
    // which a manager keeps so they can see the decision and its reason. The
    // listing is what was removed, and using it is the one action that spreads
    // the content further. The publisher's own document is untouched and still
    // copyable through `POST /documents/:id/copy`.
    if (listing.status === 'removed') {
      throw new NotFoundException('Template not found');
    }
    if (
      !(await this.isVisibleTo(listing, userId)) &&
      !(await this.isManagerOf(listing, userId))
    ) {
      throw new NotFoundException('Template not found');
    }

    // `assertMember` resolves a slug, so its `workspaceId` — not the body's —
    // is the canonical destination.
    const member = await this.workspaceService.assertMember(
      dto.workspaceId,
      userId,
    );
    if (dto.folderId) {
      await this.folderService.assertSameWorkspace(
        dto.folderId,
        member.workspaceId,
      );
    }

    // Checked again here, not only at publish. A listing tracks a **live**
    // document, so a sheet published clean and given a `datasource` tab
    // afterwards would otherwise copy an inert tab into this caller's
    // workspace on every use — and the copy below reads the root as it stands
    // now, not as it stood when the listing was created. Deliberately after
    // the destination checks, so an unauthorized caller costs no Yorkie read.
    await this.assertContentIsShareable(listing.document);

    const created = await this.documentCopyService.copy(
      listing.document,
      userId,
      {
        workspaceId: member.workspaceId,
        folderId: dto.folderId ?? null,
        title: listing.title,
      },
    );

    // A counter, not a ledger (docs/design/template-gallery.md): the document
    // the caller asked for exists, so a failed increment must not fail the
    // request.
    await this.prisma.templateListing
      .update({ where: { id }, data: { useCount: { increment: 1 } } })
      .catch((err) => {
        this.logger.warn(`failed to increment useCount for ${id}: ${err}`);
      });

    return created;
  }

  /**
   * Browse listings the caller is allowed to see — the collection every
   * gallery surface reads (docs/design/template-gallery.md).
   *
   * Three properties are load-bearing and are all enforced here rather than in
   * any caller:
   *
   * - **Visibility is a query constraint, never a post-filter.** The `where`
   *   is built from what the caller may see, so a row they may not see is
   *   never fetched, let alone filtered out afterwards.
   * - **`unlisted` listings appear in no collection.** Holding the id is that
   *   tier's whole access story; listing them would hand it out wholesale.
   *   There is no scope value that selects them.
   * - **No `previewToken` in the response.** A page of cards would otherwise
   *   hand out a page of non-expiring read capabilities to render thumbnails.
   *   The token comes from `findForViewer` when a card is actually opened.
   */
  async browse(
    dto: BrowseTemplatesDto,
    userId?: number,
  ): Promise<TemplateBrowsePage> {
    const limit = dto.limit ?? 24;
    const where: Prisma.TemplateListingWhereInput = {};
    // Filters that constrain the *document* share one relation clause; Prisma
    // would otherwise let a later assignment overwrite an earlier one.
    const documentWhere: Prisma.DocumentWhereInput = {};

    let membershipRole: string | undefined;
    if (dto.scope === 'workspace') {
      if (!dto.workspaceId) {
        throw new BadRequestException(
          'workspaceId is required when scope is "workspace"',
        );
      }
      if (!userId) throw new ForbiddenException('Authentication required');
      const member = await this.workspaceService.assertMember(
        dto.workspaceId,
        userId,
      );
      membershipRole = member.role;
      where.visibility = 'workspace';
      // Everything except a takedown. The status column is a *review* state,
      // and review only ever decides the public tier — so filtering a
      // workspace gallery on `status: 'listed'` would make a listing vanish
      // from its own workspace's tab the moment its owner submitted it for
      // public review, and stay gone after a rejection. Submitting is
      // deliberately observable to nobody; this is where that property is
      // kept for the workspace tier.
      where.status = { not: 'removed' };
      // The *document's* current workspace, not the listing's denormalized
      // copy — the same rule `isVisibleTo` follows, so a moved document leaves
      // its old workspace's gallery.
      documentWhere.workspaceId = member.workspaceId;
    } else {
      where.visibility = 'public';
      // The public gallery is the one place `listed` is the whole story: a
      // pending or rejected listing is not public, and a removed one is not
      // anything.
      where.status = 'listed';
    }

    if (dto.type) documentWhere.type = dto.type;
    if (Object.keys(documentWhere).length > 0) where.document = documentWhere;
    if (dto.category) where.category = dto.category;
    // Never emit `has: undefined` — Prisma drops an undefined filter, which
    // turns "show me this tag" into "show me everything". The DTO already
    // refuses a value that normalizes to nothing; this is the second gate, so
    // a future caller that bypasses validation cannot widen the query either.
    const tag = dto.tag ? normalizeTags([dto.tag])[0] : undefined;
    if (tag) where.tags = { has: tag };
    if (dto.q) {
      where.OR = [
        { title: { contains: dto.q, mode: 'insensitive' } },
        { description: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    // `id` is the tiebreak on every sort, which is what makes the cursor
    // deterministic: Prisma's cursor needs a unique field, and a page boundary
    // inside a run of equal `useCount` would otherwise be ambiguous.
    const orderBy: Prisma.TemplateListingOrderByWithRelationInput[] =
      dto.sort === 'recent'
        ? [{ publishedAt: 'desc' }, { id: 'desc' }]
        : [{ useCount: 'desc' }, { id: 'desc' }];

    const rows = await this.prisma.templateListing.findMany({
      where,
      orderBy,
      // One past the page, so `nextCursor` is null on the last page rather
      // than pointing at an empty one.
      take: limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      include: LISTING_INCLUDE,
    });

    const page = rows.slice(0, limit);
    return {
      items: page.map((listing) =>
        toCard(
          listing,
          isDocumentManager(
            membershipRole,
            listing.document.authorID,
            userId ?? -1,
          ),
        ),
      ),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /**
   * The listing attached to a document, for the Share dialog's Template
   * section.
   *
   * Gated on **workspace membership**, not on the listing's own visibility.
   * An unlisted listing is readable by anyone holding its id, but that is a
   * capability the publisher hands out deliberately; reaching the same
   * `previewToken` by document id instead would let anyone who knows the
   * document — an expiring viewer share link, say — trade up to the listing's
   * non-expiring one.
   */
  async findByDocument(
    documentId: string,
    userId: number,
  ): Promise<TemplateListingView | null> {
    const listing = await this.prisma.templateListing.findUnique({
      where: { documentId },
      include: LISTING_INCLUDE,
    });
    if (!listing) return null;

    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: listing.document.workspaceId,
          userId,
        },
      },
    });
    const canManage = isDocumentManager(
      membership?.role,
      listing.document.authorID,
      userId,
    );
    if (!membership && !canManage) return null;
    // A takedown refuses every non-manager read, and this is a read. Membership
    // is the gate here rather than visibility, so without this a plain member
    // of the workspace would still get the removed listing's metadata back
    // through the Share dialog's own lookup.
    if (listing.status === 'removed' && !canManage) return null;
    return toView(listing, canManage);
  }

  private async isVisibleTo(
    listing: TemplateListing & { document: DocumentModel },
    userId?: number,
  ): Promise<boolean> {
    // Before the visibility switch, not inside it. A takedown writes
    // `status: 'removed'` *and* `visibility: 'unlisted'`, and the unlisted arm
    // below returns true unconditionally — so a check placed per-tier would
    // never run for the one tier a taken-down listing is guaranteed to be in.
    if (listing.status === 'removed') return false;
    if (listing.visibility === 'public') {
      return listing.status === 'listed' && contentMatchesApproval(listing);
    }
    // The listing id is a v4 UUID, so it carries the same 122 bits an unlisted
    // share token does: holding it *is* the capability.
    if (listing.visibility === 'unlisted') return true;
    if (!userId) return false;
    // The *document's* current workspace, not the listing's denormalized copy:
    // read authority follows the document. Moving a document to another
    // workspace must not leave its old workspace reading it through a listing.
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: listing.document.workspaceId,
          userId,
        },
      },
    });
    return membership !== null;
  }

  private async isManagerOf(
    listing: TemplateListing & { document: DocumentModel },
    userId: number,
  ): Promise<boolean> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: listing.document.workspaceId,
          userId,
        },
      },
    });
    return isDocumentManager(
      membership?.role,
      listing.document.authorID,
      userId,
    );
  }
}

const LISTING_INCLUDE = {
  document: true,
  shareLink: { select: { token: true } },
  creator: { select: { id: true, username: true, photo: true } },
} as const;

/**
 * Refuse a *transition into* the `public` tier from the publish/update routes.
 *
 * The distinction from "refuse the presence of `public`" is load-bearing, and
 * getting it wrong is not theoretical: both `publish()` and `update()` fall
 * back to the stored visibility when the body omits one, so a check on the
 * value alone would make an approved listing permanently unpublishable *and*
 * unrenamable — while this feature's whole design says a publisher keeps
 * editing their document and republishing re-enters review.
 *
 * `visibility: 'public'` has exactly one writer: the approve arm of
 * `review()`. A publisher asks for it through `submit()`, which moves `status`
 * and leaves the tier alone.
 *
 * `acceptLicense` is accepted and recorded (`licensedAt`) on these routes so a
 * publisher who granted it does not have to re-grant it at submission; it is
 * not sufficient on its own.
 */
function assertPublishable(visibility: string, current?: string): void {
  if (visibility !== 'public') return;
  if (current === 'public') return;
  throw new BadRequestException(
    'A template becomes public through review, not by publishing it as public',
  );
}

/**
 * Has this listing's content stayed where its reviewer left it?
 *
 * The second half of the bait-and-switch defence, and the half that does not
 * depend on a webhook having fired. `TemplateReviewSyncService` moves an edited
 * public listing to `pending`, which is what removes it from the *collection*
 * query — but a status is only as good as the write that set it, and the event
 * webhook is per-project configuration that a deployment can simply not have
 * registered. This is a read-time re-check on the two paths where content
 * actually reaches somebody, so those fail closed rather than trusting a status
 * nobody may have written.
 *
 * A listing approved before these columns existed has neither, and is treated
 * as matching: the alternative is retroactively hiding every existing approval
 * on a deployment that upgrades.
 */
function contentMatchesApproval(listing: TemplateListing): boolean {
  if (!listing.contentChangedAt) return true;
  if (!listing.reviewedContentAt) return false;
  return listing.contentChangedAt <= listing.reviewedContentAt;
}

function toView(
  listing: ListingWithRelations,
  canManage: boolean,
  /**
   * Whether to include the review block. Defaults to `canManage` — the
   * publisher — and is passed explicitly by the reviewer queue, which needs
   * `submittedAt` to work a queue and is emphatically *not* a manager.
   */
  includeReview: boolean = canManage,
): TemplateListingView {
  return {
    id: listing.id,
    documentId: listing.documentId,
    documentType: listing.document.type,
    title: listing.title,
    description: listing.description,
    category: listing.category,
    tags: listing.tags,
    thumbnailId: listing.thumbnailId,
    visibility: listing.visibility,
    status: listing.status,
    useCount: listing.useCount,
    publishedAt: listing.publishedAt?.toISOString() ?? null,
    author: listing.creator,
    previewToken: listing.shareLink?.token ?? null,
    canManage,
    review: includeReview
      ? {
          submittedAt: listing.submittedAt?.toISOString() ?? null,
          reviewedAt: listing.reviewedAt?.toISOString() ?? null,
          note: listing.reviewNote,
          contentAt: listing.contentChangedAt?.toISOString() ?? null,
        }
      : null,
  };
}

/**
 * A card for the collection response. Built by *destructuring away*
 * `previewToken` rather than by assembling a fresh literal, so a field added
 * to `toView` later cannot silently start appearing on cards — and the one
 * field that must never appear there is removed in a place a reviewer can see.
 */
function toCard(
  listing: ListingWithRelations,
  canManage: boolean,
): TemplateCardView {
  const { previewToken, ...card } = toView(listing, canManage);
  void previewToken;
  return card;
}
