/**
 * Yorkie-attached integration coverage for revision history
 * (`docs/design/revision-history.md` §8).
 *
 * The colocated unit suites (`use-revisions`, `revision-meta`,
 * `YorkieAuthController.decide()`) all exercise revision behavior against
 * mocks. Two things cannot be mocked honestly: whether a restore actually
 * converges for a second attached client watching the same document, and
 * whether a viewer-role client is refused. This file covers both against a
 * real Yorkie server (the one started by `docker compose up -d`), following
 * the same `RUN_YORKIE_INTEGRATION_TESTS` gate and manual-attach pattern as
 * `docs-tree-attached.e2e-spec.ts`.
 *
 * Opt in locally via:
 *   RUN_YORKIE_INTEGRATION_TESTS=true \
 *     pnpm --filter @wafflebase/backend test:e2e -- revision-history
 */
import { execFileSync } from 'node:child_process';
import * as bodyParser from 'body-parser';
import * as cookieParser from 'cookie-parser';
import { Test } from '@nestjs/testing';
import yorkie, { Document, SyncMode } from '@yorkie-js/sdk';
import type { Client } from '@yorkie-js/sdk';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/database/prisma.service';
import { AuthService } from 'src/auth/auth.service';
import { ShareLinkService } from 'src/share-link/share-link.service';
import { YorkieSignatureGuard } from 'src/document/yorkie-signature.guard';
import {
  applyGlobalBootstrap,
  clearDatabase,
  createUserFactory,
  createWorkspace,
  setIntegrationEnvDefaults,
  setAuthEnvDefaults,
} from './helpers/integration-helpers';

const runYorkieIntegrationTests =
  process.env.RUN_YORKIE_INTEGRATION_TESTS === 'true';
const describeAttached = runYorkieIntegrationTests ? describe : describe.skip;

const RPC_ADDR = process.env.YORKIE_RPC_ADDR ?? 'http://localhost:8080';

interface SheetRoot {
  marker?: string;
}

function newClient(): Client {
  return new yorkie.Client({ rpcAddr: RPC_ADDR });
}

/** Attaches a fresh, uniquely-keyed document in manual sync mode. */
async function attach(
  client: Client,
  key: string,
): Promise<Document<SheetRoot>> {
  const doc = new yorkie.Document<SheetRoot>(key);
  await client.attach(doc, { syncMode: SyncMode.Manual });
  return doc;
}

