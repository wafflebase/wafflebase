/**
 * Yorkie-attached integration coverage for revision history
 * (`docs/design/revision-history.md` §8).
 *
 * The colocated unit suites (`use-revisions`, `revision-meta`,
 * `YorkieAuthController.decide()`) all exercise revision behavior against
 * mocks. Two things cannot be mocked honestly: whether a restore actually
 * converges for a second attached client watching the same document, and
 * whether a viewer-role client is refused. This file covers both against a
 * real Yorkie server (the one started by `docker compose up -d`), sharing
 * the `RUN_YORKIE_INTEGRATION_TESTS` / `describeAttached` gate with
 * `docs-tree-attached.e2e-spec.ts`. It does not share that file's
 * `YorkieService.withDocument()` helper, though: that wrapper exposes no
 * revision methods and creates one client per call, so it cannot model two
 * independently-watching clients or a viewer/owner pair. This file talks to
 * the raw `@yorkie-js/sdk` `Client`/`Document` directly instead.
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

type Observed<T> =
  | { resolved: true; value: T }
  | { resolved: false; error: unknown };

/** Captures whether a promise resolved or rejected, and with what. */
function observe<T>(promise: Promise<T>): Promise<Observed<T>> {
  return promise.then(
    (value) => ({ resolved: true as const, value }),
    (error: unknown) => ({ resolved: false as const, error }),
  );
}

/**
 * Duck-types an RPC rejection as the auth webhook's permission denial,
 * rather than accepting any rejection as proof of refusal — a network
 * blip, a detached document, or an expired token would all also reject.
 * Confirmed shape from a real denial: `ConnectError { code: 7, message:
 * '[permission_denied] not allowed' }` (gRPC code 7 is `PERMISSION_DENIED`;
 * `@yorkie-js/sdk` doesn't re-export `@connectrpc/connect`'s `Code` enum,
 * so this checks the numeric value and the message text directly instead
 * of importing it).
 */
