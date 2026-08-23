/**
 * The development transport for debug reports.
 *
 * Two endpoints, both dev-server only:
 *
 *   `POST /__wb_debug_report` writes a confirmed bundle to `.wb-reports/`, which
 *   is where the intake runner picks it up. Nothing is filed by this; the file
 *   is the handover.
 *
 *   `POST /__wb_debug_draft` asks a model to write the issue text and propose
 *   the PR grouping. **THE MODEL CREDENTIAL IS READ IN THIS PROCESS AND NEVER
 *   REACHES THE BROWSER** — that is the whole reason drafting is an endpoint
 *   rather than a client-side call, and it is the rule
 *   `docs/design/design-editor/design-editor-local-plugin.md` already states for
 *   the design editor.
 *
 * The call itself is `draft-endpoint.ts`, in this process. It is deliberately NOT
 * routed through `scripts/agent/ask.mjs`: that wrapper requires a grant of at
 * least one built-in read tool ("an agent that can act but not read cannot cite
 * evidence"), which is right for the verifier sessions it exists for and wrong
 * for a call whose whole security argument is that it holds none.
 *
 * **BOTH ENDPOINTS ARE CSRF-SENSITIVE**, and that is not theoretical: they
 * listen on a port every page the developer visits can reach, one writes files
 * into the repository and the other spends a model credential. So both require a
 * same-origin request AND `application/json`, which together mean a cross-origin
 * page cannot reach them without a preflight it will not be granted.
 *
 * Design: `docs/design/debug-report.md`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { draftBundle } from "./draft-endpoint.ts";

/** What `parseBundle` answers. Narrowed to what this file reads. */
type BundleParse =
  | { ok: true; bundle: { sessionId: string } & Record<string, unknown> }
  | { ok: false; errors: string[] };

type CoreModule = {
  parseBundle: (input: unknown) => BundleParse;
  DRAFT_SCHEMA: Record<string, unknown>;
};

/**
 * The core package, loaded through Vite's own module runner.
 *
 * NOT a static import, and this is a real constraint rather than a preference:
 * `vite.config.ts` is evaluated by Node, which cannot resolve the extensionless
 * relative imports inside a source-exported TypeScript package. `ssrLoadModule`
 * uses Vite's pipeline (aliases and TS included) — the same resolution the app
 * gets — so the boundary check here runs the SAME fail-closed parser the intake
 * runner will, and the drafting call is held to the SAME schema the client
 * validates against, rather than second copies of either that could drift.
 */
async function loadCore(server: ViteDevServer): Promise<CoreModule> {
  return (await server.ssrLoadModule("@wafflebase/debug-report")) as CoreModule;
}

/** Where bundles land. Relative to the repository root. */
const REPORT_DIR = ".wb-reports";

/**
 * Body ceiling.
 *
 * Larger than the capture store's 32 MB budget on purpose: that budget counts
 * DECODED bytes, and these images travel as base64 data URLs inside JSON — 4/3
 * plus escaping. Matching the two numbers meant a session near the budget could
 * never be handed over at all.
 */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

type Json = Record<string, unknown>;

function readJsonBody(req: Connect.IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Reject BEFORE destroying, and let the caller answer: destroying first
        // can kill the socket before the 400 reaches the browser, which the
        // reporter then sees as "the dev server did not answer".
        reject(new Error(`body exceeds ${MAX_BODY_BYTES} bytes`));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}

type Res = {
  statusCode: number;
  setHeader: (k: string, v: string) => void;
  end: (body?: string) => void;
};

function send(res: Res, status: number, body: Json): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Whether this request may act.
 *
 * A cross-origin page can issue a "simple" POST with no preflight — but only
 * with a small set of content types, and it cannot forge `Origin`. Requiring
 * both closes that door: `application/json` forces a preflight, and the origin
 * check answers it with a refusal.
 */
export function isTrustedRequest(
  req: Pick<Connect.IncomingMessage, "headers">,
): { ok: true } | { ok: false; error: string } {
  const type = String(req.headers["content-type"] ?? "");
  if (!/^application\/json\b/.test(type)) {
    return { ok: false, error: "expected Content-Type: application/json" };
  }
  const origin = req.headers.origin;
  if (origin === undefined) return { ok: true }; // same-origin fetch, or curl
  const host = req.headers.host;
  let originHost: string;
  try {
    originHost = new URL(String(origin)).host;
  } catch {
    return { ok: false, error: "unreadable Origin" };
  }
  if (!host || originHost !== host) {
    return { ok: false, error: `cross-origin request from ${String(origin)}` };
  }
  return { ok: true };
}

/**
 * A capture id or session id used as a path segment.
 *
 * `..` and `.` are excluded EXPLICITLY, and the reason is that a character class
 * alone does not: `/^[A-Za-z0-9._-]+$/` happily matches `".."`, and
 * `path.join(root, ".wb-reports", "..")` is the repository root — so a bundle
 * could have written `bundle.json` and arbitrary image bytes straight into the
 * checkout.
 */
export function isSafeSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

type CaptureInput = { id?: unknown; dataUrl?: unknown };
type PreparedCapture = { name: string; bytes: Buffer };

