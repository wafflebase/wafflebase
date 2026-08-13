/**
 * The HTTP bridge — the only way the browser reaches the file system.
 *
 * Every handler is `apply: "serve"` only. There is no build-time counterpart on
 * purpose: a plugin that wrote source files during `vite build` would mutate a
 * repository from CI.
 *
 * Layout endpoints only, which is 8a's boundary. The token endpoints
 * (`/preview-tokens`, the token families, the CSS regen) arrive with the
 * `TokenAdapter` in 8b; until then a token intent is refused with a note that says
 * why, which §3 makes the permanent behaviour for a project outside the support
 * matrix rather than a stub.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import type { FrameSide, MutateRequest, MutateResult } from './protocol';
import { BASE } from './shell';
import type { PathGuard } from './paths';
import type { Tracker } from './tracked';
import type { Safelist } from './safelist';
import type { TransactionStore } from './transactions';
import type { IntentContext } from './intents';
import { composeIntents, computeIntent } from './intents';
import type { ResolvedOptions } from './options';

export interface BridgeDeps {
  options: ResolvedOptions;
  guard: PathGuard;
  tracker: Tracker;
  safelist: Safelist;
  transactions: TransactionStore;
  plans: Map<FrameSide, MutateRequest[]>;
  intentContext: () => Promise<IntentContext>;
  /** Invalidate + push the host stylesheet that carries the safelist directive. */
  onSafelistChange: (server: ViteDevServer) => void;
}

/** Hard cap so a runaway request cannot exhaust memory (~5 MB). */
const BODY_LIMIT = 5_000_000;

/** Thrown past the cap, so the handler can answer 413 rather than "bad JSON". */
class PayloadTooLarge extends Error {
  constructor() {
    super('payload too large');
  }
}

