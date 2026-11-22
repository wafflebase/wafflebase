import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ChatBus } from './chat-bus';
import { ChatChannelService } from './chat-channel.service';

const CALLER = 1;
const TARGET = 2;

type Kind = 'public' | 'private' | 'dm';

/**
 * `removeMember` against a hand-rolled Prisma: enough of `resolve`'s
 * channel lookup, the owner check `update` shares, and the delete
 * transaction. The DB-backed behavior (row locks, cascades) is covered by
 * `test/chat.e2e-spec.ts`; this pins the refusals and who may remove.
 */
function setup(
  opts: {
    kind?: Kind;
    createdBy?: number | null;
    isDefault?: boolean;
    workspaceId?: string;
    /** The caller's workspace role; null = not a workspace member. */
    role?: 'owner' | 'member' | null;
    /** The target's workspace role. */
    targetRole?: 'owner' | 'member';
    callerInChannel?: boolean;
    /** Rows the delete removes: 0 = the target is not in the channel. */
    removed?: number;
    /** Members left after the delete. */
    remaining?: number;
  } = {},
) {
  const {
    kind = 'public',
    createdBy = CALLER,
    isDefault = false,
    workspaceId = 'w1',
    role = 'member',
    targetRole = 'member',
    callerInChannel = true,
    removed = 1,
    remaining = 1,
  } = opts;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    chatChannelMember: {
      deleteMany: jest.fn().mockResolvedValue({ count: removed }),
      count: jest.fn().mockResolvedValue(remaining),
    },
  };
  const prisma = {
    chatChannel: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        workspaceId,
        kind,
        name: kind === 'dm' ? null : 'room',
        topic: null,
        createdBy,
        archivedAt: null,
        lastSeq: 0n,
        dmKey: null,
        defaultKey: isDefault ? workspaceId : null,
        lastMessageAt: null,
        createdAt: new Date(),
        workspace: {
          slug: 'team',
          members: role ? [{ userId: CALLER, role }] : [],
        },
        members: callerInChannel ? [{ userId: CALLER }] : [],
      }),
    },
    workspaceMember: {
      findUnique: jest.fn(
        ({ where }: { where: { workspaceId_userId: { userId: number } } }) =>
          Promise.resolve(
            where.workspaceId_userId.userId === CALLER
              ? role
                ? { role }
                : null
              : { role: targetRole },
          ),
      ),
    },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const bus = { notifyMembership: jest.fn().mockResolvedValue(undefined) };
  const service = new ChatChannelService(
    prisma as unknown as PrismaService,
    bus as unknown as ChatBus,
  );
  const remove = (target = TARGET, workspace = 'w1') =>
    service.removeMember(CALLER, 'c1', target, workspace);
  return { service, prisma, tx, bus, remove };
}

describe('ChatChannelService.removeMember', () => {
  describe('who may remove', () => {
    it("lets a public channel's creator remove a member", async () => {
      const { remove, tx, bus } = setup({ createdBy: CALLER });
      await remove();
      expect(tx.chatChannelMember.deleteMany).toHaveBeenCalledWith({
        where: { channelId: 'c1', userId: TARGET },
      });
      expect(bus.notifyMembership).toHaveBeenCalledWith('c1');
    });

    it('lets a workspace owner remove from a public channel they did not create, or are not in', async () => {
      const { remove, tx } = setup({
        createdBy: 99,
        role: 'owner',
        callerInChannel: false,
      });
      await remove();
      expect(tx.chatChannelMember.deleteMany).toHaveBeenCalled();
    });

    it('refuses a plain member of a public channel they did not create', async () => {
      const { remove, tx, bus } = setup({ createdBy: 99, role: 'member' });
      await expect(remove()).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.chatChannelMember.deleteMany).not.toHaveBeenCalled();
      expect(bus.notifyMembership).not.toHaveBeenCalled();
    });

    it("lets a private channel's creator remove a member, under the row lock", async () => {
      const { remove, tx } = setup({ kind: 'private', createdBy: CALLER });
      await remove();
      // The row is locked so a concurrent leave cannot empty the channel.
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.chatChannelMember.deleteMany).toHaveBeenCalled();
    });

    it('refuses a plain member of a private channel, though they may archive it', async () => {
      const { remove, tx } = setup({
        kind: 'private',
        createdBy: 99,
        role: 'member',
      });
      await expect(remove()).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.chatChannelMember.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses a creator removing a workspace owner', async () => {
      const { remove, tx } = setup({ createdBy: CALLER, targetRole: 'owner' });
      await expect(remove()).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.chatChannelMember.deleteMany).not.toHaveBeenCalled();
    });

    it('lets a workspace owner remove another owner', async () => {
      const { remove, tx } = setup({
        createdBy: 99,
        role: 'owner',
        targetRole: 'owner',
      });
      await remove();
      expect(tx.chatChannelMember.deleteMany).toHaveBeenCalled();
    });
  });

  describe('refusals', () => {
    it('404s a channel the caller cannot read', async () => {
      const { remove } = setup({ kind: 'private', callerInChannel: false });
      await expect(remove()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s a channel outside the route workspace', async () => {
      const { remove } = setup();
      await expect(remove(TARGET, 'elsewhere')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s a caller outside the workspace', async () => {
      const { remove } = setup({ role: null });
      await expect(remove()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a DM, whose member set is its identity', async () => {
      const { remove, tx } = setup({ kind: 'dm' });
      await expect(remove()).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.chatChannelMember.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses the default channel, even for an owner', async () => {
      const { remove, tx } = setup({ isDefault: true, role: 'owner' });
      await expect(remove()).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.chatChannelMember.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses removing yourself, which is leaving', async () => {
      const { remove, tx } = setup();
      await expect(remove(CALLER)).rejects.toThrow(/members\/me/);
      expect(tx.chatChannelMember.deleteMany).not.toHaveBeenCalled();
    });

    it('404s a target who is not in the channel, and announces nothing', async () => {
      const { remove, bus } = setup({ removed: 0 });
      await expect(remove()).rejects.toThrow(/not in this channel/);
      expect(bus.notifyMembership).not.toHaveBeenCalled();
    });

    it('refuses emptying a private channel', async () => {
      const { remove, bus } = setup({ kind: 'private', remaining: 0 });
      await expect(remove()).rejects.toBeInstanceOf(ConflictException);
      expect(bus.notifyMembership).not.toHaveBeenCalled();
    });
  });

  it('still succeeds when the membership notify fails, as leave does', async () => {
    const { remove, bus } = setup();
    bus.notifyMembership.mockRejectedValue(new Error('bus down'));
    await expect(remove()).resolves.toBeUndefined();
  });
});
