import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { NotificationService } from '../notification/notification.service';

/**
 * Keeps an approved public listing honest about the document it points at
 * (docs/design/template-gallery.md, *Keeping an approved listing honest*).
 *
 * A public listing tracks a **live** document, so without this a publisher can
 * have a budget sheet approved and then edit it into something else — under the
 * same listing, the same author, and the same accumulated use count. Nothing in
 * the review pipeline would notice, because content edits flow client → Yorkie
 * and never pass through this backend.
 *
 * Except that they do leave one trace: Yorkie's `DocumentRootChanged` event
 * webhook, which already fires on every real root edit to keep
 * `Document.updatedAt` moving. That signal is enough. An edit to an approved
 * public listing's document returns it to `pending`, which drops it out of the
 * gallery and back into the review queue until someone looks again.
 *
 * It is the cheaper half of the trade the design records: a frozen server-side
 * copy would let an approved listing keep serving while its publisher edits,
 * but needs a system workspace, a promotion transaction, and image re-hosting
 * on that path. This needs none of them and fails in the safe direction — the
 * listing leaves the gallery rather than silently misrepresenting itself.
 */
@Injectable()
export class TemplateReviewSyncService {
  private readonly logger = new Logger(TemplateReviewSyncService.name);

  /**
   * Called for every document root change, so it must be cheap in the case
   * that matters — which is "this document has no public listing", i.e. almost
   * all of them. `documentId` is unique on `TemplateListing`, so the guarded
   * update is a single index lookup that usually touches nothing.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async onDocumentChanged(documentId: string, at: Date): Promise<void> {
    // The watermark is recorded for **every** listing, whatever its state, and
    // this is the half that does not depend on anything remembering to run:
    // `isVisibleTo` compares it against `reviewedContentAt`, so a public
    // listing whose content has moved past its approval stops being visible
    // even if the status write below never happened — an unregistered event
    // webhook, a failed write, a deployment that predates this code.
    //
    // Monotonic, so a duplicate or out-of-order delivery cannot rewind it.
    await this.prisma.templateListing.updateMany({
      where: {
        documentId,
        OR: [{ contentChangedAt: null }, { contentChangedAt: { lt: at } }],
      },
      data: { contentChangedAt: at },
    });

    // Guarded on the exact state being left, not read-then-write: this runs
    // concurrently with reviewer decisions, and an unconditional update could
    // walk a takedown back to `pending`.
    //
    // Guarded on `reviewedContentAt` — the same watermark visibility compares
    // against — and **not** on `reviewedAt`. The two are different clocks:
    // `reviewedContentAt` is the content the reviewer attested to,
    // `reviewedAt` is when they clicked. An event whose instant falls between
    // them would, under a `reviewedAt` guard, set `contentChangedAt` past the
    // approval (so the listing goes invisible) while matching zero rows here
    // (so it never enters the queue and nobody is told) — hidden and
    // unreviewable at once.
    //
    // It also keeps the write idempotent under redelivery: a duplicate of an
    // old event arriving after a re-approval matches nothing, rather than
    // knocking the fresh approval back to `pending` with a `submittedAt` in
    // the past.
    const { count } = await this.prisma.templateListing.updateMany({
      where: {
        documentId,
        visibility: 'public',
        status: 'listed',
        OR: [{ reviewedContentAt: null }, { reviewedContentAt: { lt: at } }],
      },
      data: {
        status: 'pending',
        submittedAt: at,
        // The previous approval no longer describes this content.
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: null,
      },
    });
    if (count === 0) return;

    // Only on a real transition is it worth a second query to find out who to
    // tell — which is also what keeps an edit burst to one notification, since
    // the second edit finds the listing already `pending`.
    const listing = await this.prisma.templateListing.findUnique({
      where: { documentId },
      select: { id: true, createdBy: true, workspaceId: true },
    });
    if (!listing) return;

    await this.notificationService
      .createTemplateNeedsReview({
        listing: { ...listing, documentId },
        at,
      })
      .catch((err) => {
        // The listing has already left the gallery, which is the part that had
        // to happen. A failed notification must not undo it.
        this.logger.warn(`failed to notify re-review of ${listing.id}: ${err}`);
      });
  }
}
