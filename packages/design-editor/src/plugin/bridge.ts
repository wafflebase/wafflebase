/**
 * The HTTP bridge — the only way the browser reaches the file system.
 *
 * Every handler is `apply: "serve"` only. There is no build-time counterpart on
 * purpose: a plugin that wrote source files during `vite build` would mutate a
 * repository from CI.
 *
 * Layout and token endpoints. The token half (`/tokens`, `/preview-tokens`, and the
 * emitter re-run after a write) goes through the configured `TokenAdapter` and reports
 * `adapter: null` when there is none — which §3 makes the permanent behaviour for a
 * project outside the support matrix rather than a stub.
 *
 * NOT COVERED BY THE SUITE: the middleware itself. Every handler needs a live
 * `ViteDevServer` plus HTTP, which is why the plugin half landed with no automated gate
 * (see the design doc §8) and why the prototype verified it with smoke scripts instead.
 * The pieces that could be lifted out of that are — `pushArtifacts` takes a narrow
 * structural host and has its own tests; the intent composition, token planning and regen
 * gate are all in `./intents` and `./tokens`. What remains untested here is request
 * plumbing: body parsing, status codes, and the same-origin refusal.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import type { FrameSide, MutateRequest, MutateResult } from './protocol.ts';
import { planFiles } from './protocol.ts';
import { BASE } from './shell.ts';
import { frameOf } from './frame.ts';
import type { PathGuard } from './paths.ts';
import type { Tracker } from './tracked.ts';
import type { Safelist } from './safelist.ts';
import type { TransactionStore } from './transactions.ts';
import type { IntentContext } from './intents.ts';
import { composeIntents, computeIntent, NO_ADAPTER } from './intents.ts';
import type { ResolvedOptions } from './options.ts';
import { maybeRegenerate, TOKEN_KINDS } from './tokens.ts';
import { readManifest } from './scenes.ts';

/**
 * This dev server's identity, minted once per process.
 *
 * The client persists its staged-edit stack under this value: a matching id on reload
 * means the same server is still running and the stack still describes the files it was
 * built against, while a different one means the server restarted and the stack must be
 * dropped rather than replayed. Without it the client keys on `"unknown"` forever, so a
 * restart silently restores edits against files that may have moved on.
 *
 * `pid` alone is not enough — operating systems reuse pids — so the start time is mixed
 * in. Both are process-local and neither identifies the machine.
 */
const SESSION_ID = `${process.pid}-${Date.now().toString(36)}`;

