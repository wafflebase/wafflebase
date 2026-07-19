import { BadRequestException, Injectable } from '@nestjs/common';
import { Folder } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class FolderService {
  constructor(private prisma: PrismaService) {}

  listByWorkspace(workspaceId: string) {
    return this.prisma.folder.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        parentId: true,
        authorID: true,
        createdAt: true,
      },
    });
  }

  getById(id: string): Promise<Folder | null> {
    return this.prisma.folder.findUnique({ where: { id } });
  }

  create(data: {
    name: string;
    workspaceId: string;
    parentId: string | null;
    authorID: number;
  }): Promise<Folder> {
    return this.prisma.folder.create({ data });
  }

  update(
    id: string,
    data: { name?: string; parentId?: string | null },
  ): Promise<Folder> {
    return this.prisma.folder.update({ where: { id }, data });
  }

  delete(id: string): Promise<Folder> {
    return this.prisma.folder.delete({ where: { id } });
  }

  async assertNoCycle(
    folderId: string,
    newParentId: string | null,
  ): Promise<void> {
    if (newParentId === null) return;
    let cursor: string | null = newParentId;
    while (cursor) {
      if (cursor === folderId) {
        throw new BadRequestException(
          'Cannot move a folder into itself or one of its descendants',
        );
      }
      const parent: { parentId: string | null } | null =
        await this.prisma.folder.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
    }
  }

  async assertSameWorkspace(
    folderId: string,
    workspaceId: string,
  ): Promise<void> {
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
      select: { workspaceId: true },
    });
    if (!folder || folder.workspaceId !== workspaceId) {
      throw new BadRequestException('Folder must belong to the same workspace');
    }
  }
}