function uniqueDocKey(prefix: string): string {
  return `sheet-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describeAttached('revision history round-trip', () => {
  let client: Client;

  beforeEach(async () => {
    client = newClient();
    await client.activate();
  });

  afterEach(async () => {
    await client.deactivate();
  });

  it('round-trips create → list → get → restore', async () => {
    const key = uniqueDocKey('roundtrip');
    const doc = await attach(client, key);

    doc.update((root) => {
      root.marker = 'first';
    });
    await client.sync(doc);

    const created = await client.createRevision(
      doc,
      'v1',
      '{"v":1,"by":1,"kind":"named"}',
    );

    doc.update((root) => {
      root.marker = 'second';
    });
    await client.sync(doc);

    // Yorkie also auto-creates a `snapshot-<serverSeq>` revision per server
    // snapshot, so assert containment/lookup rather than exact count or
    // position.
    const listed = await client.listRevisions(doc, { pageSize: 10 });
    expect(listed.map((r) => r.id)).toContain(created.id);
    // listRevisions omits snapshot bodies; only getRevision carries them.
    expect(listed.find((r) => r.id === created.id)?.snapshot ?? '').toBe('');

    const full = await client.getRevision(doc, created.id);
    expect(full.snapshot).toContain('first');

    await client.restoreRevision(doc, created.id);
    await client.sync(doc);
    expect(doc.getRoot().marker).toBe('first');

    await client.detach(doc);
  });
});

describeAttached('revision history convergence', () => {
  it('converges a second attached client onto the restored state', async () => {
    const key = uniqueDocKey('convergence');
    const clientA = newClient();
    const clientB = newClient();
    await clientA.activate();
    await clientB.activate();

    try {
      const docA = await attach(clientA, key);
      const docB = await attach(clientB, key);

      docA.update((root) => {
        root.marker = 'first';
      });
      await clientA.sync(docA);
      const rev = await clientA.createRevision(docA, 'v1', '');

      docA.update((root) => {
        root.marker = 'second';
      });
      await clientA.sync(docA);
      await clientB.sync(docB);
      expect(docB.getRoot().marker).toBe('second');

      await clientA.restoreRevision(docA, rev.id);
      await clientA.sync(docA);
      await clientB.sync(docB);
      expect(docB.getRoot().marker).toBe('first');

      await clientA.detach(docA);
      await clientB.detach(docB);
    } finally {
      await clientA.deactivate();
      await clientB.deactivate();
    }
  });
});

describeAttached('revision history read-only refusal', () => {
  // Expected to fail until yorkie gates the revision RPCs behind the auth
  // webhook (upstream ask 1, docs/design/revision-history.md §6-§7 PR 0):
  // `ListRevisions` / `GetRevision` / `CreateRevision` / `RestoreRevision`
  // are absent from the auth-webhook method enum in the server binary
  // (`ActivateClient / AttachDocument / DetachDocument / RemoveDocument /
  // PushPull / Watch / Broadcast`), so `YorkieAuthController` is never
  // consulted for them — a viewer-role client can list, read and restore
  // regardless of what wafflebase's own authorization would decide.
  //
  // Verified locally: with the auth webhook registered (PushPull only — see
  // the comment on the `project update` call below for why `AttachDocument`
  // is deliberately left out) and `YORKIE_AUTH_WEBHOOK_ENFORCE=true`, the
  // viewer's genuine write (`sync()` after a local edit) was correctly
  // denied with `permission_denied`, but `restoreRevision` resolved
  // (`observed.resolved === true`) and the owner's own re-synced document
  // rolled back to the pre-edit marker — a real, externally-visible
  // rollback performed by a viewer-role client. See
  // `.superpowers/sdd/20260902-revision-history-plan/task-8-report.md` for
  // the full observed output. Unskip this once upstream ask 1 lands — its
  // passing is the signal that the fix arrived.
  //
  // Requires RUN_DB_INTEGRATION_TESTS=true and the `yorkie` admin CLI on
  // PATH in addition to RUN_YORKIE_INTEGRATION_TESTS=true, since it
  // provisions a scratch Yorkie project and registers a real auth webhook
  // against a throwaway Nest app instance. Left un-skipped in the source
  // (rather than deleted) so re-running it later is a one-line change.
  it.skip('refuses a read-only client', async () => {
    setIntegrationEnvDefaults();
    setAuthEnvDefaults();

    const rpcHost = RPC_ADDR.replace(/^https?:\/\//, '');

    // A scratch Yorkie project, isolated from the shared "default" project
    // other suites in this run depend on — registering an auth webhook is a
    // project-wide setting, and we don't want to leave it enforcing on a
    // project other tests attach to unauthenticated.
    execFileSync('yorkie', [
      'login',
      '--rpc-addr',
      rpcHost,
      '--insecure',
      '--username',
      'admin',
      '--password',
      'admin',
    ]);
    const projectName = `wfb-revhist-ro-${Date.now()}`;
    const project = JSON.parse(
      execFileSync('yorkie', [
        'project',
        'create',
        projectName,
        '--rpc-addr',
        rpcHost,
        '-o',
        'json',
      ]).toString(),
    ) as { public_key: string; secret_key: string };

    process.env.YORKIE_SECRET_KEY = project.secret_key;
    process.env.YORKIE_AUTH_WEBHOOK_ENFORCE = 'true';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // The local `yorkieteam/yorkie:latest` dev image's outgoing auth-webhook
      // POST carries no `X-Signature-256` header at all (confirmed by
      // inspecting the request headers Yorkie actually sends — unlike the
      // event webhook, which does sign). That is a separate, environment-level
      // gap from the one this test targets, so it is bypassed here rather than
      // conflated with it: `YorkieSignatureGuard` is unit-tested on its own
      // (`yorkie-signature.guard.spec.ts`), and leaving it wired in would 401
      // every request regardless of role, masking the actual finding under
      // test. `YorkieAuthController.decide()` — the real role/verb
      // authorization logic — still runs unmodified.
      .overrideGuard(YorkieSignatureGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = moduleRef.createNestApplication();
    // Mirror main.ts's rawBody capture for the Yorkie webhook prefix so
    // `YorkieSignatureGuard` can verify the HMAC Yorkie sends (harmless with
    // the guard bypassed above; kept so this stays a faithful mirror of the
    // real bootstrap if the guard override is ever removed).
    app.use(
      bodyParser.json({
        verify: (req: { url?: string; rawBody?: Buffer }, _res, buf) => {
          if (req.url?.split('?', 1)[0]?.startsWith('/internal/yorkie/')) {
            req.rawBody = buf;
          }
        },
      }),
    );
    app.use(cookieParser());
    applyGlobalBootstrap(app);
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port =
      typeof address === 'object' && address ? address.port : undefined;
    if (!port) {
      throw new Error('failed to bind ephemeral test server port');
    }

    const prisma = moduleRef.get(PrismaService);
    const authService = moduleRef.get(AuthService);
    const shareLinkService = moduleRef.get(ShareLinkService);

    let ownerClient: Client | undefined;
    let viewerClient: Client | undefined;
    try {
      // Point the scratch project's auth webhook at this ephemeral app.
      // `host.docker.internal` reaches the host from inside the Yorkie
      // container (same trick packages/backend/README.md documents for the
      // real registration walkthrough).
      //
      // Deliberately omits `AttachDocument` from the registered set.
      // Empirically (confirmed by inspecting the webhook request body this
      // yorkie server actually sends), `AttachDocument` always carries verb
      // 'rw' — even for a brand-new local `Document` object with zero local
      // changes, attaching to an already-populated remote document. Gating
      // it as the backend README's own walkthrough suggests would deny a
      // viewer's very first attach outright, which would make it impossible
      // to reach the interesting call (`restoreRevision`) at all and would
      // silently mask the finding this test exists to demonstrate. See the
      // task report for this as its own follow-up finding. `PushPull` is
      // "the real read/write gate" (docs/design/yorkie-auth-webhook.md's own
      // description) and correctly reflects sync mode, so it alone is
      // sufficient to prove the webhook is genuinely enforcing for the RPCs
      // it does cover.
      execFileSync('yorkie', [
        'project',
        'update',
        projectName,
        '--rpc-addr',
        rpcHost,
        '--auth-webhook-url',
        `http://host.docker.internal:${port}/internal/yorkie/auth`,
        '--auth-webhook-method-add',
        'PushPull',
        '--auth-webhook-method-add',
        'Watch',
        '--auth-webhook-method-add',
        'DetachDocument',
        '--auth-webhook-method-add',
        'Broadcast',
        '--auth-webhook-method-add',
        'RemoveDocument',
      ]);

      await clearDatabase(prisma);
      const owner = await createUserFactory(prisma, 'revhist-ro')();
      const workspace = await createWorkspace(prisma, owner.id, 'revhist-ro');
      const doc = await prisma.document.create({
        data: {
          title: 'Read-only revision probe',
          type: 'sheet',
          authorID: owner.id,
          workspaceId: workspace.id,
        },
      });
      const shareLink = await shareLinkService.create(
        doc.id,
        'viewer',
        owner.id,
        null,
      );

      const ownerToken = authService.issueYorkieUserToken(owner.id);
      const viewerToken = authService.issueYorkieShareToken(shareLink.token);
      const key = `sheet-${doc.id}`;

      // The owner writes real content and stamps a revision to restore to.
      ownerClient = new yorkie.Client({
        rpcAddr: RPC_ADDR,
        apiKey: project.public_key,
        authTokenInjector: async () => ownerToken,
      });
      await ownerClient.activate();
      const ownerDoc = await attach(ownerClient, key);
      ownerDoc.update((root) => {
        root.marker = 'owner-baseline';
      });
      await ownerClient.sync(ownerDoc);
      const rev = await ownerClient.createRevision(ownerDoc, 'baseline', '');
      ownerDoc.update((root) => {
        root.marker = 'owner-after-baseline';
      });
      await ownerClient.sync(ownerDoc);

      // The read-only client: an anonymous viewer-role share-link visitor.
      viewerClient = new yorkie.Client({
        rpcAddr: RPC_ADDR,
        apiKey: project.public_key,
        authTokenInjector: async () => viewerToken,
      });
      await viewerClient.activate();
      // `AttachDocument` is not registered above (see the comment on the
      // `project update` call), so this attach is not itself gated and is
      // expected to succeed regardless of role.
      const viewerDoc = await attach(viewerClient, key);

      // Sanity check: the webhook really is enforcing role-based access for
      // an RPC it *does* gate, so the interesting failure below isn't just a
      // broken test harness. A real edit attempt (verb 'rw') from a viewer
      // must be denied.
      viewerDoc.update((root) => {
        root.marker = 'viewer-should-not-write';
      });
      await expect(viewerClient.sync(viewerDoc)).rejects.toThrow();

      // The actual claim under test: revision RPCs bypass the webhook
      // entirely, so a viewer can restore regardless of role. Capture what
      // actually happens (a single call, observed rather than asserted
      // directly) so a failure here is concrete evidence — did the RPC
      // resolve, and did the document really change — not just "no
      // exception was thrown".
      const someRevisionId = rev.id;
      const observed = await viewerClient
        .restoreRevision(viewerDoc, someRevisionId)
        .then(
          () => ({ resolved: true as const }),
          (error: unknown) => ({ resolved: false as const, error }),
        );
      await ownerClient.sync(ownerDoc);
      // eslint-disable-next-line no-console
      console.log(
        'read-only refusal observed:',
        JSON.stringify(observed.resolved),
        '| owner doc marker after viewer restore =',
        ownerDoc.getRoot().marker,
      );

      // This is the assertion expected to fail today: `restoreRevision`
      // resolves for the viewer instead of being refused.
      expect(observed.resolved).toBe(false);
    } finally {
      await ownerClient?.deactivate().catch(() => {});
      await viewerClient?.deactivate().catch(() => {});
      // Best-effort: stop the scratch project from calling back into an app
      // that is about to close.
      try {
        execFileSync('yorkie', [
          'project',
          'update',
          projectName,
          '--rpc-addr',
          rpcHost,
          '--auth-webhook-method-rm',
          'ALL',
        ]);
      } catch {
        // Ignore — this is a throwaway project either way.
      }
      await app.close();
      await moduleRef.close();
    }
  }, 30_000);
});