export interface BridgeDeps {
  options: ResolvedOptions;
  /**
   * The JSX analyser, lazily loaded — `extract.mjs` pulls in the TypeScript compiler, and
   * a consumer who never opens the outline should not pay for it at dev-server start.
   */
  loadExtractor: () => Promise<{
    analyzeFile: (abs: string) => unknown;
    analyzeNodes: (abs: string) => unknown;
    analyzeScene: (abs: string, cfg: unknown) => unknown;
    buildMetadata: (input: { files: unknown[]; scenes?: unknown[] }) => unknown;
  }>;
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

/**
 * Read every file the adapter declares as a token source, keyed root-relative.
 *
 * Through the guard, because `sources()` is consumer code: an adapter naming a path
 * outside the root must be refused at the same boundary a browser request would be.
 *
 * Returns a TAGGED result rather than `Record | {error}`. The keys of the success value
 * are adapter-supplied paths, so an `'error' in result` check on a bare record would be
 * decided by whether one of them happens to be named `error` — sound today only because
 * the extension allowlist rules it out, which is not a property this function should
 * depend on.
 */
async function readSources(
  deps: BridgeDeps,
  sources: string[],
): Promise<{ ok: true; texts: Record<string, string> } | { ok: false; error: string }> {
  const texts: Record<string, string> = {};
  for (const rel of sources) {
    const r = deps.guard.resolveSafe(rel);
    if ('error' in r) return { ok: false, error: `token source ${rel}: ${r.error}` };
    try {
      texts[rel] = await deps.tracker.read(r.abs);
    } catch (err) {
      // The likeliest token failure by far is a mistyped `stylesheet:` path, and it is
      // a CONFIG error rather than a broken bridge — so it is reported as one instead of
      // reaching the outer 500 handler.
      return { ok: false, error: `token source ${rel} could not be read: ${String(err)}` };
    }
  }
  return { ok: true, texts };
}

/** The slice of `ViteDevServer` `pushArtifacts` needs, so it is testable without one. */
type ArtifactModule = Parameters<ViteDevServer['reloadModule']>[0];
export interface ArtifactHost {
  moduleGraph: { getModulesByFile(file: string): Set<ArtifactModule> | undefined };
  reloadModule(mod: ArtifactModule): Promise<void>;
  config: { logger: { warn(msg: string): void } };
}

/**
 * Publish a staged plan to one frame side and invalidate what it changes.
 *
 * THE UNION IS THE WHOLE POINT, and it is the half that did not survive extraction.
 * `POST /plan` set the map and returned, so the frame kept serving the module it had
 * already transformed and a staged class edit was invisible until Approve wrote it.
 *
 * Invalidating only the NEW plan's files is the naive version, and it fails in both
 * directions: a file the old plan patched and the new one does not would serve its
 * stale patch forever, and dropping the last intent leaves a plan that names no files
 * at all — so undoing an edit would never revert on screen. Old ∪ new is what makes
 * staging reversible.
 *
 * Only modules belonging to THIS side are reloaded. `before` and `after` are two
 * transforms of the same file, and reloading both would make one side's preview move
 * when the other's plan changed.
 */
export async function publishPlan(
  server: ArtifactHost,
  side: FrameSide,
  files: Iterable<string>,
  resolve: (rel: string) => { abs: string } | { error: string },
): Promise<string[]> {
  const reloaded: string[] = [];
  for (const rel of files) {
    const r = resolve(rel);
    if ('error' in r) {
      server.config.logger.warn(`[design-editor] plan names an unreachable file ${rel}: ${r.error}`);
      continue;
    }
    for (const mod of server.moduleGraph.getModulesByFile(r.abs) ?? []) {
      if (frameOf(mod.id) !== side) continue;
      try {
        await server.reloadModule(mod);
        reloaded.push(mod.id ?? rel);
      } catch (err) {
        // Logged, not thrown: one unreloadable module must not lose the rest of the
        // plan. Silence here means "I staged an edit and the frame did not move".
        server.config.logger.warn(`[design-editor] could not reload ${rel}: ${String(err)}`);
      }
    }
  }
  return reloaded;
}

/**
 * Invalidate and re-push the modules an emitter regenerated.
 *
 * The adapter names its own artefacts because only it knows where its emitter wrote.
 * Wafflebase's lands in `packages/core/dist/tokens.css`, outside the Vite root, and
 * whether the Tailwind plugin registered it as a watch dependency is an implementation
 * detail not worth betting the live-preview loop on.
 *
 * `getModulesByFile`, not `getModuleById`: an artefact is a FILESYSTEM path, while a
 * module id may carry a query or a plugin prefix, and one file can back several modules.
 * Looking it up by id found nothing for exactly the artefacts this exists to push.
 *
 * Every miss and every failed reload is logged. Silence here means "I saved, the emitter
 * ran, and the page still shows the old value" with nothing to go on.
 */
export async function pushArtifacts(server: ArtifactHost, artifacts: string[]): Promise<void> {
  for (const abs of artifacts) {
    const mods = server.moduleGraph.getModulesByFile(abs);
    if (!mods?.size) {
      server.config.logger.warn(
        `[design-editor] regenerated ${abs} is not in the module graph — nothing to push`,
      );
      continue;
    }
    for (const mod of mods) {
      try {
        await server.reloadModule(mod);
      } catch (err) {
        server.config.logger.warn(`[design-editor] could not reload ${abs}: ${String(err)}`);
      }
    }
  }
}

/**
 * Re-run the project's emitter after a write, and push what it produced.
 *
 * Returns `{}` when nothing was needed — either the project has no emitter (the
 * `cssVariables` case, where the write already reached the stylesheet the host serves)
 * or the write touched no token source. Spreading `{}` into the response keeps
 * `regenerated` ABSENT in that case, which is the honest answer: `false` would claim an
 * emitter ran and failed.
 *
 * A failure is reported, never swallowed. The prototype's note on this is worth keeping:
 * folding every failure into a bare `false` is exactly how "I saved but nothing changed
 * on the page" happens silently.
 */
async function regenerate(
  server: ViteDevServer,
  deps: BridgeDeps,
  writtenRels: string[],
): Promise<{ regenerated?: boolean; regenError?: string }> {
  const r = await maybeRegenerate(deps.options.tokens, writtenRels);
  if (!r.ran) return {};
  if (r.artifacts?.length) await pushArtifacts(server, r.artifacts);
  if (!r.ok) {
    server.config.logger.error(`[design-editor] token regeneration failed: ${r.error}`);
  }
  return { regenerated: !!r.ok, regenError: r.error };
}

export function bridge(deps: BridgeDeps): Plugin {
  return {
    name: 'wafflebase-design-editor:bridge',
    apply: 'serve',

    configureServer(server) {
      /**
       * Seed the change tracker with the adapter's token sources.
       *
       * The tracker reports an external edit only for files it has already READ, which
       * is what replaced the prototype's `WATCHED_RE` — but the prototype also SEEDED
       * that list with the token pipeline's files at startup. Without the seed, editing
       * `index.css` in your editor before ever opening the token panel is not reported,
       * and the first token save then fails against a value it never saw.
       *
       * Best-effort by design: a mistyped `stylesheet:` path must not take the dev server
       * down at startup. `GET /tokens` is where that misconfiguration gets a real error
       * message, because that is where the user is looking for one.
       */
      const adapter = deps.options.tokens;
      if (adapter) {
        for (const rel of adapter.sources()) {
          const r = deps.guard.resolveSafe(rel);
          if ('error' in r) {
            server.config.logger.warn(`[design-editor] token source ${rel}: ${r.error}`);
            continue;
          }
          void deps.tracker.read(r.abs).catch(() => {
            server.config.logger.warn(`[design-editor] token source not readable: ${rel}`);
          });
        }
      }

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
              // The drill-in resolver's alias table. Reported here rather than on
              // its own route because it is config, fixed for the dev server's
              // lifetime, and `/health` is the one call the client already makes
              // before it can resolve anything.
              aliases: deps.options.aliases,
              session: SESSION_ID,
              fsRevision: deps.tracker.revision(),
              externalChanges: deps.tracker.recentChanges(),
              safelist: deps.safelist.size(),
            });
          }

