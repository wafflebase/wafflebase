import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: { documents: true, datasources: true },
  });

  for (const user of users) {
    const slug = user.username
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') + '-s-workspace';
    const workspace = await prisma.workspace.create({
      data: { name: `${user.username}'s Workspace`, slug },
    });

    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: 'owner',
      },
    });

    if (user.documents.length > 0) {
      await prisma.document.updateMany({
        where: { authorID: user.id },
        data: { workspaceId: workspace.id },
      });
    }

    if (user.datasources.length > 0) {
      await prisma.dataSource.updateMany({
        where: { authorID: user.id },
        data: { workspaceId: workspace.id },
      });
    }
  }

  console.log(`Migrated ${users.length} users to personal workspaces.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
