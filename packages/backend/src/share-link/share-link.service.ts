import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  GoneException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';

const SHARE_LINK_ROLES = ['viewer', 'editor'] as const;
type ShareLinkRole = (typeof SHARE_LINK_ROLES)[number];

/**
 * The caller's authority over a document's share links, resolved once so
 * create / list / delete share the same source of truth.
 *
 * `isManager` (workspace owner or document author) is the single privilege
 * tier that today governs both minting editor links and revoking links the
 * caller did not create — see docs/design/sharing.md. Plain members have
 * document access (guaranteed by `resolveCapability` throwing otherwise) but
 * are not managers.
 */
interface ShareCapability {
  isManager: boolean;
}

@Injectable()
export class ShareLinkService {
  constructor(private prisma: PrismaService) {}

  /**
   * Resolve the caller's share-link authority for a document, throwing if the
   * caller has no access at all (neither a workspace member nor the author).
   *
   * Access follows the workspace model (see docs/design/sharing.md): every
   * workspace member has `rw` on the document, so any member may create viewer
   * links; only the workspace owner or the document author (`isManager`) may
   * create editor links or manage links they did not create.
   *
   * Queries `workspaceMember` directly rather than via `WorkspaceService`: we
   * pass the already-canonical `doc.workspaceId` (no slug resolution needed)
   * and require a non-throwing lookup so the author-but-not-member case still
   * resolves — neither of which `assertMember` provides.
   */
  private async resolveCapability(
    documentId: string,
    userId: number,
  ): Promise<ShareCapability> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: doc.workspaceId, userId } },
    });

    const isAuthor = doc.authorID === userId;
    if (membership === null && !isAuthor) {
      throw new ForbiddenException('You do not have access to this document');
    }

    return { isManager: membership?.role === 'owner' || isAuthor };
  }

  async create(
    documentId: string,
    role: string,
    createdBy: number,
    expiresAt: Date | null,
  ) {
    if (!SHARE_LINK_ROLES.includes(role as ShareLinkRole)) {
      throw new BadRequestException(
        `Invalid share link role: ${role}. Expected 'viewer' or 'editor'.`,
      );
    }

    // Access is enforced here; a plain member reaching this point may create
    // viewer links, but only a manager may mint an editor (write) link.
    const { isManager } = await this.resolveCapability(documentId, createdBy);
    if (role === 'editor' && !isManager) {
      throw new ForbiddenException(
        'Only the workspace owner or document owner can create editor links',
      );
    }

    return this.prisma.shareLink.create({
      data: {
        role,
        documentId,
        createdBy,
        expiresAt,
      },
    });
  }

  async findByToken(token: string) {
    const link = await this.prisma.shareLink.findUnique({
      where: { token },
      include: { document: true },
    });

    if (!link) {
      throw new NotFoundException('Share link not found');
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new GoneException('Share link has expired');
    }

    return link;
  }

  async findByDocument(documentId: string, userId: number) {
    const { isManager } = await this.resolveCapability(documentId, userId);

    const links = await this.prisma.shareLink.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    });

    // A plain member cannot mint editor links, so they must not be handed an
    // existing editor token either (they could copy and redistribute it,
    // escalating anonymous write access they were never allowed to grant).
    const visible = isManager
      ? links
      : links.filter((link) => link.role !== 'editor');

    return {
      links: visible.map((link) => ({
        ...link,
        canDelete: isManager || link.createdBy === userId,
      })),
      permissions: {
        canCreateEditorLink: isManager,
      },
    };
  }

  async delete(id: string, userId: number) {
    const link = await this.prisma.shareLink.findUnique({
      where: { id },
    });
    if (!link) {
      throw new NotFoundException('Share link not found');
    }

    // A link's creator may always revoke it, even after leaving the workspace.
    if (link.createdBy === userId) {
      return this.prisma.shareLink.delete({ where: { id } });
    }

    const { isManager } = await this.resolveCapability(link.documentId, userId);
    if (!isManager) {
      throw new ForbiddenException(
        'You can only revoke share links you created',
      );
    }

    return this.prisma.shareLink.delete({
      where: { id },
    });
  }
}
