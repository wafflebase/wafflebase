import { PrismaService } from 'src/database/prisma.service';
import {
  clearDatabase,
  createUserFactory,
  createWorkspace,
  describeDb,
  setIntegrationEnvDefaults,
} from './helpers/integration-helpers';

/**
 * Workspace chat against a real database. The schema cases prove the
 * cascades the design depends on: a workspace takes its whole chat with it,
 * while a deleted user's messages stay, attributed to nobody.
 */
describeDb('Chat integration', () => {
  let prisma: PrismaService;
  let createUser: ReturnType<typeof createUserFactory>;

  beforeAll(async () => {
    setIntegrationEnvDefaults();
    prisma = new PrismaService();
    createUser = createUserFactory(prisma, 'chat');
    await prisma.$connect();
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
  });

  afterAll(async () => {
    await clearDatabase(prisma);
    await prisma.$disconnect();
  });

  /** A public channel with one member and one message by `author`. */
  async function channelWithMessage(workspaceId: string, authorId: number) {
    const channel = await prisma.chatChannel.create({
      data: {
        workspaceId,
        kind: 'public',
        name: 'general',
        createdBy: authorId,
        lastSeq: 1,
        members: { create: { userId: authorId } },
      },
    });
    const message = await prisma.chatMessage.create({
      data: { channelId: channel.id, seq: 1, authorId, body: 'hello' },
    });
    return { channel, message };
  }

  describe('schema', () => {
    it('cascades: deleting a workspace removes its channels, members and messages', async () => {
      const owner = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      const { channel } = await channelWithMessage(workspace.id, owner.id);

      await prisma.workspace.delete({ where: { id: workspace.id } });

      expect(
        await prisma.chatChannel.count({ where: { id: channel.id } }),
      ).toBe(0);
      expect(
        await prisma.chatChannelMember.count({
          where: { channelId: channel.id },
        }),
      ).toBe(0);
      expect(
        await prisma.chatMessage.count({ where: { channelId: channel.id } }),
      ).toBe(0);
    });

    it('deleting a user keeps their messages with authorId null', async () => {
      const owner = await createUser();
      const author = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: author.id, role: 'member' },
      });
      const { channel, message } = await channelWithMessage(
        workspace.id,
        author.id,
      );

      await prisma.workspaceMember.deleteMany({ where: { userId: author.id } });
      await prisma.user.delete({ where: { id: author.id } });

      const kept = await prisma.chatMessage.findUnique({
        where: { id: message.id },
      });
      expect(kept).not.toBeNull();
      expect(kept!.authorId).toBeNull();
      expect(kept!.body).toBe('hello');
      // The membership goes with the user; the channel stays.
      expect(
        await prisma.chatChannelMember.count({
          where: { channelId: channel.id },
        }),
      ).toBe(0);
      expect(
        await prisma.chatChannel.count({ where: { id: channel.id } }),
      ).toBe(1);
    });
  });
});
