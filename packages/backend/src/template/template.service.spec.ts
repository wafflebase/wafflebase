import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TemplateService } from './template.service';

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
  } = {},
) {
  const members = opts.members ?? { 'ws-1:7': 'member' };
  const prisma = {
    document: {
      findUnique: jest.fn(async () =>
        opts.document === undefined ? DOC : opts.document,
      ),
    },
    workspaceMember: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { workspaceId_userId: { workspaceId: string; userId: number } };
        }) => {
          const { workspaceId, userId } = where.workspaceId_userId;
          const role = members[`${workspaceId}:${userId}`];
          return role ? { workspaceId, userId, role } : null;
        },
      ),
    },
    templateListing: {
      findUnique: jest.fn(async () =>
        opts.listing === undefined ? LISTING : opts.listing,
      ),
      upsert: jest.fn(async ({ create, update }: Record<string, unknown>) => ({
        ...LISTING,
        ...(create as object),
        ...(update as object),
      })),
      update: jest.fn(async () => LISTING),
      delete: jest.fn(async () => LISTING),
    },
    shareLink: { delete: jest.fn(async () => ({ id: 'link-1' })) },
  };
  const documentCopyService = { copy: jest.fn(async () => ({ id: 'new-1' })) };
  const shareLinkService = { create: jest.fn(async () => ({ id: 'link-2' })) };
  const workspaceService = {
    assertMember: jest.fn(async (workspaceId: string, userId: number) => {
      const role = members[`${workspaceId}:${userId}`];
      if (!role) throw new ForbiddenException('Not a member of this workspace');
      return { workspaceId, userId, role };
    }),
  };
  const folderService = { assertSameWorkspace: jest.fn(async () => undefined) };

  const service = new TemplateService(
    prisma as never,
    documentCopyService as never,
    shareLinkService as never,
    workspaceService as never,
    folderService as never,
  );
  return {
    service,
    prisma,
    documentCopyService,
    shareLinkService,
    workspaceService,
    folderService,
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
    expect(prisma.templateListing.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ title: 'Weekly Report' }),
      }),
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

  it('refuses a non-manager', async () => {
    const { service } = makeService({ members: { 'ws-1:9': 'member' } });
    await expect(service.unpublish('tpl-1', 9)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s on a missing listing', async () => {
    const { service } = makeService({ listing: null });
    await expect(service.unpublish('tpl-1', 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