          // --- GET /tokens — the tree the token panels render -----------------
          //
          // Replaces the prototype's `/introspect`, which read four hardcoded
          // `packages/core` paths and returned wafflebase's own binding forms. What the
          // adapter reports is now the project's, and a project with none reports
          // `adapter: null` with empty maps — which is what lets the client grey the
          // panels rather than render an empty editor that refuses every save.
          /**
           * The outline's data: every scene in the manifest, analysed into a node tree.
           *
           * RE-READ ON EVERY REQUEST, never cached. A `layout-insert` renumbers every
           * following sibling, so a client holding a pre-write tree fails on all of them
           * at the next save — which is why `mock-metadata.ts` (908 lines of frozen
           * output) is the one population-C file §2 says is not moving: the endpoint
           * replaced it, and the replacement has to be live to be correct.
           *
           * A scene whose file fails to analyse is REPORTED, not dropped. Dropping it
           * yields an outline that is simply missing a scene, which reads as "this
           * project has fewer scenes" rather than as a parse failure.
           */
          if (url === '/metadata' && method === 'GET') {
            const o = deps.options;
            const manifest = readManifest(o.scenes);
            const extractor = await deps.loadExtractor();
            const files: unknown[] = [];
            const scenes: unknown[] = [];
            const failed: { file: string; error: string }[] = [];

            // `resolveSafe`, not a bare join: the manifest is consumer input, so a
            // scene naming `../../etc/passwd` is refused here rather than analysed.
            for (const scene of manifest.scenes ?? []) {
              const r = deps.guard.resolveSafe(scene.file);
              if ('error' in r) {
                failed.push({ file: scene.file, error: r.error });
                continue;
              }
              try {
                // ROOT-RELATIVE `file`, not what the analyser returns. `analyzeScene`
                // echoes the absolute path it was handed, and the outline compares a
                // clicked node's `parseStampId(id).file` against it — but the stamper
                // writes `data-wb-file` root-relative, by its own documented contract.
                // Left absolute the two never match, so a click in the frame highlights
                // nothing in the outline: a comparison that silently always fails.
                const meta = extractor.analyzeScene(r.abs, scene) as { file?: string };
                scenes.push({ ...meta, file: deps.guard.relOf(r.abs) });
              } catch (err) {
                failed.push({ file: scene.file, error: String(err) });
              }
            }
            for (const rel of manifest.components ?? []) {
              const r = deps.guard.resolveSafe(rel);
              if ('error' in r) {
                failed.push({ file: rel, error: r.error });
                continue;
              }
              try {
                /**
                 * BOTH analysers, and the outline needs the second one.
                 *
                 * `analyzeFile` reports CVA variant tables and off-token values — the
                 * token half. It produces no node tree, so a component drilled into from
                 * the outline had `roots: undefined` and rendered as a component with no
                 * nodes rather than as one nobody analysed. `analyzeNodes` is where the
                 * tree comes from, and a declared component is exactly the thing a
                 * drill-in opens.
                 */
                const meta = extractor.analyzeFile(r.abs) as Record<string, unknown>;
                const nodes = extractor.analyzeNodes(r.abs) as Record<string, unknown>;
                files.push({ ...meta, ...nodes, file: deps.guard.relOf(r.abs) });
              } catch (err) {
                failed.push({ file: rel, error: String(err) });
              }
            }
            return json(res, 200, {
              ok: true,
              metadata: extractor.buildMetadata({ files, scenes }),
              failed,
            });
          }

