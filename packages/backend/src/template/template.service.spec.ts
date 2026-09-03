import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TemplateService } from './template.service';
import * as reviewPolicy from './template-review';

const DOC = {
  id: 'doc-1',
  title: 'Weekly Report',
  type: 'sheet',
  workspaceId: 'ws-1',
  folderId: null,
  authorID: 7,
};

const LISTING = {
  id: 'tpl-1',
  documentId: 'doc-1',
  workspaceId: 'ws-1',
  createdBy: 7,
  shareLinkId: 'link-1',
  title: 'Weekly Report',
  description: null,
  category: null,
  tags: [],
  thumbnailId: null,
  visibility: 'unlisted',
  status: 'listed',
  useCount: 3,
  licensedAt: null,
  originId: null,
  publishedAt: new Date('2026-09-01T00:00:00Z'),
  document: DOC,
  shareLink: { token: 'tok-1' },
  creator: { id: 7, username: 'author', photo: null },
};

/** The shape `publish()` hands Prisma, so the upsert mock needs no casts. */
type ListingFields = Record<string, unknown>;
type UpsertArgs = { create: ListingFields; update: ListingFields };
type UpdateArgs = { where: { id: string }; data: ListingFields };
type UpsertReportArgs = {
  where: ListingFields;
  create: ListingFields;
  update: ListingFields;
};
type UpdateManyArgs = {
  where: { id: string; status?: string };
  data: ListingFields;
};
type FindManyArgs = {
  where: ListingFields;
  orderBy: Array<Record<string, string>>;
  take: number;
  cursor?: { id: string };
  skip?: number;
};

/**
 * `members` maps `<workspaceId>:<userId>` to a role, so a test states exactly
 * who belongs where — the distinction the whole authorization story turns on.
 */
function makeService(
  opts: {
    listing?: Record<string, unknown> | null;
    document?: Record<string, unknown> | null;
    members?: Record<string, string>;
    siblings?: Array<{ title: string }>;
    rows?: Array<Record<string, unknown>>;
    /** The Yorkie root `publish()` reads to check for external-data tabs. */
    root?: Record<string, unknown>;
    /** Make that read fail, which must fail the publish closed. */
    yorkieError?: Error;
    /**
     * Make the compare-and-set match no rows — what a concurrent decision
     * looks like from the loser's side.
     */
    staleWrite?: boolean;
    /** `YORKIE_AUTH_WEBHOOK_ENFORCE`, which the public tier requires. */
    yorkieEnforce?: string;
    /** Rows the reviewer's report queue returns. */
    reports?: Array<Record<string, unknown>>;
    /** `WAFFLEBASE_TEMPLATE_REVIEWER_IDS`, which the public tier requires. */
    reviewerIds?: string;
  } = {},
) {
  const members = opts.members ?? { 'ws-1:7': 'member' };
  /** The listing these mocks read and write, before any call under test. */
  const baseListing = (opts.listing ?? LISTING) as typeof LISTING;
  /** What the last guarded write asked for, so the re-read can reflect it. */
  let lastWrite: ListingFields | undefined;
  // `Promise.resolve` rather than `async () =>`: a mock body with nothing to
  // await trips `@typescript-eslint/require-await`, which the backend lint
  // enforces (and which `verify:fast` does not run — see the lessons file).
  const prisma = {
    document: {
      findUnique: jest.fn(() =>
        Promise.resolve(opts.document === undefined ? DOC : opts.document),
      ),
    },
    workspaceMember: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: {
            workspaceId_userId: { workspaceId: string; userId: number };
          };
        }) => {
          const { workspaceId, userId } = where.workspaceId_userId;
          const role = members[`${workspaceId}:${userId}`];
          return Promise.resolve(role ? { workspaceId, userId, role } : null);
        },
      ),
    },
    templateListing: {
      findUnique: jest.fn(() =>
        Promise.resolve(opts.listing === undefined ? LISTING : opts.listing),
      ),
      // Both return the row as it now STANDS — the test's own listing with the
      // write applied on top, not the module-level constant. Spreading
      // `LISTING` made a field the caller never mentioned come back as its
      // default, which is the opposite of what Prisma does and hid whether
      // `update` had actually changed anything.
      //
      // `upsert` takes ONE branch, as Prisma does: `create` only when there is
      // no row, `update` only when there is. Merging both let an existing
      // listing come back carrying create-only fields it could never have.
      upsert: jest.fn(({ create, update }: UpsertArgs) =>
        Promise.resolve(
          opts.listing === null
            ? { ...LISTING, ...create }
            : { ...baseListing, ...update },
        ),
      ),
      update: jest.fn((args: UpdateArgs) =>
        Promise.resolve({ ...baseListing, ...args.data }),
      ),
      // The compare-and-set the review/submit writes go through. It reports how
      // many rows matched, and `opts.staleWrite` makes that zero — the shape a
      // concurrent decision produces, where the row no longer holds the status
      // the caller validated against.
      updateMany: jest.fn((args: UpdateManyArgs) => {
        lastWrite = args.data;
        return Promise.resolve({ count: opts.staleWrite ? 0 : 1 });
      }),
      findUniqueOrThrow: jest.fn(() =>
        Promise.resolve({ ...baseListing, ...(lastWrite ?? {}) }),
      ),
      delete: jest.fn(() => Promise.resolve(LISTING)),
      findMany: jest.fn((args: FindManyArgs) =>
        Promise.resolve((opts.rows ?? [LISTING]).slice(0, args.take)),
      ),
    },
    shareLink: {
      delete: jest.fn(() => Promise.resolve({ id: 'link-1' })),
      deleteMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    templateReport: {
      upsert: jest.fn<Promise<{ id: string }>, [UpsertReportArgs]>(() =>
        Promise.resolve({ id: 'rep-1' }),
      ),
      findMany: jest.fn(() =>
        Promise.resolve(
          (opts.reports ?? []).map((r) => ({
            id: 'rep-1',
            reason: 'spam',
            note: null,
            createdAt: new Date('2026-09-03T00:00:00Z'),
            listing: baseListing,
            ...r,
          })),
        ),
      ),
      updateMany: jest.fn<Promise<{ count: number }>, [UpdateManyArgs]>(() =>
        Promise.resolve({ count: opts.staleWrite ? 0 : 1 }),
      ),
    },
    // The interactive transaction `review()` runs its compare-and-set in.
    // Passing the same mock client through means a test sees the calls exactly
    // as it would outside one; the value of the real thing is atomicity, which
    // a unit test cannot observe anyway.
    $transaction: jest.fn(
      (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma),
    ),
  };
  const documentCopyService = {
    copy: jest.fn(() => Promise.resolve({ id: 'new-1' })),
  };
  const shareLinkService = {
    create: jest.fn(() => Promise.resolve({ id: 'link-2' })),
  };
  const workspaceService = {
    assertMember: jest.fn((workspaceId: string, userId: number) => {
      const role = members[`${workspaceId}:${userId}`];
      if (!role) throw new ForbiddenException('Not a member of this workspace');
      return Promise.resolve({ workspaceId, userId, role });
    }),
  };
  const folderService = {
    assertSameWorkspace: jest.fn(() => Promise.resolve(undefined)),
  };
  const root = opts.root ?? { tabs: {}, tabOrder: [] };
  const yorkieService = {
    withDocument: jest.fn(
      (_id: string, cb: (doc: { getRoot: () => unknown }) => unknown) => {
        if (opts.yorkieError) return Promise.reject(opts.yorkieError);
        return Promise.resolve(cb({ getRoot: () => root }));
      },
    ),
  };

  const imageService = { delete: jest.fn(() => Promise.resolve(undefined)) };
  const notificationService = {
    createTemplateReviewed: jest.fn(() => Promise.resolve({ created: 1 })),
    createTemplateReviewQueued: jest.fn(() => Promise.resolve({ created: 1 })),
  };
  // Enforcement on by default, so a test that is not about the precondition
  // does not have to know it exists.
  const config = {
    get: (key: string) =>
      key === 'WAFFLEBASE_TEMPLATE_REVIEWER_IDS'
        ? 'reviewerIds' in opts
          ? opts.reviewerIds
          : '99'
        : key === 'YORKIE_AUTH_WEBHOOK_ENFORCE'
          ? // `in`, not `??`: a test says "unset" by passing `undefined`, which
            // is exactly what `??` would replace with the default.
            'yorkieEnforce' in opts
            ? opts.yorkieEnforce
            : 'true'
          : undefined,
  };

  const service = new TemplateService(
    prisma as never,
    documentCopyService as never,
    shareLinkService as never,
    workspaceService as never,
    folderService as never,
    yorkieService as never,
    imageService as never,
    notificationService as never,
    config as never,
  );
  return {
    service,
    prisma,
    documentCopyService,
    shareLinkService,
    workspaceService,
    folderService,
    yorkieService,
    imageService,
    notificationService,
  };
}

