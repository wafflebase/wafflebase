import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  GoneException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class WorkspaceService {
  constructor(private prisma: PrismaService) {}

  async create(userId: number, data: { name: string }) {
    const workspace = await this.prisma.workspace.create({
      data: { name: data.name },
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

  async findOne(workspaceId: string, userId: number) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
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

  async update(workspaceId: string, userId: number, data: { name?: string }) {
    await this.assertOwner(workspaceId, userId);
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data,
    });
  }

  async remove(workspaceId: string, userId: number) {
    await this.assertOwner(workspaceId, userId);
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
    if (existing) throw new ConflictException('Already a member');
    await this.prisma.workspaceMember.create({
      data: {
        workspaceId: invite.workspaceId,
        userId,
        role: invite.role,
      },
    });
    return { workspaceId: invite.workspaceId };
  }

  async assertMember(workspaceId: string, userId: number) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member)
      throw new ForbiddenException('Not a member of this workspace');
    return member;
  }

  private async assertOwner(workspaceId: string, userId: number) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
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
}