/**
 * Decode the captures, refusing anything that is not a plain image under a plain
 * filename.
 *
 * Nothing is written here. Decoding and writing are separated so the whole
 * handover can be ALL OR NOTHING: a bundle written next to a refused capture
 * would be picked up by intake while referencing an image that is not on disk,
 * and the reporter would be told the send failed — both true at once.
 */
export function prepareCaptures(captures: unknown): {
  prepared: PreparedCapture[];
  refused: string[];
} {
  const prepared: PreparedCapture[] = [];
  const refused: string[] = [];
  if (!Array.isArray(captures)) return { prepared, refused };

  for (const raw of captures as CaptureInput[]) {
    const id = raw?.id;
    const dataUrl = raw?.dataUrl;
    if (!isSafeSegment(id) || typeof dataUrl !== "string") {
      refused.push(typeof id === "string" ? id : "<unnamed>");
      continue;
    }
    const comma = dataUrl.indexOf(",");
    const header = comma === -1 ? "" : dataUrl.slice(0, comma);
    if (comma === -1 || !/^data:image\/(png|jpeg|webp);base64$/.test(header)) {
      refused.push(id);
      continue;
    }
    const ext = header.includes("png") ? "png" : header.includes("webp") ? "webp" : "jpg";
    prepared.push({
      name: `${id}.${ext}`,
      bytes: Buffer.from(dataUrl.slice(comma + 1), "base64"),
    });
  }
  return { prepared, refused };
}

export type DebugReportPluginOptions = {
  /** Repository root. Bundles are written under `<root>/.wb-reports/`. */
  repoRoot: string;
  /** Injected in tests, so no model is called. */
  draft?: typeof draftBundle;
};

export function debugReportPlugin(options: DebugReportPluginOptions): Plugin {
  const draft = options.draft ?? draftBundle;

  return {
    name: "wb-debug-report",
    // `apply: "serve"` is the load-bearing half of "dev only": the endpoints
    // cannot exist in a build because the plugin is not in one.
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__wb_debug_report", (req, res, next) => {
        if (req.method !== "POST") return next();
        void (async () => {
          try {
            const trusted = isTrustedRequest(req);
            if (!trusted.ok) return send(res, 403, { error: trusted.error });

            const body = await readJsonBody(req);
            // VALIDATED HERE, at the boundary the fail-closed parser was written
            // for. Writing an unparseable bundle would mean the reporter is told
            // it was sent, the session is emptied, and intake rejects it — the
            // report destroyed with a success message.
            const { parseBundle } = await loadCore(server);
            const parsed = parseBundle(body.bundle);
            if (!parsed.ok) {
              return send(res, 400, {
                error: "the bundle is not valid",
                detail: parsed.errors.slice(0, 5).join("; "),
              });
            }
            const { bundle } = parsed;
            if (!isSafeSegment(bundle.sessionId)) {
              return send(res, 400, { error: "sessionId is not a plain identifier" });
            }

            const { prepared, refused } = prepareCaptures(body.captures);
            if (refused.length > 0) {
              // Nothing is written. The reporter still holds the batch, which is
              // what "nothing was sent" has to mean.
              return send(res, 400, {
                error: `refused ${refused.length} capture(s): ${refused.join(", ")}`,
              });
            }

            const dir = path.join(options.repoRoot, REPORT_DIR, bundle.sessionId);
            mkdirSync(dir, { recursive: true });
            for (const capture of prepared) {
              writeFileSync(path.join(dir, capture.name), capture.bytes);
            }
            writeFileSync(
              path.join(dir, "bundle.json"),
              `${JSON.stringify(bundle, null, 2)}\n`,
            );
            const ref = path.join(REPORT_DIR, bundle.sessionId);
            server.config.logger.info(
              `[debug-report] wrote ${ref}/bundle.json (${prepared.length} capture(s))`,
            );
            send(res, 200, { ref, captures: prepared.map((c) => c.name) });
          } catch (err) {
            send(res, 400, { error: err instanceof Error ? err.message : String(err) });
          }
        })();
      });

      server.middlewares.use("/__wb_debug_draft", (req, res, next) => {
        if (req.method !== "POST") return next();
        void (async () => {
          try {
            const trusted = isTrustedRequest(req);
            if (!trusted.ok) return send(res, 403, { error: trusted.error });

            const body = await readJsonBody(req);
            const bundle = body.bundle;
            if (typeof bundle !== "object" || bundle === null) {
              return send(res, 400, { error: "expected { bundle }" });
            }
            const { DRAFT_SCHEMA } = await loadCore(server);
            const answer = await draft(bundle as Parameters<typeof draftBundle>[0], {
              schema: DRAFT_SCHEMA,
            });
            if (!answer.ok) {
              // 503 rather than 500: drafting being unavailable is a normal
              // state (no credential configured), and the client degrades to the
              // reporter's own sentences with one PR per item.
              send(res, 503, { error: answer.reason, detail: answer.detail });
              return;
            }
            send(res, 200, answer.result);
          } catch (err) {
            send(res, 400, { error: err instanceof Error ? err.message : String(err) });
          }
        })();
      });
    },
  };
}