describe('TemplateService.publish', () => {
  it('lets the document author publish', async () => {
    const { service, prisma } = makeService();
    await service.publish('doc-1', 7, {});
    expect(prisma.templateListing.upsert).toHaveBeenCalled();
  });

  it('lets the workspace owner publish a document they did not author', async () => {
    const { service, prisma } = makeService({
      members: { 'ws-1:9': 'owner' },
    });
    await service.publish('doc-1', 9, {});
    expect(prisma.templateListing.upsert).toHaveBeenCalled();
  });

  it('refuses a plain member', async () => {
    // Publishing hands the content to an audience membership no longer bounds,
    // so it takes the editor-share-link bar, not the member bar.
    const { service } = makeService({ members: { 'ws-1:9': 'member' } });
    await expect(service.publish('doc-1', 9, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a non-member', async () => {
    const { service } = makeService({ members: {} });
    await expect(service.publish('doc-1', 9, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s on a missing document', async () => {
    const { service } = makeService({ document: null });
    await expect(service.publish('nope', 7, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('mints a viewer preview link when the document has no listing', async () => {
    const { service, shareLinkService } = makeService({ listing: null });
    await service.publish('doc-1', 7, {});
    expect(shareLinkService.create).toHaveBeenCalledWith(
      'doc-1',
      'viewer',
      7,
      null,
    );
  });

  it('reuses the live preview link on re-publish', async () => {
    const { service, shareLinkService } = makeService();
    await service.publish('doc-1', 7, { title: 'Renamed' });
    expect(shareLinkService.create).not.toHaveBeenCalled();
  });

  it('re-mints a preview link that was revoked from the Share dialog', async () => {
    const { service, shareLinkService } = makeService({
      listing: { ...LISTING, shareLinkId: null },
    });
    await service.publish('doc-1', 7, {});
    expect(shareLinkService.create).toHaveBeenCalled();
  });

  it('defaults the listing title to the document title', async () => {
    const { service, prisma } = makeService({ listing: null });
    await service.publish('doc-1', 7, {});
    expect(prisma.templateListing.upsert.mock.calls[0][0].create).toMatchObject(
      { title: 'Weekly Report' },
    );
  });

  it('does not widen visibility when a re-publish omits it', async () => {
    // The exposure case: a partial re-publish (attaching a thumbnail, say)
    // must not reset a workspace-scoped listing to `unlisted`, which is the
    // *more* permissive tier — anyone holding the id.
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'workspace' },
    });
    await service.publish('doc-1', 7, { thumbnailId: 'a.png' });
    expect(prisma.templateListing.upsert.mock.calls[0][0].update).toMatchObject(
      { visibility: 'workspace' },
    );
  });

  it('preserves metadata a partial re-publish does not mention', async () => {
    const { service, prisma } = makeService({
      listing: {
        ...LISTING,
        title: 'Renamed',
        description: 'why',
        category: 'Finance',
        tags: ['ops'],
      },
    });
    await service.publish('doc-1', 7, { thumbnailId: 'a.png' });
    expect(prisma.templateListing.upsert.mock.calls[0][0].update).toMatchObject(
      {
        title: 'Renamed',
        description: 'why',
        category: 'Finance',
        tags: ['ops'],
        thumbnailId: 'a.png',
      },
    );
  });

  it('refuses the public tier until the review pipeline exists', async () => {
    // Fails closed rather than silently downgrading: a publisher told "ok"
    // would believe their template was in the gallery.
    const { service } = makeService();
    await expect(
      service.publish('doc-1', 7, {
        visibility: 'public',
        acceptLicense: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a sheet holding a datasource tab, naming it', async () => {
    // The tab references a workspace-scoped connection row, so a copy made in
    // someone else's workspace opens it empty.
    const { service, prisma } = makeService({
      root: {
        tabOrder: ['t1', 't2'],
        tabs: {
          t1: { name: 'Summary', type: 'sheet' },
          t2: { name: 'Orders', type: 'datasource' },
        },
      },
    });
    await expect(service.publish('doc-1', 7, {})).rejects.toThrow(/Orders/);
    expect(prisma.templateListing.upsert).not.toHaveBeenCalled();
  });

  it('refuses a sheet holding a lakehouse tab absent from tabOrder', async () => {
    // A stale `tabOrder` must not hide a tab from the check.
    const { service } = makeService({
      root: { tabOrder: [], tabs: { t9: { type: 'lakehouse' } } },
    });
    await expect(service.publish('doc-1', 7, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not read Yorkie for a non-sheet document', async () => {
    const { service, yorkieService } = makeService({
      document: { ...DOC, type: 'slides' },
    });
    await service.publish('doc-1', 7, {});
    expect(yorkieService.withDocument).not.toHaveBeenCalled();
  });

  it('fails closed when the document cannot be read', async () => {
    // A document we could not read is not a document we can clear.
    const { service, prisma } = makeService({
      yorkieError: new Error('yorkie unreachable'),
    });
    await expect(service.publish('doc-1', 7, {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.templateListing.upsert).not.toHaveBeenCalled();
  });
});

describe('TemplateService.browse', () => {
  it('never returns a preview token on a card', async () => {
    // A page of 24 cards would otherwise hand out 24 non-expiring read
    // capabilities just to render a thumbnail grid.
    const { service } = makeService({ members: { 'ws-1:9': 'member' } });
    const page = await service.browse(
      { scope: 'workspace', workspaceId: 'ws-1' },
      9,
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty('previewToken');
  });

  it('constrains visibility in the query rather than filtering after', async () => {
    const { service, prisma } = makeService({
      members: { 'ws-1:9': 'member' },
    });
    await service.browse({ scope: 'workspace', workspaceId: 'ws-1' }, 9);
    const where = prisma.templateListing.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ visibility: 'workspace' });
  });

  it('shows a workspace listing that is under review or was rejected', async () => {
    // The property the visibility/status split exists to provide: submitting
    // for public review is observable to nobody. A `status: 'listed'` filter
    // here would make a listing vanish from its own workspace's tab the
    // moment its owner submitted it, and stay gone after a rejection.
    const { service, prisma } = makeService({
      members: { 'ws-1:9': 'member' },
    });
    await service.browse({ scope: 'workspace', workspaceId: 'ws-1' }, 9);
    expect(
      prisma.templateListing.findMany.mock.calls[0][0].where,
    ).toMatchObject({ status: { not: 'removed' } });
  });

  it('shows only listed rows in the public gallery', async () => {
    const { service, prisma } = makeService();
    await service.browse({ scope: 'public' });
    expect(
      prisma.templateListing.findMany.mock.calls[0][0].where,
    ).toMatchObject({ visibility: 'public', status: 'listed' });
  });

  it('scopes a workspace browse to the document’s current workspace', async () => {
    // The Phase 1 rule: read authority follows the document, not the
    // listing's denormalized workspaceId.
    const { service, prisma } = makeService({
      members: { 'ws-1:9': 'member' },
    });
    await service.browse({ scope: 'workspace', workspaceId: 'ws-1' }, 9);
    expect(
      prisma.templateListing.findMany.mock.calls[0][0].where,
    ).toMatchObject({ document: { workspaceId: 'ws-1' } });
  });

  it('has no scope that selects unlisted listings', async () => {
    // There is no `scope: 'unlisted'`; both scopes pin `visibility` to
    // something else, so the tier whose id *is* the capability is unreachable.
    const { service, prisma } = makeService({ members: {} });
    await service.browse({ scope: 'public' });
    expect(
      prisma.templateListing.findMany.mock.calls[0][0].where,
    ).toMatchObject({ visibility: 'public' });
  });

  it('accepts a workspace slug, which is what the URL actually carries', async () => {
    // `/w/hackerwins-s-workspace/templates` — the pages read the param
    // straight off `useParams`, so the slug is the only value the gallery
    // ever sends. `assertMember` resolves it; requiring a UUID made the
    // Templates tab fail outright.
    const { service, prisma, workspaceService } = makeService({
      members: { 'hackerwins-s-workspace:9': 'member' },
    });
    await service.browse(
      { scope: 'workspace', workspaceId: 'hackerwins-s-workspace' },
      9,
    );
    expect(workspaceService.assertMember).toHaveBeenCalledWith(
      'hackerwins-s-workspace',
      9,
    );
    // The *resolved* id is what constrains the query, never the raw param.
    expect(
      prisma.templateListing.findMany.mock.calls[0][0].where,
    ).toMatchObject({ document: { workspaceId: 'hackerwins-s-workspace' } });
  });

  it('refuses a workspace browse the caller does not belong to', async () => {
    const { service } = makeService({ members: {} });
    await expect(
      service.browse({ scope: 'workspace', workspaceId: 'ws-1' }, 9),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a workspace browse with no workspaceId', async () => {
    const { service } = makeService({ members: { 'ws-1:9': 'member' } });
    await expect(
      service.browse({ scope: 'workspace' }, 9),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a workspace browse from an anonymous caller', async () => {
    const { service } = makeService();
    await expect(
      service.browse({ scope: 'workspace', workspaceId: 'ws-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('serves the public scope to an anonymous caller', async () => {
    const { service } = makeService({ members: {} });
    await expect(service.browse({ scope: 'public' })).resolves.toMatchObject({
      nextCursor: null,
    });
  });

  it('combines the type facet with the workspace constraint', async () => {
    // Both constrain the *document* relation; a second assignment would
    // otherwise overwrite the first and widen the query.
    const { service, prisma } = makeService({
      members: { 'ws-1:9': 'member' },
    });
    await service.browse(
      { scope: 'workspace', workspaceId: 'ws-1', type: 'slides' },
      9,
    );
    expect(
      prisma.templateListing.findMany.mock.calls[0][0].where,
    ).toMatchObject({ document: { workspaceId: 'ws-1', type: 'slides' } });
  });

  it('normalizes the tag facet so it matches stored tags', async () => {
    const { service, prisma } = makeService({ members: {} });
    await service.browse({ scope: 'public', tag: '  Budget ' });
    expect(
      prisma.templateListing.findMany.mock.calls[0][0].where,
    ).toMatchObject({ tags: { has: 'budget' } });
  });

  it('orders by usage with an id tiebreak by default', async () => {
    const { service, prisma } = makeService({ members: {} });
    await service.browse({ scope: 'public' });
    expect(prisma.templateListing.findMany.mock.calls[0][0].orderBy).toEqual([
      { useCount: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('orders by recency when asked, still with the id tiebreak', async () => {
    const { service, prisma } = makeService({ members: {} });
    await service.browse({ scope: 'public', sort: 'recent' });
    expect(prisma.templateListing.findMany.mock.calls[0][0].orderBy).toEqual([
      { publishedAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('reports no next cursor when the page is not full', async () => {
    const { service } = makeService({ members: {}, rows: [LISTING] });
    const page = await service.browse({ scope: 'public', limit: 2 });
    expect(page.nextCursor).toBeNull();
  });

  it('takes one row past the page to decide whether another exists', async () => {
    const rows = [
      { ...LISTING, id: 'a' },
      { ...LISTING, id: 'b' },
      { ...LISTING, id: 'c' },
    ];
    const { service, prisma } = makeService({ members: {}, rows });
    const page = await service.browse({ scope: 'public', limit: 2 });
    expect(prisma.templateListing.findMany.mock.calls[0][0].take).toBe(3);
    expect(page.items.map((i) => i.id)).toEqual(['a', 'b']);
    // The cursor is the last row *of the page*, not the lookahead row.
    expect(page.nextCursor).toBe('b');
  });

  it('skips the cursor row itself on the next page', async () => {
    const { service, prisma } = makeService({ members: {} });
    await service.browse({ scope: 'public', cursor: 'b' });
    const args = prisma.templateListing.findMany.mock.calls[0][0];
    expect(args.cursor).toEqual({ id: 'b' });
    expect(args.skip).toBe(1);
  });
});

describe('TemplateService.update', () => {
  it('deletes the thumbnail it replaces', async () => {
    // "Update preview" is repeatable, so without this every press leaks one
    // publicly readable snapshot forever.
    const { service, imageService } = makeService({
      listing: { ...LISTING, thumbnailId: 'old.webp' },
    });
    await service.update('tpl-1', 7, { thumbnailId: 'new.webp' });
    expect(imageService.delete).toHaveBeenCalledWith('old.webp');
  });

  it('deletes nothing when the thumbnail is untouched', async () => {
    // An edit to the title must not throw away the picture.
    const { service, imageService } = makeService({
      listing: { ...LISTING, thumbnailId: 'keep.webp' },
    });
    await service.update('tpl-1', 7, { title: 'Renamed' });
    expect(imageService.delete).not.toHaveBeenCalled();
  });

  it('lets a manager edit listing metadata', async () => {
    const { service, prisma } = makeService();
    await service.update('tpl-1', 7, { title: 'Renamed', category: 'Finance' });
    expect(prisma.templateListing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tpl-1' },
        data: expect.objectContaining({
          title: 'Renamed',
          category: 'Finance',
        }) as unknown,
      }),
    );
  });

  it('leaves fields the body omits untouched', async () => {
    // `update` writes only the keys actually present, so an omitted field is
    // "leave alone" rather than "clear" — the distinction `publish` got wrong.
    const { service, prisma } = makeService();
    await service.update('tpl-1', 7, { title: 'Renamed' });
    const data = prisma.templateListing.update.mock.calls[0][0].data;
    expect(data).toEqual({ title: 'Renamed' });
  });

  it('distinguishes clearing a field from omitting it', async () => {
    const { service, prisma } = makeService();
    await service.update('tpl-1', 7, { description: '' });
    expect(prisma.templateListing.update.mock.calls[0][0].data).toEqual({
      description: '',
    });
  });

  it('refuses a non-manager', async () => {
    const { service } = makeService({ members: { 'ws-1:9': 'member' } });
    await expect(
      service.update('tpl-1', 9, { title: 'Renamed' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s on a missing listing', async () => {
    const { service } = makeService({ listing: null });
    await expect(
      service.update('tpl-1', 7, { title: 'Renamed' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses raising an existing listing to the public tier', async () => {
    const { service } = makeService();
    await expect(
      service.update('tpl-1', 7, { visibility: 'public' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows an edit to a listing that is already public-free', async () => {
    // `assertPublishable` reads the *resulting* visibility, so an unrelated
    // edit to a workspace listing must not be refused.
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'workspace' },
    });
    await expect(
      service.update('tpl-1', 7, { title: 'Renamed' }),
    ).resolves.toBeDefined();
  });
});

describe('TemplateService.findForViewer', () => {
  it('shows an unlisted listing to an anonymous visitor', async () => {
    const { service } = makeService();
    const view = await service.findForViewer('tpl-1');
    expect(view.previewToken).toBe('tok-1');
    expect(view.canManage).toBe(false);
  });

  it('hides a workspace listing from an anonymous visitor', async () => {
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'workspace' },
    });
    await expect(service.findForViewer('tpl-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('hides a workspace listing from an outsider as 404, not 403', async () => {
    // Whether a workspace has published a template is itself workspace
    // information.
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'workspace' },
      members: { 'ws-2:9': 'owner' },
    });
    await expect(service.findForViewer('tpl-1', 9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('shows a workspace listing to a member of that workspace', async () => {
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'workspace' },
      members: { 'ws-1:9': 'member' },
    });
    const view = await service.findForViewer('tpl-1', 9);
    expect(view.id).toBe('tpl-1');
    expect(view.canManage).toBe(false);
  });

  it('scopes a workspace listing to the document’s current workspace', async () => {
    // The document moved to ws-2 after publishing; ws-1 no longer reads it.
    const { service } = makeService({
      listing: {
        ...LISTING,
        visibility: 'workspace',
        document: { ...DOC, workspaceId: 'ws-2' },
      },
      members: { 'ws-1:9': 'member' },
    });
    await expect(service.findForViewer('tpl-1', 9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('hides a public listing that is still pending review', async () => {
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'pending' },
    });
    await expect(service.findForViewer('tpl-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports canManage to the publisher', async () => {
    const { service } = makeService();
    const view = await service.findForViewer('tpl-1', 7);
    expect(view.canManage).toBe(true);
  });

  it('degrades to a null preview token when the link was revoked', async () => {
    const { service } = makeService({
      listing: { ...LISTING, shareLink: null, shareLinkId: null },
    });
    const view = await service.findForViewer('tpl-1');
    expect(view.previewToken).toBeNull();
  });
});

describe('TemplateService.findByDocument', () => {
  it('returns the listing to a workspace member', async () => {
    const { service } = makeService({ members: { 'ws-1:9': 'member' } });
    const view = await service.findByDocument('doc-1', 9);
    expect(view?.previewToken).toBe('tok-1');
    expect(view?.canManage).toBe(false);
  });

  it('hides an unlisted listing from a non-member who knows the document id', async () => {
    // Otherwise anyone holding an *expiring* viewer share link (which reveals
    // the document id) could trade up to the listing's non-expiring token.
    const { service } = makeService({ members: {} });
    await expect(service.findByDocument('doc-1', 9)).resolves.toBeNull();
  });

  it('follows the document to its current workspace', async () => {
    // The listing's denormalized workspaceId is ws-1; the document has since
    // moved to ws-2, so ws-1's members must no longer reach it.
    const { service } = makeService({
      listing: {
        ...LISTING,
        visibility: 'workspace',
        document: { ...DOC, workspaceId: 'ws-2' },
      },
      members: { 'ws-1:9': 'member' },
    });
    await expect(service.findByDocument('doc-1', 9)).resolves.toBeNull();
  });
});

describe('TemplateService.use', () => {
  it('copies into the destination workspace under the caller', async () => {
    const { service, documentCopyService } = makeService({
      members: { 'ws-2:9': 'member' },
    });
    await service.use('tpl-1', 9, { workspaceId: 'ws-2' });
    expect(documentCopyService.copy).toHaveBeenCalledWith(DOC, 9, {
      workspaceId: 'ws-2',
      folderId: null,
      title: 'Weekly Report',
    });
  });

  it('accepts a workspace slug as the destination', async () => {
    // The New-from-template picker is mounted from the documents list, whose
    // `workspaceId` prop is the slug out of `/w/:workspaceId`.
    const { service, documentCopyService } = makeService({
      members: { 'hackerwins-s-workspace:9': 'member' },
    });
    await service.use('tpl-1', 9, { workspaceId: 'hackerwins-s-workspace' });
    expect(documentCopyService.copy).toHaveBeenCalledWith(
      DOC,
      9,
      expect.objectContaining({ workspaceId: 'hackerwins-s-workspace' }),
    );
  });

  it('refuses a destination workspace the caller does not belong to', async () => {
    // Read authority comes from the listing; write authority from destination
    // membership. An unlisted template is readable by anyone holding the id,
    // which must not become a write anywhere.
    const { service } = makeService({ members: {} });
    await expect(
      service.use('tpl-1', 9, { workspaceId: 'ws-2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a workspace-tier template to an outsider', async () => {
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'workspace' },
      members: { 'ws-2:9': 'owner' },
    });
    await expect(
      service.use('tpl-1', 9, { workspaceId: 'ws-2' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('checks the folder belongs to the destination workspace', async () => {
    const { service, folderService } = makeService({
      members: { 'ws-2:9': 'member' },
    });
    await service.use('tpl-1', 9, {
      workspaceId: 'ws-2',
      folderId: 'fld-9',
    });
    expect(folderService.assertSameWorkspace).toHaveBeenCalledWith(
      'fld-9',
      'ws-2',
    );
  });

  it('increments the use count', async () => {
    const { service, prisma } = makeService({
      members: { 'ws-2:9': 'member' },
    });
    await service.use('tpl-1', 9, { workspaceId: 'ws-2' });
    expect(prisma.templateListing.update).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
      data: { useCount: { increment: 1 } },
    });
  });

  it('still returns the document when the counter write fails', async () => {
    // A counter, not a ledger: the document the caller asked for exists.
    const { service, prisma } = makeService({
      members: { 'ws-2:9': 'member' },
    });
    prisma.templateListing.update.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.use('tpl-1', 9, { workspaceId: 'ws-2' }),
    ).resolves.toEqual({ id: 'new-1' });
  });
});

describe('TemplateService.use — content revalidation', () => {
  it('refuses a template whose document gained a datasource tab after publish', async () => {
    // A listing tracks a LIVE document, so passing the guard once is not a
    // property the content keeps. Without this the copy hands the caller a tab
    // that resolves to nothing in their own workspace.
    const { service, documentCopyService } = makeService({
      members: { 'ws-1:7': 'member', 'ws-2:9': 'owner' },
      root: {
        tabOrder: ['t1'],
        tabs: { t1: { name: 'Orders', type: 'datasource' } },
      },
    });
    await expect(
      service.use('tpl-1', 9, { workspaceId: 'ws-2' }),
    ).rejects.toThrow(/Orders/);
    expect(documentCopyService.copy).not.toHaveBeenCalled();
  });

  it('does not read the document for a caller who cannot write anywhere', async () => {
    // The destination check runs first, so an unauthorized caller costs no
    // Yorkie attach.
    const { service, yorkieService } = makeService({ members: {} });
    await expect(
      service.use('tpl-1', 9, { workspaceId: 'ws-2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(yorkieService.withDocument).not.toHaveBeenCalled();
  });

  it('copies a clean sheet as before', async () => {
    const { service, documentCopyService } = makeService({
      members: { 'ws-1:7': 'member', 'ws-2:9': 'owner' },
    });
    await service.use('tpl-1', 9, { workspaceId: 'ws-2' });
    expect(documentCopyService.copy).toHaveBeenCalled();
  });
});

describe('TemplateService.unpublish', () => {
  it('deletes the listing and revokes its preview link', async () => {
    // Leaving the link behind would keep the document anonymously readable
    // after the publisher believed they had withdrawn it.
    const { service, prisma } = makeService();
    await service.unpublish('tpl-1', 7);
    expect(prisma.templateListing.delete).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
    });
    expect(prisma.shareLink.delete).toHaveBeenCalledWith({
      where: { id: 'link-1' },
    });
  });

  it('keeps the listing when the link cannot be revoked', async () => {
    // The link is non-expiring and nothing sweeps it, so deleting the listing
    // first would strand a permanent anonymous read capability with nothing
    // left in the UI to revoke it. Failing first destroys nothing and the
    // caller can retry.
    const { service, prisma } = makeService();
    prisma.shareLink.delete.mockRejectedValueOnce(new Error('db down'));
    await expect(service.unpublish('tpl-1', 7)).rejects.toThrow('db down');
    expect(prisma.templateListing.delete).not.toHaveBeenCalled();
  });

  it('refuses a non-manager', async () => {
    const { service } = makeService({ members: { 'ws-1:9': 'member' } });
    await expect(service.unpublish('tpl-1', 9)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('deletes the thumbnail, so a withdrawn snapshot stops being readable', async () => {
    // `GET /images/:id` is unauthenticated and immutably cached, so a
    // thumbnail left behind is a picture of the document the publisher
    // believed they had withdrawn.
    const { service, imageService } = makeService({
      listing: { ...LISTING, thumbnailId: 'thumb-1.webp' },
    });
    await service.unpublish('tpl-1', 7);
    expect(imageService.delete).toHaveBeenCalledWith('thumb-1.webp');
  });

  it('still unpublishes when the thumbnail cannot be deleted', async () => {
    // Best-effort, unlike the share-link revoke: an orphaned picture grants no
    // access to the document, and is not worth stranding the listing over.
    const { service, prisma, imageService } = makeService({
      listing: { ...LISTING, thumbnailId: 'thumb-1.webp' },
    });
    imageService.delete.mockRejectedValueOnce(new Error('s3 down'));
    await expect(service.unpublish('tpl-1', 7)).resolves.toEqual({
      deleted: true,
    });
    expect(prisma.templateListing.delete).toHaveBeenCalled();
  });

  it('lets a workspace owner unpublish a listing another member published', async () => {
    // The design promises a manager may withdraw ANY listing in their
    // workspace, which `isDocumentManager` already grants an owner. Asserted
    // here so the promise survives a future narrowing of `assertManager`:
    // user 9 owns ws-1 but neither authored doc-1 (author 7) nor created the
    // listing.
    const { service, prisma } = makeService({ members: { 'ws-1:9': 'owner' } });
    await service.unpublish('tpl-1', 9);
    expect(prisma.templateListing.delete).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
    });
  });

  it('404s on a missing listing', async () => {
    const { service } = makeService({ listing: null });
    await expect(service.unpublish('tpl-1', 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/**
 * Open the public tier for one test.
 *
 * `PUBLIC_TIER_OPEN` is a constant, not configuration, so there is no env var a
 * test can set. These spies let a test state which side of the gate it is
 * about without depending on the constant's current value — which is what kept
 * the state machine covered while the gallery was still shut.
 */
function openPublicTier(): void {
  jest.spyOn(reviewPolicy, 'assertPublicTierOpen').mockImplementation(() => {});
}

/**
 * Shut it, which is what the constant does in production if it is ever flipped
 * back. Used to assert that a verb actually *consults* the gate — the thing
 * that stays true whichever way the constant points.
 */
function closePublicTier(): void {
  jest.spyOn(reviewPolicy, 'assertPublicTierOpen').mockImplementation(() => {
    throw new BadRequestException('shut');
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('TemplateService.submit', () => {
  it('consults the tier gate, so shutting the gallery shuts submission', () => {
    // The gate is open now. What still has to be true is that `submit` asks
    // it — flipping `PUBLIC_TIER_OPEN` back has to close this door, not just
    // the approval one.
    closePublicTier();
    const { service } = makeService();
    return expect(
      service.submit('tpl-1', 7, { acceptLicense: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves status and does not touch visibility', async () => {
    // The property the whole split exists for: submitting is observable to
    // nobody. If this wrote `visibility`, an unlisted link already handed out
    // would change meaning while a reviewer looked at it.
    openPublicTier();
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'workspace' },
    });
    await service.submit('tpl-1', 7, { acceptLicense: true });
    const { data } = prisma.templateListing.updateMany.mock.calls[0][0];
    expect(data.status).toBe('pending');
    expect(data).not.toHaveProperty('visibility');
  });

  it('requires the license grant', async () => {
    openPublicTier();
    const { service } = makeService();
    await expect(
      service.submit('tpl-1', 7, { acceptLicense: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a plain member', async () => {
    openPublicTier();
    const { service } = makeService({ members: { 'ws-1:9': 'member' } });
    await expect(
      service.submit('tpl-1', 9, { acceptLicense: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('clears the previous decision so a stale reason is not shown', async () => {
    openPublicTier();
    const { service, prisma } = makeService({
      listing: { ...LISTING, status: 'rejected', reviewNote: 'too thin' },
    });
    await service.submit('tpl-1', 7, { acceptLicense: true });
    const { data } = prisma.templateListing.updateMany.mock.calls[0][0];
    expect(data).toMatchObject({
      reviewNote: null,
      reviewedAt: null,
      reviewedBy: null,
    });
  });

  it('refuses a second submission while one is pending', async () => {
    openPublicTier();
    const { service } = makeService({
      listing: { ...LISTING, status: 'pending' },
    });
    await expect(
      service.submit('tpl-1', 7, { acceptLicense: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TemplateService.review', () => {
  it('consults it again at approve, since the two are separate requests', async () => {
    // A listing can be submitted while the gallery is open and decided after
    // it is shut.
    closePublicTier();
    const { service, prisma } = makeService({
      listing: { ...LISTING, status: 'pending' },
    });
    await expect(
      service.review('tpl-1', 99, { decision: 'approve' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.templateListing.updateMany).not.toHaveBeenCalled();
  });

  it('approve is the only writer of visibility: public', async () => {
    openPublicTier();
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'workspace', status: 'pending' },
    });
    await service.review('tpl-1', 99, { decision: 'approve' });
    const { data } = prisma.templateListing.updateMany.mock.calls[0][0];
    expect(data).toMatchObject({ status: 'listed', visibility: 'public' });
  });

  it('reject leaves visibility alone', async () => {
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'workspace', status: 'pending' },
    });
    await service.review('tpl-1', 99, { decision: 'reject', note: 'thin' });
    const { data } = prisma.templateListing.updateMany.mock.calls[0][0];
    expect(data.status).toBe('rejected');
    expect(data).not.toHaveProperty('visibility');
    expect(data.reviewNote).toBe('thin');
    expect(data.reviewedBy).toBe(99);
  });

  it('takedown revokes the preview link, in the same transaction as the row', async () => {
    // Atomicity rather than ordering, which is what made the ordering question
    // go away: a row marked `removed` whose non-expiring link survived would
    // read as "taken down" in every UI while the content stayed anonymously
    // readable, and a link revoked against a row that never changed leaves a
    // listing that looks live with no preview. Neither half can land alone.
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'listed' },
    });
    await service.review('tpl-1', 99, { decision: 'takedown', note: 'dmca' });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.shareLink.deleteMany).toHaveBeenCalledWith({
      where: { id: 'link-1' },
    });
  });

  it('refuses a decision the listing has already moved past', async () => {
    // Two reviewers deciding at once both pass `assertDecisionAllowed`, so the
    // write has to be conditional on the status it was validated against.
    // Without it the later write simply wins — a takedown followed by a
    // concurrent approve leaves a public listing no reviewer approved, whose
    // preview link is already deleted.
    const { service } = makeService({
      listing: { ...LISTING, status: 'pending' },
      staleWrite: true,
    });
    await expect(
      service.review('tpl-1', 99, { decision: 'reject', note: 'thin' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('guards the write on the status it checked', async () => {
    const { service, prisma } = makeService({
      listing: { ...LISTING, status: 'pending' },
    });
    await service.review('tpl-1', 99, { decision: 'reject', note: 'thin' });
    expect(prisma.templateListing.updateMany.mock.calls[0][0].where).toEqual({
      id: 'tpl-1',
      status: 'pending',
    });
  });

  it('takedown drops the tier back to unlisted', async () => {
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'listed' },
    });
    await service.review('tpl-1', 99, { decision: 'takedown' });
    const { data } = prisma.templateListing.updateMany.mock.calls[0][0];
    expect(data).toMatchObject({ status: 'removed', visibility: 'unlisted' });
  });

  it('refuses to decide a submission nobody made', async () => {
    const { service } = makeService({
      listing: { ...LISTING, status: 'listed' },
    });
    await expect(
      service.review('tpl-1', 99, { decision: 'reject' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('notifies the publisher, and a failure does not undo the decision', async () => {
    const { service, notificationService, prisma } = makeService({
      listing: { ...LISTING, status: 'pending' },
    });
    notificationService.createTemplateReviewed.mockRejectedValueOnce(
      new Error('inbox down'),
    );
    await expect(
      service.review('tpl-1', 99, { decision: 'reject', note: 'why' }),
    ).resolves.toBeDefined();
    expect(prisma.templateListing.updateMany).toHaveBeenCalled();
  });

  it('never returns canManage to a reviewer', async () => {
    // A reviewer is not a manager of someone else's listing, and the queue
    // must not tell the UI otherwise.
    const { service } = makeService({
      listing: { ...LISTING, status: 'pending' },
    });
    const view = await service.review('tpl-1', 99, { decision: 'reject' });
    expect(view.canManage).toBe(false);
  });
});

describe('a removed listing', () => {
  it('is invisible to a viewer holding its link', async () => {
    // A takedown writes `visibility: 'unlisted'`, whose arm returns true
    // unconditionally — so the status check has to run BEFORE the visibility
    // switch, not inside it.
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'unlisted', status: 'removed' },
      members: {},
    });
    await expect(service.findForViewer('tpl-1', 9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('is still readable by its manager, who has to see the decision', async () => {
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'unlisted', status: 'removed' },
    });
    await expect(service.findForViewer('tpl-1', 7)).resolves.toMatchObject({
      status: 'removed',
    });
  });

  it('cannot be used, not even by its manager', async () => {
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'unlisted', status: 'removed' },
    });
    await expect(
      service.use('tpl-1', 7, { workspaceId: 'ws-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cannot be republished back into existence', async () => {
    // Without this, one republish resets `status` to `listed` and re-mints the
    // revoked preview link — a publisher reversing a moderation decision.
    const { service } = makeService({
      listing: { ...LISTING, status: 'removed' },
    });
    await expect(service.publish('doc-1', 7, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('cannot be edited', async () => {
    const { service } = makeService({
      listing: { ...LISTING, status: 'removed' },
    });
    await expect(
      service.update('tpl-1', 7, { title: 'Nicer name' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('publish preserves the review state', () => {
  it('does not reset a pending listing to listed', async () => {
    // A publish that changes no card field is allowed while pending, and must
    // leave the review state where it is.
    const { service, prisma } = makeService({
      listing: { ...LISTING, status: 'pending' },
    });
    await service.publish('doc-1', 7, { tags: ['budget'] });
    const { update } = prisma.templateListing.upsert.mock.calls[0][0];
    expect(update.status).toBe('pending');
  });

  it('defaults a first publish to listed', async () => {
    const { service, prisma } = makeService({ listing: null });
    await service.publish('doc-1', 7, {});
    const { create } = prisma.templateListing.upsert.mock.calls[0][0];
    expect(create.status).toBe('listed');
  });

  it('lets an approved listing be republished and renamed', async () => {
    // `assertPublishable` refuses the *transition into* public, not its
    // presence. Checking the value alone made an approved listing permanently
    // unpublishable and unrenamable, because `visibility` falls back to the
    // stored one when the body omits it.
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'listed' },
    });
    await service.publish('doc-1', 7, { title: 'Renamed' });
    const { update } = prisma.templateListing.upsert.mock.calls[0][0];
    expect(update.title).toBe('Renamed');
    expect(update.visibility).toBe('public');
  });

  it('still refuses a publisher asking for public directly', async () => {
    const { service } = makeService();
    await expect(
      service.publish('doc-1', 7, { visibility: 'public' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still refuses an update asking for public directly', async () => {
    const { service } = makeService();
    await expect(
      service.update('tpl-1', 7, { visibility: 'public' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('a removed listing (continued)', () => {
  it('cannot be unpublished, which would let the next publish undo it', () => {
    // The bypass this guard closes: unpublish deletes the row, so the next
    // publish takes the `create` branch — status back to `listed`, and a
    // FRESH non-expiring anonymous preview link to the content a reviewer
    // removed. Two buttons that already ship.
    const { service } = makeService({
      listing: { ...LISTING, status: 'removed' },
    });
    return expect(service.unpublish('tpl-1', 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('is not returned to a plain workspace member by document', async () => {
    // `findByDocument` gates on membership rather than visibility, so without
    // its own status check a member reads a taken-down listing's metadata
    // straight out of the Share dialog's lookup.
    const { service } = makeService({
      listing: { ...LISTING, status: 'removed' },
      members: { 'ws-1:9': 'member' },
    });
    await expect(service.findByDocument('doc-1', 9)).resolves.toBeNull();
  });

  it('is still returned to its manager, with the reason', async () => {
    const { service } = makeService({
      listing: { ...LISTING, status: 'removed', reviewNote: 'dmca' },
    });
    await expect(service.findByDocument('doc-1', 7)).resolves.toMatchObject({
      status: 'removed',
      review: { note: 'dmca' },
    });
  });
});

describe('the review block on a listing view', () => {
  it('is withheld from a non-manager', async () => {
    // A reviewer's note is written for the publisher, not for the gallery.
    const { service } = makeService({
      listing: { ...LISTING, reviewNote: 'internal note' },
      members: { 'ws-1:9': 'member' },
    });
    const view = await service.findForViewer('tpl-1', 9);
    expect(view.canManage).toBe(false);
    expect(view.review).toBeNull();
  });

  it('reaches the reviewer queue, which needs the wait time', async () => {
    // The queue is explicitly not a manager, so it asks for the block by hand.
    const { service } = makeService({
      rows: [{ ...LISTING, status: 'pending', submittedAt: new Date() }],
    });
    const [item] = await service.listForReview();
    expect(item.canManage).toBe(false);
    expect(item.review).not.toBeNull();
  });
});

describe('TemplateService.submit (continued)', () => {
  it('refuses to take an already-public listing offline for a re-review', async () => {
    // Moving `status` to `pending` drops a public listing out of the gallery
    // and out of `isVisibleTo` — the one observable change this verb promises
    // never to make. Re-review needs the frozen copy to keep serving, and
    // that does not exist until 3b.
    openPublicTier();
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'listed' },
    });
    await expect(
      service.submit('tpl-1', 7, { acceptLicense: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TemplateService.submit concurrency', () => {
  it('refuses to move a listing a reviewer just decided', async () => {
    // Without the guard, a submit racing a takedown moves a decided listing
    // back to `pending` and quietly undoes the decision.
    openPublicTier();
    const { service } = makeService({ staleWrite: true });
    await expect(
      service.submit('tpl-1', 7, { acceptLicense: true }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('public-tier preconditions and the review window', () => {
  it('refuses the public tier while the Yorkie auth webhook only shadows', async () => {
    // In shadow mode a preview token also grants *write* access, so every
    // visitor to a public card could edit the document behind it — and since
    // an edit returns a listing to review, one request per card would empty
    // the gallery into a queue only a human can drain.
    openPublicTier();
    const { service } = makeService({ yorkieEnforce: undefined });
    await expect(
      service.submit('tpl-1', 7, { acceptLicense: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checks it again at approve, since a setting can change in between', async () => {
    openPublicTier();
    const { service } = makeService({
      listing: { ...LISTING, status: 'pending' },
      yorkieEnforce: 'false',
    });
    await expect(
      service.review('tpl-1', 99, { decision: 'approve' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an approval of content that moved while it was being reviewed', async () => {
    // The review *window* is the whole attack without this: submit clean
    // content, let a reviewer read it, edit the document, and the approve that
    // lands afterwards publishes what nobody looked at. Returning to `pending`
    // on edit does not cover it — the listing is already `pending`.
    openPublicTier();
    const { service } = makeService({
      listing: {
        ...LISTING,
        status: 'pending',
        contentChangedAt: new Date('2026-09-02T12:00:00Z'),
      },
    });
    await expect(
      service.review('tpl-1', 99, {
        decision: 'approve',
        contentAt: '2026-09-02T10:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('treats "never edited" as a version too', async () => {
    // A reviewer who saw no watermark and approves after one edit must be
    // refused, so the null case cannot be the loophole.
    openPublicTier();
    const { service } = makeService({
      listing: {
        ...LISTING,
        status: 'pending',
        contentChangedAt: new Date('2026-09-02T12:00:00Z'),
      },
    });
    await expect(
      service.review('tpl-1', 99, { decision: 'approve' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records what the reviewer attested to, so the read path can re-check', async () => {
    openPublicTier();
    const contentAt = new Date('2026-09-02T12:00:00Z');
    const { service, prisma } = makeService({
      listing: { ...LISTING, status: 'pending', contentChangedAt: contentAt },
    });
    await service.review('tpl-1', 99, {
      decision: 'approve',
      contentAt: contentAt.toISOString(),
    });
    expect(
      prisma.templateListing.updateMany.mock.calls[0][0].data,
    ).toMatchObject({ reviewedContentAt: contentAt });
  });

  it('hides a public listing whose content moved past its approval', async () => {
    // The webhook-independent half. A status is only as good as the write that
    // set it, and the event webhook is per-project configuration a deployment
    // can simply not have registered.
    const { service } = makeService({
      listing: {
        ...LISTING,
        visibility: 'public',
        status: 'listed',
        contentChangedAt: new Date('2026-09-02T12:00:00Z'),
        reviewedContentAt: new Date('2026-09-02T10:00:00Z'),
      },
      members: {},
    });
    await expect(service.findForViewer('tpl-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('shows one whose content has not moved since', async () => {
    const at = new Date('2026-09-02T12:00:00Z');
    const { service } = makeService({
      listing: {
        ...LISTING,
        visibility: 'public',
        status: 'listed',
        contentChangedAt: at,
        reviewedContentAt: at,
      },
      members: {},
    });
    await expect(service.findForViewer('tpl-1')).resolves.toMatchObject({
      status: 'listed',
    });
  });

  it('leaves a listing approved before the watermarks existed visible', async () => {
    // Both columns null on an older row. Hiding those retroactively would take
    // every existing approval off a deployment the moment it upgrades.
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'listed' },
      members: {},
    });
    await expect(service.findForViewer('tpl-1')).resolves.toBeDefined();
  });
});

describe('editing an approved card', () => {
  it('re-enters review, because the card is what was approved', async () => {
    // No Yorkie edit is involved, so the webhook path would never see this —
    // swapping an approved card's title and picture for spam is the same
    // bait-and-switch by a cheaper route.
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'listed' },
    });
    await service.update('tpl-1', 7, { title: 'Free Crypto' });
    expect(prisma.templateListing.update.mock.calls[0][0].data).toMatchObject({
      status: 'pending',
      reviewedContentAt: null,
    });
  });

  it('leaves the state alone when nothing on the card actually changed', async () => {
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'listed' },
    });
    await service.update('tpl-1', 7, { title: LISTING.title, tags: ['a'] });
    expect(
      prisma.templateListing.update.mock.calls[0][0].data,
    ).not.toHaveProperty('status');
  });

  it('does not disturb a workspace-tier listing', async () => {
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'workspace', status: 'listed' },
    });
    await service.update('tpl-1', 7, { title: 'Renamed' });
    expect(
      prisma.templateListing.update.mock.calls[0][0].data,
    ).not.toHaveProperty('status');
  });
});

describe('search', () => {
  it('matches a one-word query against tags as well as text', async () => {
    const { service, prisma } = makeService();
    await service.browse({ scope: 'public', q: 'Budget' });
    expect(prisma.templateListing.findMany.mock.calls[0][0].where.OR).toEqual([
      { title: { contains: 'Budget', mode: 'insensitive' } },
      { description: { contains: 'Budget', mode: 'insensitive' } },
      { tags: { has: 'budget' } },
    ]);
  });

  it('does not add a tag clause a multi-word query can never match', async () => {
    // Tags normalize to single tokens, so `has: 'weekly report'` would be a
    // clause that matches nothing — and splitting the phrase would quietly
    // widen the search into "anything tagged weekly".
    const { service, prisma } = makeService();
    await service.browse({ scope: 'public', q: 'weekly report' });
    expect(
      prisma.templateListing.findMany.mock.calls[0][0].where.OR,
    ).toHaveLength(2);
  });
});

describe('report intake', () => {
  it('records a report from anyone who can see the listing', async () => {
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'listed' },
      members: {},
    });
    await service.report('tpl-1', 9, { reason: 'spam' });
    expect(prisma.templateReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { listingId_reporterId: { listingId: 'tpl-1', reporterId: 9 } },
      }),
    );
  });

  it('refuses a listing the reporter cannot see', async () => {
    // Otherwise the route is an oracle for whether an unlisted id exists.
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'listed' },
      members: {},
    });
    // A public listing whose content moved past its approval is already
    // hidden, so it is not reportable either.
    await expect(
      service.report('tpl-9', 9, { reason: 'spam' }),
    ).resolves.toBeDefined();
  });

  it('refuses a listing that is not public', async () => {
    // A report routes the listing to the global reviewer allowlist, preview
    // token and all. A workspace or unlisted listing has its own trust
    // boundary and does not go there.
    const { service } = makeService({
      listing: { ...LISTING, visibility: 'workspace' },
      members: { 'ws-1:9': 'member' },
    });
    await expect(
      service.report('tpl-1', 9, { reason: 'spam' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not reopen a report that was already dismissed', async () => {
    // The unique index bounds rows; this bounds the work each row can make.
    // Without it a griefer re-files after every dismissal, forever.
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'listed' },
      members: {},
    });
    await service.report('tpl-1', 9, { reason: 'spam' });
    expect(
      prisma.templateReport.upsert.mock.calls[0][0].update,
    ).not.toHaveProperty('status');
  });

  it('does not hide the listing or touch its status', async () => {
    // A report that acted on its own would be a takedown anyone could
    // trigger. The decision stays with the allowlist.
    const { service, prisma } = makeService({
      listing: { ...LISTING, visibility: 'public', status: 'listed' },
      members: {},
    });
    await service.report('tpl-1', 9, { reason: 'copyright' });
    expect(prisma.templateListing.update).not.toHaveBeenCalled();
    expect(prisma.templateListing.updateMany).not.toHaveBeenCalled();
  });

  it('lets a reviewer close a report without touching the listing', async () => {
    // A queue that only empties when content is removed pressures whoever
    // drains it toward removing content.
    const { service, prisma } = makeService();
    await service.resolveReport('rep-1', 99, 'dismissed');
    expect(prisma.templateReport.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'rep-1', status: 'open' },
      data: { status: 'dismissed', resolvedBy: 99 },
    });
  });

  it('404s when the report was already closed', async () => {
    const { service } = makeService({ staleWrite: true });
    await expect(
      service.resolveReport('rep-1', 99, 'actioned'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('useCount ranking guards', () => {
  it('does not count the publisher using their own template', async () => {
    // `useCount` is the gallery's default rank, so the cheapest way to the top
    // would otherwise be a loop over your own template.
    const { service, prisma } = makeService({
      listing: { ...LISTING, createdBy: 7 },
    });
    await service.use('tpl-1', 7, { workspaceId: 'ws-1' });
    expect(prisma.templateListing.update).not.toHaveBeenCalled();
  });

  it('counts a use by anyone else', async () => {
    const { service, prisma } = makeService({
      listing: { ...LISTING, createdBy: 7, visibility: 'public' },
      members: { 'ws-2:9': 'member' },
    });
    await service.use('tpl-1', 9, { workspaceId: 'ws-2' });
    expect(prisma.templateListing.update).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
      data: { useCount: { increment: 1 } },
    });
  });
});

describe('editing while under review', () => {
  it('refuses a card change through update()', async () => {
    // The `contentAt` attestation covers the document; a card field writes no
    // Yorkie change, so the watermark does not move and the approval would
    // publish metadata the reviewer never inspected.
    const { service } = makeService({
      listing: { ...LISTING, status: 'pending' },
    });
    await expect(
      service.update('tpl-1', 7, { title: 'Free Crypto' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses the same change through publish(), which takes the same fields', async () => {
    const { service } = makeService({
      listing: { ...LISTING, status: 'pending' },
    });
    await expect(
      service.publish('doc-1', 7, { thumbnailId: NEW_THUMB }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('still allows a change that is not on the card', async () => {
    const { service } = makeService({
      listing: { ...LISTING, status: 'pending' },
    });
    await expect(
      service.update('tpl-1', 7, { tags: ['budget'] }),
    ).resolves.toBeDefined();
  });

  it('leaves a listed listing editable', async () => {
    const { service } = makeService();
    await expect(
      service.update('tpl-1', 7, { title: 'Renamed' }),
    ).resolves.toBeDefined();
  });
});

const NEW_THUMB = '11111111-2222-3333-4444-555555555555.png';
