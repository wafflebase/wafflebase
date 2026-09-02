import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/database/prisma.service';
import { YorkieService } from 'src/yorkie/yorkie.service';
import { YorkieAdminService } from 'src/yorkie/yorkie-admin.service';
import {
  applyGlobalBootstrap,
  describeDb,
  clearDatabase,
  createUserFactory,
  createWorkspace,
  setIntegrationEnvDefaults,
  setAuthEnvDefaults,
} from './helpers/integration-helpers';

type TestUser = {
  id: number;
  username: string;
  email: string;
  photo: string | null;
};

/**
 * The template gallery through the HTTP layer
 * (docs/design/template-gallery.md).
 *
 * `template.service.spec.ts` already covers the authorization matrix against
 * mocks. What only this suite can show is what survives the round trip: that
 * the guards and the global `ValidationPipe` are actually wired onto these
 * routes, that a listing's side effects reach Postgres (a real `ShareLink` row
 * appears at publish and is gone after unpublish), and that the serialized
 * collection response carries no `previewToken` — a leak no mock can catch,
 * because the field is removed by construction in a function the mocks call.
 */
describeDb('Template gallery (HTTP, Prisma-backed)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let createUser: ReturnType<typeof createUserFactory>;

  let owner: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let outsiderWorkspaceId: string;
  let documentId: string;

  /**
   * The Yorkie root every attach in this suite sees. Mutable so a test can
   * give the document a `datasource` tab; reset to empty in `beforeEach`, and
   * an empty root is also what makes the copy path a no-op.
   */
  let yorkieRoot: Record<string, unknown>;

  function authCookie(u: TestUser) {
    const token = jwtService.sign(
      {
        tokenType: 'access',
        sub: u.id,
        username: u.username,
        email: u.email,
        photo: u.photo,
      },
      { secret: process.env.JWT_SECRET!, expiresIn: '1h' },
    );
    return `wafflebase_session=${token}`;
  }

  /** Publish `documentId` as `owner`, returning the listing body. */
  async function publish(
    body: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    const res = await request(app.getHttpServer())
      .post(`/documents/${documentId}/template`)
      .set('Cookie', authCookie(owner))
      .send(body)
      .expect(201);
    return res.body as Record<string, any>;
  }

  beforeAll(async () => {
    setIntegrationEnvDefaults();
    setAuthEnvDefaults();

    const yorkieStub = {
      onModuleInit: () => Promise.resolve(),
      onModuleDestroy: () => Promise.resolve(),
      // Invokes the callback rather than resolving a constant, so the
      // publish-time tab scan and the copy service's root snapshot both run
      // their real code against `yorkieRoot`.
      withDocument: (_id: string, cb: (doc: unknown) => unknown) =>
        Promise.resolve(
          cb({
            getRoot: () => yorkieRoot,
            toJSON: () => JSON.stringify(yorkieRoot),
            update: (fn: (root: Record<string, unknown>) => void) => fn({}),
          }),
        ),
    };

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YorkieService)
      .useValue(yorkieStub)
      .overrideProvider(YorkieAdminService)
      .useValue({
        getEditors: () => Promise.resolve(new Map()),
        getSummaries: () => Promise.resolve(new Map()),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    applyGlobalBootstrap(app);
    await app.init();

    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);
    createUser = createUserFactory(prisma, 'template');
    await prisma.$connect();
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
    yorkieRoot = {};

    owner = await createUser();
    outsider = await createUser();
    workspaceId = (await createWorkspace(prisma, owner.id)).id;
    outsiderWorkspaceId = (await createWorkspace(prisma, outsider.id)).id;
    documentId = (
      await prisma.document.create({
        data: {
          title: 'Weekly Report',
          type: 'sheet',
          workspaceId,
          authorID: owner.id,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await clearDatabase(prisma);
    await app.close();
    await moduleRef.close();
  });

  describe('publish', () => {
    it('mints a non-expiring viewer share link and returns its token', async () => {
      const listing = await publish({ visibility: 'workspace' });

      expect(listing.previewToken).toEqual(expect.any(String));
      const link = await prisma.shareLink.findUnique({
        where: { token: listing.previewToken },
      });
      expect(link).toMatchObject({ documentId, role: 'viewer' });
      expect(link?.expiresAt).toBeNull();
    });

    it('re-publishing reuses the same listing and the same link', async () => {
      const first = await publish({ visibility: 'unlisted' });
      const second = await publish({ visibility: 'workspace' });

      expect(second.id).toBe(first.id);
      expect(second.previewToken).toBe(first.previewToken);
      expect(await prisma.shareLink.count({ where: { documentId } })).toBe(1);
    });

    it('refuses a document connected to external data with 400', async () => {
      // The tab references a workspace-scoped connection row, so the copy a
      // template makes in someone else's workspace would open it empty.
      yorkieRoot = {
        tabOrder: ['t1'],
        tabs: { t1: { name: 'Orders', type: 'datasource' } },
      };
      const res = await request(app.getHttpServer())
        .post(`/documents/${documentId}/template`)
        .set('Cookie', authCookie(owner))
        .send({})
        .expect(400);
      expect(res.body.message).toContain('Orders');
      expect(await prisma.templateListing.count()).toBe(0);
    });

    it('refuses the public tier with 400', async () => {
      // Permanently, not "until Phase 3": `visibility: 'public'` has exactly
      // one writer, the approve arm of `POST /templates/:id/review`. No
      // request body ever reaches it.
      await request(app.getHttpServer())
        .post(`/documents/${documentId}/template`)
        .set('Cookie', authCookie(owner))
        .send({ visibility: 'public', acceptLicense: true })
        .expect(400);
    });

    it('refuses a non-member with 403 and an anonymous caller with 401', async () => {
      await request(app.getHttpServer())
        .post(`/documents/${documentId}/template`)
        .set('Cookie', authCookie(outsider))
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        .post(`/documents/${documentId}/template`)
        .send({})
        .expect(401);
    });

    it('rejects an unknown field, so the ValidationPipe is really wired', async () => {
      await request(app.getHttpServer())
        .post(`/documents/${documentId}/template`)
        .set('Cookie', authCookie(owner))
        .send({ visibility: 'workspace', status: 'listed' })
        .expect(400);
    });
  });

  describe('browse', () => {
    it('never returns a previewToken on a card', async () => {
      // A page of cards would otherwise hand out a page of non-expiring read
      // capabilities.
      await publish({ visibility: 'workspace' });
      const res = await request(app.getHttpServer())
        .get(`/templates?scope=workspace&workspaceId=${workspaceId}`)
        .set('Cookie', authCookie(owner))
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).not.toHaveProperty('previewToken');
    });

    it('omits unlisted listings from every collection', async () => {
      await publish({ visibility: 'unlisted' });
      const res = await request(app.getHttpServer())
        .get(`/templates?scope=workspace&workspaceId=${workspaceId}`)
        .set('Cookie', authCookie(owner))
        .expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('refuses another workspace to a non-member', async () => {
      await publish({ visibility: 'workspace' });
      await request(app.getHttpServer())
        .get(`/templates?scope=workspace&workspaceId=${workspaceId}`)
        .set('Cookie', authCookie(outsider))
        .expect(403);
    });

    it('serves the public scope anonymously, and it is empty', async () => {
      // Empty because nothing in this suite has been approved — the tier is
      // open, but a listing only becomes public through review.
      // so the route must answer rather than 401 — with no rows.
      await publish({ visibility: 'workspace' });
      const res = await request(app.getHttpServer())
        .get('/templates?scope=public')
        .expect(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
    });

    it('requires a scope', async () => {
      // There is deliberately no scope value that selects `unlisted`, so
      // defaulting an absent one would have to pick a tier on the caller's
      // behalf. It refuses instead.
      await request(app.getHttpServer()).get('/templates').expect(400);
    });
  });

  describe('find and use', () => {
    it('serves an unlisted listing to an anonymous visitor', async () => {
      // Holding the id is the whole access story for this tier: it is what
      // makes `/t/:id` render before sign-in.
      const listing = await publish({ visibility: 'unlisted' });
      const res = await request(app.getHttpServer())
        .get(`/templates/${listing.id}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id: listing.id,
        previewToken: listing.previewToken,
        canManage: false,
      });
    });

    it('404s a workspace listing for someone outside the workspace', async () => {
      // Not 403: whether a workspace has published a template is itself
      // workspace information.
      const listing = await publish({ visibility: 'workspace' });
      await request(app.getHttpServer())
        .get(`/templates/${listing.id}`)
        .set('Cookie', authCookie(outsider))
        .expect(404);
    });

    it('copies into the destination workspace and counts the use', async () => {
      const listing = await publish({ visibility: 'unlisted' });
      const res = await request(app.getHttpServer())
        .post(`/templates/${listing.id}/use`)
        .set('Cookie', authCookie(outsider))
        .send({ workspaceId: outsiderWorkspaceId })
        .expect(201);

      expect(res.body).toMatchObject({
        title: 'Weekly Report',
        type: 'sheet',
        workspaceId: outsiderWorkspaceId,
        authorID: outsider.id,
      });
      expect(res.body.id).not.toBe(documentId);
      const after = await prisma.templateListing.findUnique({
        where: { id: listing.id },
      });
      expect(after?.useCount).toBe(1);
    });

    it('refuses a destination workspace the caller does not belong to', async () => {
      // Read authority comes from the listing; write authority from membership
      // of the destination.
      const listing = await publish({ visibility: 'unlisted' });
      await request(app.getHttpServer())
        .post(`/templates/${listing.id}/use`)
        .set('Cookie', authCookie(outsider))
        .send({ workspaceId })
        .expect(403);
      expect(await prisma.document.count({ where: { workspaceId } })).toBe(1);
    });
  });

  describe('unpublish', () => {
    it('removes the listing and its preview link, keeping the document', async () => {
      const listing = await publish({ visibility: 'workspace' });
      await request(app.getHttpServer())
        .delete(`/templates/${listing.id}`)
        .set('Cookie', authCookie(owner))
        .expect(200);

      expect(await prisma.templateListing.count()).toBe(0);
      expect(await prisma.shareLink.count({ where: { documentId } })).toBe(0);
      expect(
        await prisma.document.findUnique({ where: { id: documentId } }),
      ).not.toBeNull();
    });

    it('lets a workspace owner withdraw a listing another member published', async () => {
      // The manager tier is "workspace owner OR document author", so an owner
      // can withdraw anything published from their workspace.
      const member = await createUser();
      await prisma.workspaceMember.create({
        data: { workspaceId, userId: member.id, role: 'member' },
      });
      const memberDoc = await prisma.document.create({
        data: {
          title: 'Their Doc',
          type: 'sheet',
          workspaceId,
          authorID: member.id,
        },
      });
      const listing = await request(app.getHttpServer())
        .post(`/documents/${memberDoc.id}/template`)
        .set('Cookie', authCookie(member))
        .send({ visibility: 'workspace' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/templates/${listing.body.id}`)
        .set('Cookie', authCookie(owner))
        .expect(200);
      expect(await prisma.templateListing.count()).toBe(0);
    });

    it('deleting the document takes its listing with it', async () => {
      // The `Cascade` on `documentId` is what keeps a dead card out of the
      // gallery.
      await publish({ visibility: 'workspace' });
      await prisma.document.delete({ where: { id: documentId } });
      expect(await prisma.templateListing.count()).toBe(0);
    });
  });
  describe('reports', () => {
    it('refuses a report on a listing that is not public', async () => {
      // A report routes the listing to the global reviewer allowlist with its
      // preview token; a workspace or unlisted listing has its own trust
      // boundary and does not go there.
      const listing = await publish({ visibility: 'unlisted' });
      await request(app.getHttpServer())
        .post(`/templates/${listing.id}/report`)
        .set('Cookie', authCookie(outsider))
        .send({ reason: 'spam' })
        .expect(404);
      expect(await prisma.templateReport.count()).toBe(0);
    });

    it('refuses an anonymous reporter', async () => {
      const listing = await publish();
      await request(app.getHttpServer())
        .post(`/templates/${listing.id}/report`)
        .send({ reason: 'spam' })
        .expect(401);
    });

    it('refuses a reason outside the closed list', async () => {
      const listing = await publish();
      await request(app.getHttpServer())
        .post(`/templates/${listing.id}/report`)
        .set('Cookie', authCookie(outsider))
        .send({ reason: 'because-i-said-so' })
        .expect(400);
    });

    it('gates the reviewer queue on the allowlist', async () => {
      // Nobody is on it in this suite's environment, so every reviewer route
      // refuses — which is the direction an unconfigured deployment must fail
      // in.
      await request(app.getHttpServer())
        .get('/admin/templates/reports')
        .set('Cookie', authCookie(owner))
        .expect(403);
      await request(app.getHttpServer())
        .get('/admin/templates/review')
        .set('Cookie', authCookie(owner))
        .expect(403);
    });
  });

  describe('submitting for the public tier', () => {
    it('refuses without the license grant', async () => {
      const listing = await publish();
      await request(app.getHttpServer())
        .post(`/templates/${listing.id}/submit`)
        .set('Cookie', authCookie(owner))
        .send({ acceptLicense: false })
        .expect(400);
    });

    it('refuses a plain member', async () => {
      const listing = await publish();
      await request(app.getHttpServer())
        .post(`/templates/${listing.id}/submit`)
        .set('Cookie', authCookie(outsider))
        .send({ acceptLicense: true })
        .expect(403);
    });

    it('refuses while the deployment has no reviewers configured', async () => {
      // The precondition that keeps a submission from being accepted and then
      // stranded: nothing could ever decide it.
      const listing = await publish();
      await request(app.getHttpServer())
        .post(`/templates/${listing.id}/submit`)
        .set('Cookie', authCookie(owner))
        .send({ acceptLicense: true })
        .expect(400);
      const row = await prisma.templateListing.findUnique({
        where: { id: listing.id as string },
      });
      expect(row?.status).toBe('listed');
    });
  });
});
