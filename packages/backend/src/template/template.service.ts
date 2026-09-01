import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Document as DocumentModel,
  Prisma,
  TemplateListing,
} from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { isDocumentManager } from '../document/document-access';
import { DocumentCopyService } from '../document/document-copy.service';
import { ShareLinkService } from '../share-link/share-link.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { FolderService } from '../folder/folder.service';
import {
  BrowseTemplatesDto,
  PublishTemplateDto,
  UpdateTemplateDto,
  UseTemplateDto,
} from './template.dto';
import { normalizeTags } from './template-taxonomy';

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

  async publish(
    documentId: string,
    userId: number,
    dto: PublishTemplateDto,
  ): Promise<TemplateListingView> {
    const doc = await this.assertManager(documentId, userId);

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
    assertPublishable(visibility);

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
      status: 'listed',
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
    assertPublishable(visibility);

    const updated = await this.prisma.templateListing.update({
      where: { id },
      data: {
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
    return toView(updated, true);
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

    if (listing.shareLinkId) {
      await this.prisma.shareLink.delete({
        where: { id: listing.shareLinkId },
      });
    }
    await this.prisma.templateListing.delete({ where: { id } });
    return { deleted: true };
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
    const where: Prisma.TemplateListingWhereInput = { status: 'listed' };
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
      // The *document's* current workspace, not the listing's denormalized
      // copy — the same rule `isVisibleTo` follows, so a moved document leaves
      // its old workspace's gallery.
      documentWhere.workspaceId = member.workspaceId;
    } else {
      where.visibility = 'public';
    }

    if (dto.type) documentWhere.type = dto.type;
    if (Object.keys(documentWhere).length > 0) where.document = documentWhere;
    if (dto.category) where.category = dto.category;
    if (dto.tag) where.tags = { has: normalizeTags([dto.tag])[0] };
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
    return toView(listing, canManage);
  }

  private async isVisibleTo(
    listing: TemplateListing & { document: DocumentModel },
    userId?: number,
  ): Promise<boolean> {
    if (listing.visibility === 'public') return listing.status === 'listed';
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
 * The `public` tier needs a review pipeline and an explicit license grant
 * before anything may enter it (docs/design/template-gallery.md, Phase 3).
 * Neither exists yet, so publishing there is refused rather than silently
 * downgraded — a publisher who asked for "public" and got "unlisted" would
 * believe their template was in the gallery.
 *
 * `acceptLicense` is already accepted and recorded (`licensedAt`) so a
 * publisher who granted it before Phase 3 lands does not have to re-grant it;
 * it is not yet sufficient on its own.
 */
function assertPublishable(visibility: string): void {
  if (visibility !== 'public') return;
  throw new BadRequestException(
    'The public template gallery is not available yet',
  );
}

function toView(
  listing: ListingWithRelations,
  canManage: boolean,
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