function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return (
    code === 7 ||
    (typeof message === 'string' && message.includes('permission_denied'))
  );
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
  // IMPORTANT CORRECTION (found while addressing review round 1 on this
  // file): the premise this test originally shipped with — "the server's
  // auth-webhook method enum has no `*Revision` entry at all, so the
  // webhook is never consulted for these RPCs, full stop" — is **not**
  // accurate for the yorkie server build this repo runs against
  // (`yorkieteam/yorkie:latest`). The `yorkie` CLI accepts
  // `--auth-webhook-method-add ListRevisions/GetRevision/CreateRevision/
  // RestoreRevision` without error, and once registered the server *does*
  // call the webhook for three of the four, with real `{key, verb}`
  // attributes:
  //   - `ListRevisions` → verb `r`
  //   - `GetRevision`   → verb `r`
  //   - `RestoreRevision` → verb `rw`
  // This is now asserted directly (`webhookCalls`, recorded by a middleware
  // ahead of the controller — see below), not just observed once by hand
  // and written up in prose (an earlier round of this file did exactly
  // that and got called out for it correctly: a viewer being refused is,
  // on its own, equally consistent with correct per-role enforcement *or*
  // `RestoreRevision` sharing `CreateRevision`'s `attributes: null` bug and
  // denying everyone — the two are indistinguishable without a positive
  // control). The owner-side `restoreRevision` control probe below is that
  // control: it genuinely succeeds, which is only possible under the first
  // explanation. Together, real attributes + `YorkieAuthController.decide()`
  // — completely unmodified, no code change anywhere in `src/` — already
  // authorizing them correctly + the owner's own restore succeeding is what
  // makes this test's conclusion solid: the specific vulnerability this
  // test checks (a viewer-role client restoring a document) is closed
  // **today**, simply by wafflebase adding these methods to the
  // registration walkthrough in `packages/backend/README.md` — it does not
  // need to wait on an upstream fix. `docs/design/revision-history.md`'s
  // "upstream ask 1" framing is wrong for these three methods and needs
  // correcting there (out of scope for this file to do).
  //
  // `CreateRevision` is the one genuine exception, and it's a different
  // shape of problem: the server calls the webhook for it too, but sends
  // `attributes: null` — no document key, no verb — every time (confirmed
  // the same way, and independent of caller identity or role). wafflebase's
  // `decide()` fails closed on a document method with no attributes (by
  // design — see the "fails closed" unit test in
  // `yorkie-auth.controller.spec.ts`), so registering `CreateRevision`
  // alongside the other three would deny it for *everyone*, owner included,
  // not just a viewer. That is why the registration below happens in two
  // phases: the owner's baseline `createRevision` call (line ~363) runs
  // *before* the second `project update` registers the four revision
  // methods, so this test's own setup doesn't trip over that separate bug.
  // See the console output this test logs right after registering them for
  // a live demonstration of `CreateRevision` breaking even for the owner.
  // This is the part that still needs an upstream or server-config fix
  // before wafflebase could safely add `CreateRevision` to its own
  // registration.
  //
  // Still left `it.skip` — not because it's expected to fail (it isn't,
  // see above), but because it provisions a scratch Yorkie project and a
  // throwaway Nest app via the `yorkie` admin CLI, which is not installed
  // in CI (only the `yorkieteam/yorkie` server container is — see
  // `.github/workflows/ci.yml`'s `verify-integration` job). Unskipping this
  // in its current form would error out in CI, not just fail an assertion.
  // Requires RUN_DB_INTEGRATION_TESTS=true and the `yorkie` admin CLI on
  // PATH, in addition to RUN_YORKIE_INTEGRATION_TESTS=true, to run
  // manually. Left un-skipped in the source (rather than deleted) so
  // re-running it locally is a one-line change; see
  // `.superpowers/sdd/20260902-revision-history-plan/task-8-report.md` for
  // the full observed output this test produces when run.
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
    // Records every auth-webhook call's method + attributes, so the
    // `{key, verb}` vs `null` split this test's conclusions rest on is
    // asserted directly rather than only observed once by hand and written
    // up in prose. Must run after the `bodyParser.json` above (needs
    // `req.body` parsed) and before the controller.
    const webhookCalls: Array<{ method?: string; attributes?: unknown }> = [];
    app.use(
      (
        req: { url?: string; body?: { method?: string; attributes?: unknown } },
        _res: unknown,
        next: () => void,
      ) => {
        if (
          req.url?.split('?', 1)[0]?.startsWith('/internal/yorkie/auth') &&
          req.body
        ) {
          webhookCalls.push({
            method: req.body.method,
            attributes: req.body.attributes,
          });
        }
        next();
      },
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
      // for this test to even reach `restoreRevision`. See the task report
      // for this as its own follow-up finding. `PushPull` is
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

      // Register the four revision RPCs now, after the owner's baseline is
      // in place — see the comment above `execFileSync` below for why this
      // has to happen in a second call rather than up front.
      execFileSync('yorkie', [
        'project',
        'update',
        projectName,
        '--rpc-addr',
        rpcHost,
        '--auth-webhook-method-add',
        'ListRevisions',
        '--auth-webhook-method-add',
        'GetRevision',
        '--auth-webhook-method-add',
        'CreateRevision',
        '--auth-webhook-method-add',
        'RestoreRevision',
      ]);

      // Observe (not assert — this is a separate finding from the one this
      // test checks) that `CreateRevision` is now broken for the *owner*
      // too, not just a viewer: the server sends `attributes: null` for
      // this specific RPC regardless of caller, so `decide()`'s fail-closed
      // branch denies it unconditionally. This is why the owner's baseline
      // `createRevision` call above had to happen before this registration.
      const ownerCreateAfterRegistration = await observe(
        ownerClient.createRevision(ownerDoc, 'post-registration-probe', ''),
      );
      // eslint-disable-next-line no-console
      console.log(
        "owner's own createRevision after registering it as a webhook method:",
        JSON.stringify(ownerCreateAfterRegistration.resolved),
        ownerCreateAfterRegistration.resolved
          ? ''
          : `(${String(ownerCreateAfterRegistration.error)})`,
      );

      // Control probe: the owner's own `restoreRevision` must succeed now
      // that `RestoreRevision` is registered. This is what actually
      // separates two explanations for the viewer being refused below —
      // (a) real `{key, verb}` attributes and correct per-role enforcement,
      // vs (b) `RestoreRevision` sharing `CreateRevision`'s `attributes:
      // null` bug and denying *everyone*, owner included. If this
      // assertion fails, that is the (b) outcome: `RestoreRevision` is not
      // actually closable by registration and must stay unregistered like
      // `CreateRevision`, and the "closable today" conclusion below does
      // not hold.
      await ownerClient.restoreRevision(ownerDoc, rev.id);
      await ownerClient.sync(ownerDoc);
      expect(ownerDoc.getRoot().marker).toBe('owner-baseline');

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
      // must be denied — and specifically *denied*, not merely "rejected
      // for any reason" (a network blip, a detached document, or an
      // expired token would also reject `sync()`).
      viewerDoc.update((root) => {
        root.marker = 'viewer-should-not-write';
      });
      const writeAttempt = await observe(viewerClient.sync(viewerDoc));
      expect(writeAttempt.resolved).toBe(false);
      expect(
        !writeAttempt.resolved && isPermissionDenied(writeAttempt.error),
      ).toBe(true);

      // The actual claim under test: once `RestoreRevision` is registered as
      // an auth-webhook method, a viewer-role client's restore is refused —
      // wafflebase's existing role logic, given real attributes, already
      // gets this right (confirmed, not merely inferred: the owner-side
      // control probe above proves `RestoreRevision` genuinely succeeds
      // once registered, so this refusal is role-based, not a blanket
      // `attributes: null` failure). Assert both that the RPC was refused
      // *and* that the document really didn't change — "no exception was
      // thrown" alone would also pass on an unrelated error.
      const someRevisionId = rev.id;
      const observed = await observe(
        viewerClient.restoreRevision(viewerDoc, someRevisionId),
      );
      await ownerClient.sync(ownerDoc);
      // eslint-disable-next-line no-console
      console.log(
        'read-only refusal observed:',
        JSON.stringify(observed.resolved),
        '| owner doc marker after viewer restore =',
        ownerDoc.getRoot().marker,
      );

      expect(observed.resolved).toBe(false);
      expect(!observed.resolved && isPermissionDenied(observed.error)).toBe(
        true,
      );
      // Unchanged since the owner's own control-probe restore above.
      expect(ownerDoc.getRoot().marker).toBe('owner-baseline');

      // Turn the one-time manual "I logged the raw webhook body by hand"
      // observation into a standing regression guard: every
      // `RestoreRevision` call (the owner's control probe and the viewer's)
      // carried the real document key + verb, and the one `CreateRevision`
      // call (the owner's post-registration probe; the pre-registration one
      // never hit the webhook at all) carried none. If a future yorkie
      // build changes either shape, this fails here instead of only via a
      // permission-decision side effect above.
      const restoreCalls = webhookCalls.filter(
        (c) => c.method === 'RestoreRevision',
      );
      expect(restoreCalls.length).toBeGreaterThanOrEqual(2);
      for (const call of restoreCalls) {
        expect(call.attributes).toEqual([{ key, verb: 'rw' }]);
      }
      const createCalls = webhookCalls.filter(
        (c) => c.method === 'CreateRevision',
      );
      expect(createCalls).toEqual([
        { method: 'CreateRevision', attributes: null },
      ]);
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
