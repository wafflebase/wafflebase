import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/database/prisma.service';
import { YorkieService } from 'src/yorkie/yorkie.service';
import { YorkieAdminService } from 'src/yorkie/yorkie-admin.service';
import { FileService } from 'src/file/file.service';
import * as cookieParser from 'cookie-parser';
import {
  applyGlobalBootstrap,
  describeDb,
  clearDatabase,
  createUserFactory,
  createWorkspace,
  setIntegrationEnvDefaults,
  setAuthEnvDefaults,
} from './helpers/integration-helpers';

describeDb('GET /documents/:id/file (member OR share token)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let fileService: FileService;
  let createUser: ReturnType<typeof createUserFactory>;

  function authCookie(user: {
    id: number;
    username: string;
    email: string;
    photo: string | null;
  }) {
    const token = jwtService.sign(
      {
        sub: user.id,
        username: user.username,
        email: user.email,
        photo: user.photo,
      },
      {
        secret: process.env.JWT_SECRET!,
        expiresIn: '1h',
      },
    );

    return `wafflebase_session=${token}`;
  }

  beforeAll(async () => {
    setIntegrationEnvDefaults();
    setAuthEnvDefaults();

    const yorkieStub = {
      onModuleInit: () => Promise.resolve(),
      onModuleDestroy: () => Promise.resolve(),
      withDocument: () => Promise.resolve(null),
    };

    // In-memory FileService stub. This suite verifies the access gate (member
    // OR valid share token) on the serving endpoint, not S3 plumbing — and CI
    // integration runs Postgres + Yorkie but no MinIO/S3. Stubbing keeps every
    // permission assertion real without a blob backend. `upload` returns a
    // `VALID_FILE_ID_PATTERN`-shaped id; `getObject` streams fixed PDF bytes.
    const fileStub = {
      onModuleInit: () => Promise.resolve(),
      onModuleDestroy: () => Promise.resolve(),
      upload: (): Promise<{ id: string }> =>
        Promise.resolve({ id: `${randomUUID()}.pdf` }),
      getObject: (): Promise<{ body: Uint8Array; contentType: string }> =>
        Promise.resolve({
          body: new Uint8Array(PDF_BYTES),
          contentType: 'application/pdf',
        }),
      delete: () => Promise.resolve(),
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
      .overrideProvider(FileService)
      .useValue(fileStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    applyGlobalBootstrap(app);
    await app.init();

    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);
    fileService = moduleRef.get(FileService);
    createUser = createUserFactory(prisma, 'filesrv');
    await prisma.$connect();
  });

  afterAll(async () => {
    await clearDatabase(prisma);
    await app.close();
    await moduleRef.close();
  });

  // Minimal PDF byte content; the endpoint only cares that an object exists
  // in the blob store for the document's `fileId`.
  const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF');

  let owner: Awaited<ReturnType<typeof createUser>>;
  let member: Awaited<ReturnType<typeof createUser>>;
  let nonMember: Awaited<ReturnType<typeof createUser>>;
  let pdfDocId: string;
  let otherPdfDocId: string;
  let validToken: string;
  let expiredToken: string;

  beforeEach(async () => {
    await clearDatabase(prisma);

    owner = await createUser();
    member = await createUser();
    nonMember = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: member.id, role: 'member' },
    });

    const { id: fileId } = await fileService.upload(
      PDF_BYTES,
      'application/pdf',
    );
    const pdfDoc = await prisma.document.create({
      data: {
        title: 'Shared PDF',
        type: 'pdf',
        fileId,
        authorID: owner.id,
        workspaceId: workspace.id,
      },
    });
    pdfDocId = pdfDoc.id;

    // A second workspace + PDF document so we can prove a valid token scoped
    // to `pdfDocId` is rejected when presented against a different document.
    const otherOwner = await createUser();
    const otherWorkspace = await createWorkspace(prisma, otherOwner.id);
    const { id: otherFileId } = await fileService.upload(
      PDF_BYTES,
      'application/pdf',
    );
    const otherPdfDoc = await prisma.document.create({
      data: {
        title: 'Other PDF',
        type: 'pdf',
        fileId: otherFileId,
        authorID: otherOwner.id,
        workspaceId: otherWorkspace.id,
      },
    });
    otherPdfDocId = otherPdfDoc.id;

    const validLink = await prisma.shareLink.create({
      data: {
        role: 'viewer',
        documentId: pdfDocId,
        createdBy: owner.id,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    validToken = validLink.token;

    const expiredLink = await prisma.shareLink.create({
      data: {
        role: 'viewer',
        documentId: pdfDocId,
        createdBy: owner.id,
        expiresAt: new Date(Date.now() - 3600_000),
      },
    });
    expiredToken = expiredLink.token;
  });

  it('serves the PDF to a workspace member (JWT)', async () => {
    await request(app.getHttpServer())
      .get(`/documents/${pdfDocId}/file`)
      .set('Cookie', authCookie(member))
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
  });

  it('serves the PDF for a valid unexpired share token (anonymous)', async () => {
    await request(app.getHttpServer())
      .get(`/documents/${pdfDocId}/file?token=${validToken}`)
      .expect(200);
  });

  it('rejects an expired share token', async () => {
    await request(app.getHttpServer())
      .get(`/documents/${pdfDocId}/file?token=${expiredToken}`)
      .expect(410);
  });

  it('rejects a token whose documentId differs from :id', async () => {
    await request(app.getHttpServer())
      .get(`/documents/${otherPdfDocId}/file?token=${validToken}`)
      .expect(403);
  });

  it('rejects an anonymous request with no token', async () => {
    await request(app.getHttpServer())
      .get(`/documents/${pdfDocId}/file`)
      .expect(403);
  });

  it('rejects a non-member with no token', async () => {
    await request(app.getHttpServer())
      .get(`/documents/${pdfDocId}/file`)
      .set('Cookie', authCookie(nonMember))
      .expect(403);
  });
});
