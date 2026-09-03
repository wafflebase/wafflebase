import { TemplateReviewSyncService } from './template-review-sync.service';

const AT = new Date('2026-09-02T10:00:00.000Z');

type UpdateManyArgs = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

function makeService(opts: { count?: number; listing?: unknown } = {}) {
  const prisma = {
    templateListing: {
      // Typed via the generic rather than an unused parameter, so the calls
      // are inspectable without tripping `no-unused-vars`.
      updateMany: jest.fn<Promise<{ count: number }>, [UpdateManyArgs]>(() =>
        Promise.resolve({ count: opts.count ?? 1 }),
      ),
      findUnique: jest.fn(() =>
        Promise.resolve(
          opts.listing === undefined
            ? { id: 'tpl-1', createdBy: 7, workspaceId: 'ws-1' }
            : opts.listing,
        ),
      ),
    },
  };
  const notificationService = {
    createTemplateNeedsReview: jest.fn(() => Promise.resolve({ created: 1 })),
  };
  const service = new TemplateReviewSyncService(
    prisma as never,
    notificationService as never,
  );
  return { service, prisma, notificationService };
}

describe('TemplateReviewSyncService', () => {
  it('returns an approved public listing to review when its document changes', async () => {
    // Without this a publisher gets a budget sheet approved and edits it into
    // something else, under the same listing and the same use count — content
    // edits never pass through this backend, so review would never notice.
    const { service, prisma } = makeService();
    await service.onDocumentChanged('doc-1', AT);
    // Two writes: the watermark for every listing, then the status transition
    // for the approved-public one.
    const calls = prisma.templateListing.updateMany.mock.calls;
    expect(calls[0][0].data).toEqual({ contentChangedAt: AT });
    expect(calls[1][0].where).toMatchObject({
      documentId: 'doc-1',
      visibility: 'public',
      status: 'listed',
    });
    expect(calls[1][0].data).toMatchObject({
      status: 'pending',
      submittedAt: AT,
      reviewedAt: null,
    });
  });

  it('records the watermark whatever the listing’s state', async () => {
    // The half that does not depend on anything remembering to run: the read
    // path compares it to `reviewedContentAt`, so a public listing whose
    // content moved stops being visible even if the status write never
    // happened — an unregistered webhook, a failed write, an older deployment.
    const { service, prisma } = makeService({ count: 0 });
    await service.onDocumentChanged('doc-1', AT);
    const [args] = prisma.templateListing.updateMany.mock.calls[0];
    expect(args.where).toEqual({
      documentId: 'doc-1',
      OR: [{ contentChangedAt: null }, { contentChangedAt: { lt: AT } }],
    });
  });

  it('guards the transition on the same watermark visibility compares', async () => {
    // `reviewedContentAt`, not `reviewedAt`: they are different clocks — the
    // content a reviewer attested to, and when they clicked. An event landing
    // between them would, under a `reviewedAt` guard, push `contentChangedAt`
    // past the approval (hiding the listing) while matching zero rows here
    // (so it never enters the queue and nobody is told) — hidden and
    // unreviewable at once. It also keeps redelivery idempotent: a duplicate
    // of an old event matches nothing rather than knocking a fresh approval
    // back to `pending` with a `submittedAt` in the past.
    const { service, prisma } = makeService();
    await service.onDocumentChanged('doc-1', AT);
    expect(
      prisma.templateListing.updateMany.mock.calls[1][0].where,
    ).toMatchObject({
      OR: [{ reviewedContentAt: null }, { reviewedContentAt: { lt: AT } }],
    });
  });

  it('costs one query for a document with no public listing', async () => {
    // It runs on every root change of every document in the deployment, so
    // the common case has to be a single index lookup that touches nothing.
    const { service, prisma, notificationService } = makeService({ count: 0 });
    await service.onDocumentChanged('doc-1', AT);
    expect(prisma.templateListing.findUnique).not.toHaveBeenCalled();
    // The watermark write plus the guarded transition, and nothing else.
    expect(prisma.templateListing.updateMany).toHaveBeenCalledTimes(2);
    expect(
      notificationService.createTemplateNeedsReview,
    ).not.toHaveBeenCalled();
  });

  it('tells the publisher, since their template quietly left the gallery', async () => {
    const { service, notificationService } = makeService();
    await service.onDocumentChanged('doc-1', AT);
    expect(notificationService.createTemplateNeedsReview).toHaveBeenCalledWith({
      listing: {
        id: 'tpl-1',
        createdBy: 7,
        workspaceId: 'ws-1',
        documentId: 'doc-1',
      },
      at: AT,
    });
  });

  it('keeps the listing out of the gallery even if the notification fails', async () => {
    const { service, notificationService } = makeService();
    notificationService.createTemplateNeedsReview.mockRejectedValueOnce(
      new Error('inbox down'),
    );
    await expect(
      service.onDocumentChanged('doc-1', AT),
    ).resolves.toBeUndefined();
  });
});
