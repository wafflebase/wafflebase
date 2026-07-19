import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/database/prisma.service';
import { YorkieService } from 'src/yorkie/yorkie.service';
import { YorkieAdminService } from 'src/yorkie/yorkie-admin.service';
import { FolderService } from 'src/folder/folder.service';
import {
  applyGlobalBootstrap,
  describeDb,
  clearDatabase,
  createUserFactory,
  createWorkspace,
  setIntegrationEnvDefaults,
  setAuthEnvDefaults,
} from './helpers/integration-helpers';

describeDb('FolderService integration (Prisma-backed)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let folderService: FolderService;
  let createUser: ReturnType<typeof createUserFactory>;

  let userId: number;
  let workspaceId: string;

  beforeAll(async () => {
    setIntegrationEnvDefaults();
    setAuthEnvDefaults();

    const yorkieStub = {
      onModuleInit: () => Promise.resolve(),
      onModuleDestroy: () => Promise.resolve(),
      withDocument: () => Promise.resolve(null),
    };

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(YorkieService)
      .useValue(yorkieStub)
      .overrideProvider(YorkieAdminService)
      .useValue({
        getEditors: async () => new Map(),
        getSummaries: async () => new Map(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    applyGlobalBootstrap(app);
    await app.init();

    prisma = moduleRef.get(PrismaService);
    folderService = moduleRef.get(FolderService);
    createUser = createUserFactory(prisma, 'folder');
    await prisma.$connect();
  });

  beforeEach(async () => {
    await clearDatabase(prisma);

    const user = await createUser();
    const workspace = await createWorkspace(prisma, user.id);
    userId = user.id;
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    await clearDatabase(prisma);
    await app.close();
    await moduleRef.close();
  });

  it('rejects moving a folder into its own descendant', async () => {
    const a = await folderService.create({
      name: 'A',
      workspaceId,
      parentId: null,
      authorID: userId,
    });
    const b = await folderService.create({
      name: 'B',
      workspaceId,
      parentId: a.id,
      authorID: userId,
    });
    await expect(folderService.assertNoCycle(a.id, b.id)).rejects.toThrow();
  });

  it('deleting a parent folder returns its documents to the workspace root', async () => {
    const f = await folderService.create({
      name: 'F',
      workspaceId,
      parentId: null,
      authorID: userId,
    });
    const doc = await prisma.document.create({
      data: { title: 'D', workspaceId, authorID: userId, folderId: f.id },
    });
    await folderService.delete(f.id);
    const after = await prisma.document.findUnique({ where: { id: doc.id } });
    expect(after?.folderId).toBeNull();
  });

  it('cascade-deletes descendant folders', async () => {
    const a = await folderService.create({
      name: 'A',
      workspaceId,
      parentId: null,
      authorID: userId,
    });
    const b = await folderService.create({
      name: 'B',
      workspaceId,
      parentId: a.id,
      authorID: userId,
    });
    await folderService.delete(a.id);
    expect(await prisma.folder.findUnique({ where: { id: b.id } })).toBeNull();
  });
});
