import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { ShareLinkService } from './share-link.service';

const DOC_ID = 'doc-1';
const WS_ID = 'ws-1';
const AUTHOR_ID = 1;
const OWNER_ID = 2;
const MEMBER_ID = 3;
const OUTSIDER_ID = 4;

function createMockPrisma() {
  return {
    document: {
      findUnique: jest.fn(),
    },
    workspaceMember: {
      findUnique: jest.fn(),
    },
    shareLink: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
  };
}

describe('ShareLinkService', () => {
  let service: ShareLinkService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ShareLinkService(prisma as unknown as PrismaService);
    // Document authored by AUTHOR_ID, living in workspace WS_ID.
    prisma.document.findUnique.mockResolvedValue({
      id: DOC_ID,
      workspaceId: WS_ID,
      authorID: AUTHOR_ID,
    });
    prisma.shareLink.create.mockImplementation(({ data }: any) => ({
      id: 'link-1',
      token: 'tok',
      ...data,
    }));
  });

  afterEach(() => jest.restoreAllMocks());

  /** Wire the membership lookup for a given caller. */
  function asMember(role: 'owner' | 'member' | null) {
    prisma.workspaceMember.findUnique.mockResolvedValue(
      role ? { role, userId: 0, workspaceId: WS_ID } : null,
    );
  }

  describe('create', () => {
    it('rejects an unknown role before any lookup', async () => {
      await expect(
        service.create(DOC_ID, 'commenter', OWNER_ID, null),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when the document is missing', async () => {
      prisma.document.findUnique.mockResolvedValue(null);
      await expect(
        service.create(DOC_ID, 'viewer', AUTHOR_ID, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets a workspace owner (not author) create an editor link', async () => {
      asMember('owner');
      await expect(
        service.create(DOC_ID, 'editor', OWNER_ID, null),
      ).resolves.toMatchObject({ role: 'editor', documentId: DOC_ID });
    });

    it('lets the document author create an editor link even without membership', async () => {
      asMember(null);
      await expect(
        service.create(DOC_ID, 'editor', AUTHOR_ID, null),
      ).resolves.toMatchObject({ role: 'editor' });
    });

    it('lets a plain member create a viewer link', async () => {
      asMember('member');
      await expect(
        service.create(DOC_ID, 'viewer', MEMBER_ID, null),
      ).resolves.toMatchObject({ role: 'viewer' });
    });

    it('forbids a plain member from creating an editor link', async () => {
      asMember('member');
      await expect(
        service.create(DOC_ID, 'editor', MEMBER_ID, null),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids a non-member from creating any link', async () => {
      asMember(null);
      await expect(
        service.create(DOC_ID, 'viewer', OUTSIDER_ID, null),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findByDocument', () => {
    const OWNER_EDITOR = {
      id: 'l-editor',
      role: 'editor',
      createdBy: OWNER_ID,
    };
    const MEMBER_VIEWER = {
      id: 'l-viewer',
      role: 'viewer',
      createdBy: MEMBER_ID,
    };

    it('hides editor links from a plain member and flags no editor rights', async () => {
      asMember('member');
      prisma.shareLink.findMany.mockResolvedValue([OWNER_EDITOR, MEMBER_VIEWER]);
      const result = await service.findByDocument(DOC_ID, MEMBER_ID);
      // The owner's editor link is filtered out; only the member's viewer link remains.
      expect(result.links.map((l) => l.id)).toEqual(['l-viewer']);
      expect(result.permissions).toEqual({ canCreateEditorLink: false });
    });

    it('marks a member as able to delete only their own links', async () => {
      asMember('member');
      prisma.shareLink.findMany.mockResolvedValue([
        MEMBER_VIEWER,
        { id: 'other', role: 'viewer', createdBy: OUTSIDER_ID },
      ]);
      const result = await service.findByDocument(DOC_ID, MEMBER_ID);
      const byId = Object.fromEntries(result.links.map((l) => [l.id, l.canDelete]));
      expect(byId).toEqual({ 'l-viewer': true, other: false });
    });

    it('gives the owner every link with full delete + editor rights', async () => {
      asMember('owner');
      prisma.shareLink.findMany.mockResolvedValue([OWNER_EDITOR, MEMBER_VIEWER]);
      const result = await service.findByDocument(DOC_ID, OWNER_ID);
      expect(result.links.map((l) => l.id)).toEqual(['l-editor', 'l-viewer']);
      expect(result.links.every((l) => l.canDelete)).toBe(true);
      expect(result.permissions).toEqual({ canCreateEditorLink: true });
    });

    it('forbids a non-member from listing links', async () => {
      asMember(null);
      await expect(
        service.findByDocument(DOC_ID, OUTSIDER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      prisma.shareLink.findUnique.mockResolvedValue({
        id: 'link-1',
        documentId: DOC_ID,
        createdBy: MEMBER_ID,
      });
      prisma.shareLink.delete.mockResolvedValue({ id: 'link-1' });
    });

    it('lets the owner revoke a link created by someone else', async () => {
      asMember('owner');
      await expect(service.delete('link-1', OWNER_ID)).resolves.toMatchObject({
        id: 'link-1',
      });
    });

    it('lets a member revoke their own link', async () => {
      asMember('member');
      await expect(service.delete('link-1', MEMBER_ID)).resolves.toMatchObject({
        id: 'link-1',
      });
    });

    it('lets the creator revoke their own link even after losing access', async () => {
      asMember(null); // creator was removed from the workspace
      await expect(service.delete('link-1', MEMBER_ID)).resolves.toMatchObject({
        id: 'link-1',
      });
      // The access lookup is skipped entirely for the creator.
      expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
    });

    it("forbids a member from revoking another member's link", async () => {
      asMember('member');
      await expect(
        service.delete('link-1', OUTSIDER_ID + 100),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findByToken', () => {
    it('throws Gone for an expired link', async () => {
      prisma.shareLink.findUnique.mockResolvedValue({
        id: 'link-1',
        expiresAt: new Date(Date.now() - 1000),
        document: {},
      });
      await expect(service.findByToken('tok')).rejects.toBeInstanceOf(
        GoneException,
      );
    });
  });
});
