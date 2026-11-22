import { BadRequestException, Injectable } from '@nestjs/common';
import { Folder } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import {
  WebhookEventService,
  writeWithEvents,
} from '../webhook/webhook-event.service';

/**
 * Folder writes emit `folder.created` / `folder.updated` / `folder.deleted`
 * in the write's own transaction, attributed to `actorId`. Deleting a folder
 * reports that folder only: the sub-folders the schema cascades and the
 * documents it `SetNull`s back to the root emit nothing
 * (docs/design/webhooks.md § Event catalog). `actorId` defaults to `null`
 * (no actor) only for the integration suites that call these directly; every
 * route passes the caller.
 */
@Injectable()
export class FolderService {
  constructor(
    private prisma: PrismaService,
    private readonly webhookEvents: WebhookEventService,
  ) {}

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

  create(
    data: {
      name: string;
      workspaceId: string;
      parentId: string | null;
      authorID: number;
    },
    actorId: number | null = null,
  ): Promise<Folder> {
    return writeWithEvents(this.prisma, this.webhookEvents, async (tx) => {
      const folder = await tx.folder.create({ data });
      await this.webhookEvents.emitFolderEvent(tx, {
        type: 'folder.created',
        actor: actorId,
        folder,
      });
      return folder;
    });
  }

  /** A rename or re-parent; an update that changes nothing emits nothing. */
  update(
    id: string,
    data: { name?: string; parentId?: string | null },
    actorId: number | null = null,
  ): Promise<Folder> {
    return writeWithEvents(this.prisma, this.webhookEvents, async (tx) => {
      const before = this.webhookEvents.enabled
        ? await tx.folder.findUnique({ where: { id } })
        : null;
      const folder = await tx.folder.update({ where: { id }, data });
      if (
        before &&
        (before.name !== folder.name || before.parentId !== folder.parentId)
      ) {
        await this.webhookEvents.emitFolderEvent(tx, {
          type: 'folder.updated',
          actor: actorId,
          folder,
        });
      }
      return folder;
    });
  }

  delete(id: string, actorId: number | null = null): Promise<Folder> {
    return writeWithEvents(this.prisma, this.webhookEvents, async (tx) => {
      const folder = await tx.folder.delete({ where: { id } });
      await this.webhookEvents.emitFolderEvent(tx, {
        type: 'folder.deleted',
        actor: actorId,
        folder,
      });
      return folder;
    });
  }

  async assertNoCycle(
    folderId: string,
    newParentId: string | null,
  ): Promise<void> {
    if (newParentId === null) return;
    const visited = new Set<string>();
    let cursor: string | null = newParentId;
    while (cursor) {
      if (cursor === folderId) {
        throw new BadRequestException(
          'Cannot move a folder into itself or one of its descendants',
        );
      }
      if (visited.has(cursor)) break; // defensive: stop on any pre-existing cycle
      visited.add(cursor);
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