/**
 * Read a JSON body, refusing anything past the cap.
 *
 * Rejecting is not enough on its own: the `data` listener keeps firing after the
 * promise settles, so the string kept growing and the cap bounded only what the
 * handler SAW, not what was buffered. `pause()` + `destroy()` stops the socket, and
 * the guard flag makes the late chunks that are already queued no-ops.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let done = false;
    const fail = (err: Error) => {
      if (done) return;
      done = true;
      req.pause();
      req.destroy();
      reject(err);
    };
    req.on('data', (chunk) => {
      if (done) return;
      data += chunk;
      if (data.length > BODY_LIMIT) fail(new PayloadTooLarge());
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(data);
    });
    req.on('error', fail);
  });
}

/**
 * Is this request same-origin?
 *
 * These endpoints WRITE THE CONSUMER'S SOURCE FILES, and a dev server is reachable
 * from any page the developer has open: without this, `fetch('http://localhost:5173
 * /__design-editor/api/mutate', …)` from an unrelated site edits their repository.
 * Browsers attach `Origin` to exactly the cross-origin requests that matter here
 * (every POST, and any non-simple GET), so a mismatch is a reliable refusal.
 *
 * A MISSING `Origin` is allowed, deliberately: curl, the smoke scripts and the
 * editor's own same-origin GETs send none, and rejecting those would break the
 * verification path §8 relies on while stopping no browser attack — a page cannot
 * suppress the header.
 *
 * This is not a substitute for the per-session token the reviewer also asked for;
 * it is the half that needs no client. The token has to be minted by the shell,
 * which is PRs 10–12, so it is deliberately deferred rather than half-built.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function bridge(deps: BridgeDeps): Plugin {
  return {
    name: 'wafflebase-design-editor:bridge',
    apply: 'serve',

    configureServer(server) {
      /**
       * Report an out-of-band edit to any file a staged edit depends on.
       *
       * Without this, editing a file in your code editor silently invalidates the
       * expectations staged edits captured, and the failure surfaces at save time
       * as an error on every affected edit — with the editor stuck dirty, because
       * failed edits never reach the baseline.
       */
      server.watcher.on('change', (file) => {
        if (!deps.tracker.noteChange(file)) return;
        const rel = deps.guard.relOf(file);
        server.config.logger.info(
          `[design-editor] external change: ${rel} (fs #${deps.tracker.revision()})`,
        );
        server.ws.send({
          type: 'custom',
          event: 'design-editor:fs-change',
          data: { fsRevision: deps.tracker.revision(), file: rel },
        });
      });

      server.middlewares.use(`${BASE}/api`, async (req, res, next) => {
        const url = (req.url ?? '/').split('?')[0];
        const method = req.method ?? 'GET';

        // Refused before the body is read, so an oversized cross-origin POST costs
        // nothing to reject.
        if (!sameOrigin(req)) {
          return json(res, 403, {
            ok: false,
            error: 'cross-origin requests are refused — the design editor writes source files',
          });
        }

        /** `null` = malformed JSON; throws `PayloadTooLarge` past the cap. */
        const body = async <T>(): Promise<T | null> => {
          const raw = await readBody(req);
          try {
            return JSON.parse(raw) as T;
          } catch {
            return null;
          }
        };

        try {
          // --- GET /health — the client's liveness + staleness probe -----------
          if (url === '/health' && method === 'GET') {
            return json(res, 200, {
              ok: true,
              root: deps.options.root,
              scenes: deps.options.scenes,
              providers: deps.options.providers,
              // Absent adapter is a first-class, reportable state: the client greys
              // the token panels rather than offering edits the server refuses.
              tokens: deps.options.tokens ? 'configured' : null,
              fsRevision: deps.tracker.revision(),
              externalChanges: deps.tracker.recentChanges(),
              safelist: deps.safelist.size(),
            });
          }

          // --- POST /mutate — one intent, dry-run or written ------------------
          if (url === '/mutate' && method === 'POST') {
            const intent = await body<MutateRequest>();
            if (!intent) return json(res, 400, { ok: false, error: 'invalid JSON body' });

            const ctx = await deps.intentContext();
            const r = await computeIntent(ctx, intent);
            if ('error' in r) return json(res, r.status, { ok: false, error: r.error });
            if (!r.located) {
              return json(res, 409, { ok: false, error: r.reason ?? 'could not locate' });
            }

            const diff = r.files
              .map((f) => ctx.injector.unifiedDiff(f.before, f.after))
              .filter(Boolean)
              .join('\n');

            if (intent.dryRun) {
              const result: MutateResult = {
                ok: true,
                notes: r.reason ? [r.reason] : undefined,
                diff,
                files: r.files.map((f) => f.rel),
              };
              return json(res, 200, {
                ...result,
                removedText: r.removedText,
                removedIndex: r.removedIndex,
                parentPath: r.parentPath,
              });
            }

            let firstBackup: string | null = null;
            const checkpoints = [];
            for (const f of r.files) {
              if (f.before === f.after) continue;
              const bak = await deps.guard.backup(f.abs);
              firstBackup ??= deps.guard.relOf(bak);
              await deps.tracker.write(f.abs, f.after);
              checkpoints.push({ path: f.rel, before: f.before, after: f.after });
            }
            const txn = checkpoints.length
              ? deps.transactions.record([intent.kind ?? 'mutate'], checkpoints)
              : null;

            return json(res, 200, {
              ok: true,
              notes: r.reason ? [r.reason] : undefined,
              diff,
              files: checkpoints.map((c) => c.path),
              backup: firstBackup,
              txnId: txn?.id,
            });
          }

          // --- POST /validate — "would a save succeed right now?" -------------
          //
          // Shares `composeIntents` with `/commit`. That sharing IS the contract:
          // validation is only trustworthy if it runs the composition the save will
          // run, and two implementations would drift into "validated, then failed".
          if (url === '/validate' && method === 'POST') {
            const payload = await body<{ intents?: MutateRequest[] }>();
            const intents = payload?.intents ?? [];
            const ctx = await deps.intentContext();
            const composed = await composeIntents(ctx, intents);
            return json(res, 200, {
              ok: composed.results.every((r) => r.located),
              results: composed.results,
              fsRevision: deps.tracker.revision(),
            });
          }

          // --- POST /commit — a batch as ONE undo unit ------------------------
          if (url === '/commit' && method === 'POST') {
            const payload = await body<{ intents?: MutateRequest[]; dryRun?: boolean }>();
            const intents = payload?.intents ?? [];
            const ctx = await deps.intentContext();
            const composed = await composeIntents(ctx, intents);

            // ALL OR NOTHING. A batch that half-applied would leave the tree in a
            // state neither the editor nor the undo stack describes — an insert
            // written without the remove that was meant to pair with it.
            const failed = composed.results.filter((r) => !r.located);
            if (failed.length) {
              return json(res, 409, {
                ok: false,
                error: `${failed.length} of ${composed.results.length} intents could not be applied`,
                results: composed.results,
              });
            }

            const diff: string[] = [];
            const checkpoints = [];
            for (const [abs, after] of composed.cache) {
              const before = composed.before.get(abs) ?? '';
              if (before === after) continue;
              diff.push(ctx.injector.unifiedDiff(before, after));
              checkpoints.push({ path: composed.relOf.get(abs) ?? deps.guard.relOf(abs), before, after });
            }

            if (payload?.dryRun) {
              return json(res, 200, {
                ok: true,
                diff: diff.join('\n'),
                files: checkpoints.map((c) => c.path),
                results: composed.results,
              });
            }

            // RESOLVE EVERY PATH FIRST, then write. Resolving inside the write loop
            // meant a refusal on the third file left the first two written — a
            // half-applied batch, which is exactly what the all-or-nothing check
            // above exists to prevent, reached through the back door.
            const targets: { abs: string; text: string; rel: string }[] = [];
            for (const c of checkpoints) {
              const r = deps.guard.resolveSafe(c.path);
              if ('error' in r) return json(res, 400, { ok: false, error: `${c.path}: ${r.error}` });
              targets.push({ abs: r.abs, text: c.after, rel: c.path });
            }

            let firstBackup: string | null = null;
            for (const t of targets) {
              const bak = await deps.guard.backup(t.abs);
              firstBackup ??= deps.guard.relOf(bak);
              await deps.tracker.write(t.abs, t.text);
            }
            const txn = checkpoints.length
              ? deps.transactions.record(
                  composed.results.map((r) => r.label),
                  checkpoints,
                )
              : null;

            return json(res, 200, {
              ok: true,
              diff: diff.join('\n'),
              files: checkpoints.map((c) => c.path),
              backup: firstBackup,
              txnId: txn?.id,
              results: composed.results,
            });
          }

          // --- Transactions ---------------------------------------------------
          if (url === '/transactions' && method === 'GET') {
            return json(res, 200, { ok: true, ...deps.transactions.summary() });
          }
          if ((url === '/undo' || url === '/redo') && method === 'POST') {
            const r = url === '/undo' ? await deps.transactions.undo() : await deps.transactions.redo();
            if ('error' in r) return json(res, 409, { ok: false, error: r.error });
            return json(res, 200, { ok: true, txnId: r.txn.id, files: r.files });
          }

          // --- POST /candidates — register runtime-composed classes -----------
          if (url === '/candidates' && method === 'POST') {
            const payload = await body<{ classes?: string[] }>();
            const r = deps.safelist.register(payload?.classes ?? []);
            if (r.added.length) deps.onSafelistChange(server);
            return json(res, 200, { ok: true, ...r, total: deps.safelist.size() });
          }

          // --- POST /plan — stage the intents a frame side renders ------------
          if (url === '/plan' && method === 'POST') {
            const payload = await body<{ side?: FrameSide; intents?: MutateRequest[] }>();
            const side = payload?.side;
            if (side !== 'before' && side !== 'after') {
              return json(res, 400, { ok: false, error: '`side` must be "before" or "after"' });
            }
            deps.plans.set(side, payload?.intents ?? []);
            return json(res, 200, { ok: true, side, count: (payload?.intents ?? []).length });
          }

          return next();
        } catch (err) {
          // A size refusal is the client's fault and a distinct condition: 413 tells
          // it to split the batch, where 500 reads as "the bridge broke".
          if (err instanceof PayloadTooLarge) {
            return json(res, 413, { ok: false, error: `payload exceeds ${BODY_LIMIT} bytes` });
          }
          // A thrown handler must not take down the dev server, and the client needs
          // the message to distinguish "your edit was refused" from "the bridge broke".
          server.config.logger.error(`[design-editor] bridge error: ${String(err)}`);
          return json(res, 500, { ok: false, error: String(err) });
        }
      });
    },
  };
}