          if (url === '/tokens' && method === 'GET') {
            const adapter = deps.options.tokens;
            if (!adapter) {
              return json(res, 200, {
                ok: true,
                adapter: null,
                reason: NO_ADAPTER,
                sources: [],
                vars: { light: {}, dark: {} },
                utilities: [],
                families: [],
              });
            }
            const sources = adapter.sources();
            const read = await readSources(deps, sources);
            if (!read.ok) return json(res, 200, { ok: false, error: read.error });
            const tree = await adapter.read(async (rel) => {
              const t = read.texts[rel];
              // An adapter may read a file it did not declare in `sources()`; that file
              // is then outside the external-change watch list, so the read is allowed
              // but the omission is worth reporting rather than hiding.
              if (t != null) return t;
              const r = deps.guard.resolveSafe(rel);
              if ('error' in r) throw new Error(`${rel}: ${r.error}`);
              return deps.tracker.read(r.abs);
            });
            return json(res, 200, { ok: true, adapter: 'configured', sources, ...tree });
          }

          // --- POST /preview-tokens — what a staged token plan would look like -
          //
          // Diffs the patched variable map against the base one WITHOUT writing, so the
          // client can apply only what moved. Mixed plans are supported: non-token
          // intents are filtered out rather than refused, so a batch of layout + token
          // edits still previews its token half.
          if (url === '/preview-tokens' && method === 'POST') {
            const adapter = deps.options.tokens;
            if (!adapter) return json(res, 200, { ok: false, error: NO_ADAPTER });

            // Malformed JSON is a 400, as on `/mutate`. Falling through to an empty intent
            // list answered a broken request with a clean "nothing would change" preview.
            const payload = await body<{ intents?: MutateRequest[] }>();
            if (!payload) return json(res, 400, { ok: false, error: 'invalid JSON body' });

            const read = await readSources(deps, adapter.sources());
            if (!read.ok) return json(res, 200, { ok: false, error: read.error });
            const baseText = read.texts;

            const intents = (payload?.intents ?? []).filter((i) => TOKEN_KINDS.has(i.kind ?? ''));
            const ctx = await deps.intentContext();
            const composed = await composeIntents(ctx, intents);

            const patched: Record<string, string> = { ...baseText };
            for (const [abs, text] of composed.cache) {
              const rel = composed.relOf.get(abs) ?? deps.guard.relOf(abs);
              if (rel in patched) patched[rel] = text;
            }

            const [next, base] = await Promise.all([adapter.emit(patched), adapter.emit(baseText)]);
            if (!next.ok || !base.ok) {
              return json(res, 200, { ok: false, error: next.error ?? base.error });
            }
            return json(res, 200, {
              ok: true,
              light: next.light,
              dark: next.dark,
              base: { light: base.light, dark: base.dark },
              // A token intent that could not be planned would otherwise vanish from the
              // preview and read as "no change", which is the one outcome a preview must
              // never fake.
              results: composed.results,
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

            const regen = await regenerate(
              server,
              deps,
              checkpoints.map((c) => c.path),
            );

            return json(res, 200, {
              ok: true,
              notes: r.reason ? [r.reason] : undefined,
              diff,
              files: checkpoints.map((c) => c.path),
              backup: firstBackup,
              txnId: txn?.id,
              ...regen,
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

            const regen = await regenerate(
              server,
              deps,
              checkpoints.map((c) => c.path),
            );

            return json(res, 200, {
              ok: true,
              diff: diff.join('\n'),
              files: checkpoints.map((c) => c.path),
              backup: firstBackup,
              txnId: txn?.id,
              results: composed.results,
              ...regen,
            });
          }

          // --- Transactions ---------------------------------------------------
          if (url === '/transactions' && method === 'GET') {
            return json(res, 200, { ok: true, ...deps.transactions.summary() });
          }
          if ((url === '/undo' || url === '/redo') && method === 'POST') {
            const r = url === '/undo' ? await deps.transactions.undo() : await deps.transactions.redo();
            if ('error' in r) return json(res, 409, { ok: false, error: r.error });
            // Reverting a token write has to re-emit too. Without this an undo restores
            // the source and leaves the generated CSS holding the value it just removed,
            // so the page keeps showing the undone edit — the one place where undo
            // appearing to do nothing is worse than refusing.
            const regen = await regenerate(server, deps, r.files);
            return json(res, 200, { ok: true, txnId: r.txn.id, files: r.files, ...regen });
          }

          // --- POST /candidates — register runtime-composed classes -----------
          if (url === '/candidates' && method === 'POST') {
            const payload = await body<{ classes?: string[] }>();
            const r = deps.safelist.register(payload?.classes ?? []);
            if (r.added.length) deps.onSafelistChange(server);
            return json(res, 200, { ok: true, ...r, total: deps.safelist.size() });
          }

          // --- POST /analyse — analyse ONE file, on demand ---------------------
          /*
           * WHY THIS EXISTS. The outline offers a drill-in only for a file the analyser
           * has read, and the analyser read exactly what `scenes.config.json` listed
           * under `components` — seven hand-written paths. So drilling into `LoginForm`
           * was refused although its import resolves perfectly: the path was known and
           * the file simply had never been looked at.
           *
           * Analysing on demand deletes that list as a maintenance burden. It also
           * removes the reason the gate existed: the old worry was that drilling into an
           * unanalysed file shows an empty tree, which reads as "component with no
           * nodes" rather than "component nobody declared". Analysing at the moment of
           * the drill means there is no such state — either a tree comes back, or a
           * reason does.
           *
           * The path comes from the client, so it goes through the guard like any other:
           * `resolveSafe` refuses anything outside the root. `node_modules` is refused
           * separately — `resolveImport` cannot produce such a path today (a bare
           * specifier with no alias returns null), but an alias aimed into a package
           * could, and analysing a dependency is never what a drill-in means.
           */
          if (url === '/analyse' && method === 'POST') {
            const payload = await body<{ file?: string }>();
            const rel = payload?.file;
            if (typeof rel !== 'string' || !rel.trim()) {
              return json(res, 400, { ok: false, error: '`file` is required' });
            }
            if (rel.split('/').includes('node_modules')) {
              return json(res, 400, {
                ok: false,
                error: 'refusing to analyse a dependency — drill-in is for your own source',
              });
            }
            const r = deps.guard.resolveSafe(rel);
            if ('error' in r) return json(res, 400, { ok: false, error: r.error });
            try {
              const extractor = await deps.loadExtractor();
              const meta = extractor.analyzeFile(r.abs) as Record<string, unknown>;
              const nodes = extractor.analyzeNodes(r.abs) as Record<string, unknown>;
              return json(res, 200, {
                ok: true,
                file: { ...meta, ...nodes, file: deps.guard.relOf(r.abs) },
              });
            } catch (err) {
              // The reason, not a bare failure: "no such file" and "this file does not
              // parse" send the reader to completely different places.
              return json(res, 200, { ok: false, error: String(err) });
            }
          }

          // --- POST /plan — stage the intents a frame side renders ------------
          if (url === '/plan' && method === 'POST') {
            const payload = await body<{ side?: FrameSide; intents?: MutateRequest[] }>();
            const side = payload?.side;
            if (side !== 'before' && side !== 'after') {
              return json(res, 400, { ok: false, error: '`side` must be "before" or "after"' });
            }
            const next = payload?.intents ?? [];
            // Union of what this side WAS serving patched and what it will serve now —
            // see `publishPlan`. Read before the map is overwritten.
            const union = new Set([
              ...planFiles(deps.plans.get(side) ?? []),
              ...planFiles(next),
            ]);
            deps.plans.set(side, next);
            const reloaded = await publishPlan(server, side, union, (rel) =>
              deps.guard.resolveSafe(rel),
            );
            return json(res, 200, { ok: true, side, count: next.length, reloaded });
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
