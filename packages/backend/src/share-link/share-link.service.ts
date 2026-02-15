import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class ShareLinkService {
  constructor(private prisma: PrismaService) {}

  async create(documentId: string, role: string, createdBy: number, expiresAt: Date | null) {
    // Verify document exists and user owns it
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    if (doc.authorID !== createdBy) {
      throw new ForbiddenException('Only the document owner can create share links');
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
    // Verify document exists and user owns it
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    if (doc.authorID !== userId) {
      throw new ForbiddenException('Only the document owner can view share links');
    }

    return this.prisma.shareLink.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async delete(id: string, userId: number) {
    const link = await this.prisma.shareLink.findUnique({
      where: { id },
    });
    if (!link) {
      throw new NotFoundException('Share link not found');
    }
    if (link.createdBy !== userId) {
      throw new ForbiddenException('Only the creator can delete this share link');
    }

    return this.prisma.shareLink.delete({
      where: { id },
    });
  }
}
