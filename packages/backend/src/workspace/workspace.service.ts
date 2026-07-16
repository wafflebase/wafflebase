import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  GoneException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class WorkspaceService {
  constructor(private prisma: PrismaService) {}

  async create(userId: number, data: { name: string }) {
    const slug = await this.generateUniqueSlug(data.name);
    const workspace = await this.prisma.workspace.create({
      data: { name: data.name, slug },
    });
    await this.prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId, role: 'owner' },
    });
    return workspace;
  }

  async findAllByUser(userId: number) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
    });
    return memberships.map((m) => m.workspace);
  }

  /**
   * The user's `(workspaceId, role)` across every workspace they belong to.
   * Lets callers resolve per-workspace ownership without an N+1 of
   * `assertMember` — e.g. the documents list annotating each row with whether
   * the caller may manage (delete/move) it.
   */
  async findMembershipsByUser(userId: number) {
    return this.prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true, role: true },
    });
  }

  async findOne(idOrSlug: string, userId: number) {
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrSlug,
      );
    const workspace = await this.prisma.workspace.findUnique({
      where: isUUID ? { id: idOrSlug } : { slug: idOrSlug },
      include: {
        members: { include: { user: true } },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const isMember = workspace.members.some((m) => m.userId === userId);
    if (!isMember)
      throw new ForbiddenException('Not a member of this workspace');
    return workspace;
  }

  async update(
    workspaceId: string,
    userId: number,
    data: { name?: string; slug?: string },
  ) {
    await this.assertOwner(workspaceId, userId);
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data,
    });
  }

  async remove(workspaceId: string, userId: number) {
    await this.assertOwner(workspaceId, userId);
    const workspaceCount = await this.prisma.workspaceMember.count({
      where: { userId },
    });
    if (workspaceCount <= 1) {
      throw new ForbiddenException('Cannot delete your last workspace');
    }
    return this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  async removeMember(
    workspaceId: string,
    requesterId: number,
    targetUserId: number,
  ) {
    if (requesterId !== targetUserId) {
      await this.assertOwner(workspaceId, requesterId);
    }
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'owner' && requesterId === targetUserId) {
      throw new ForbiddenException('Owner cannot leave their own workspace');
    }
    return this.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
  }

  async createInvite(
    workspaceId: string,
    userId: number,
    data: { role?: string; expiration?: string },
  ) {
    await this.assertOwner(workspaceId, userId);
    const expiresAt = data.expiration
      ? this.parseExpiration(data.expiration)
      : null;
    return this.prisma.workspaceInvite.create({
      data: {
        workspaceId,
        createdBy: userId,
        role: data.role || 'member',
        expiresAt,
      },
    });
  }

  async findInvites(workspaceId: string, userId: number) {
    await this.assertOwner(workspaceId, userId);
    return this.prisma.workspaceInvite.findMany({
      where: { workspaceId },
    });
  }

  async revokeInvite(
    workspaceId: string,
    inviteId: string,
    userId: number,
  ) {
    await this.assertOwner(workspaceId, userId);
    return this.prisma.workspaceInvite.delete({ where: { id: inviteId } });
  }

  async acceptInvite(token: string, userId: number) {
    const invite = await this.prisma.workspaceInvite.findUnique({
      where: { token },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new GoneException('Invite has expired');
    }
    const existing = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: invite.workspaceId, userId },
      },
    });
    // Accepting is idempotent: an already-member is sent to the workspace
    // rather than erroring, so a re-visited invite link just opens it. The
    // invite never changes the role of an existing member.
    if (existing) {
      return { workspaceId: invite.workspaceId };
    }
    try {
      await this.prisma.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          userId,
          role: invite.role,
        },
      });
    } catch (err) {
      // A concurrent accept (double-click, two tabs) can create the row
      // between the check above and here; treat the unique-constraint clash
      // as an idempotent success rather than surfacing a 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { workspaceId: invite.workspaceId };
      }
      throw err;
    }
    return { workspaceId: invite.workspaceId };
  }

  async resolveId(idOrSlug: string): Promise<string> {
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrSlug,
      );
    if (isUUID) return idOrSlug;
    const workspace = await this.prisma.workspace.findUnique({
      where: { slug: idOrSlug },
      select: { id: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace.id;
  }

  async assertMember(workspaceId: string, userId: number) {
    const resolvedId = await this.resolveId(workspaceId);
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: resolvedId, userId } },
    });
    if (!member)
      throw new ForbiddenException('Not a member of this workspace');
    return member;
  }

  async assertOwner(workspaceId: string, userId: number) {
    const resolvedId = await this.resolveId(workspaceId);
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: resolvedId, userId } },
    });
    if (!member || member.role !== 'owner') {
      throw new ForbiddenException(
        'Only workspace owner can perform this action',
      );
    }
    return member;
  }

  private parseExpiration(expiration: string): Date {
    const match = expiration.match(/^(\d+)([hd])$/);
    if (!match) throw new Error('Invalid expiration format');
    const [, value, unit] = match;
    const ms =
      unit === 'h' ? Number(value) * 3600000 : Number(value) * 86400000;
    return new Date(Date.now() + ms);
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    // Names with no ASCII alphanumerics (e.g. all-CJK or emoji) reduce to an
    // empty string, which would produce an unroutable `/w/` slug. Fall back to
    // a neutral base so the slug is always non-empty and well-formed.
    const base = this.generateSlug(name) || 'workspace';
    const existing = await this.prisma.workspace.findUnique({
      where: { slug: base },
    });
    if (!existing) return base;

    const suffix = Math.random().toString(36).slice(2, 6);
    return `${base}-${suffix}`;
  }
}
