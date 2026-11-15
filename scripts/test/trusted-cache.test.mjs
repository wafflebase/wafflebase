// No job that runs on a trusted trigger and holds a secret or a write token
// restores an Actions cache.
//
// WHY. Actions cache entries written on `main` are readable from every ref,
// tags and releases included, and any job running on `main`'s ref can write
// them: the agent jobs run there, with root on their runner and the runtime
// token in reach. A restore is a tar extracted over the runner, not only over
// the declared `path`, so a job that restores a planted entry runs whatever
// the entry carries. In a publish job, that code runs next to the registry
// login, `NPM_TOKEN` or a token that pushes `gh-pages`.
//
// THE RULE, per job:
//   trusted   the workflow has a trigger other than `pull_request` and
//             `merge_group`. Those two run the PR's own tree already, so a
//             poisoned entry adds nothing an author could not do in the PR.
//             Everything else (`push`, `release`, `workflow_run`, `schedule`,
//             `workflow_dispatch`, `workflow_call`, `pull_request_target`,
//             comment events ...) runs code from a trusted ref.
//   powerful  the job reads a secret other than GITHUB_TOKEN, or its token can
//             write. No `permissions:` at job or workflow level counts as
//             write: that is the repository default today.
//   restores  a step restores a cache: `actions/cache` (not `/save`, not
//             `lookup-only`), any other action with `cache` in its name,
//             `setup-go` unless `cache: false`, `setup-node`/`setup-python`/
//             `setup-java` with a `cache:` (or `setup-node@v5+` without
//             `package-manager-cache: false`), `pnpm/action-setup` with a
//             `cache:`, `docker/setup-buildx-action` unless
//             `cache-binary: false`, `docker/setup-qemu-action` unless
//             `cache-image: false`, `oven-sh/setup-bun` unless
//             `no-cache: true`, a `cache-from` on a docker build action, or
//             `--cache-from` in a `run:` script.
//
// The one restore allowed in a trusted, powerful job is a `cache:` input that
// is on ONLY for pull_request and merge_group, written exactly as PR_ONLY_CACHE
// below. A job-level or step-level `if:` is not credited: it is too easy to
// widen without noticing what it was holding back.
//
// yorkie's shared harness core carries the same rule
// (`scripts/agent/trusted-cache.mjs`); this repository must pass it at the
// next sync. That checker also flags `anthropics/claude-code-action` without
// `path_to_bun_executable`, which only the core's own `agent-*.yml` use and
// which the sync fixes, so it is not repeated here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS = path.join(REPO, ".github", "workflows");

// Reached through packages/cli, as agent-workflow-guards.test.mjs does.
const YAML = (() => {
  try {
    return createRequire(path.join(REPO, "packages/cli/package.json"))("yaml");
  } catch (e) {
    throw new Error(`this test reads YAML with \`yaml\`, a dependency of packages/cli — run pnpm install (${e.message})`);
  }
})();

const UNTRUSTED_EVENTS = new Set(["pull_request", "merge_group"]);

const PR_ONLY_CACHE =
  /^\$\{\{\s*\(\s*github\.event_name\s*==\s*'pull_request'\s*\|\|\s*github\.event_name\s*==\s*'merge_group'\s*\)\s*&&\s*'[a-z]+'\s*\|\|\s*''\s*\}\}$/;

function eventsOf(wf) {
  const on = wf.on ?? wf[true]; // YAML 1.1 readers turn a bare `on` into `true`.
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on;
  if (on && typeof on === "object") return Object.keys(on);
  return [];
}

function canWrite(perms) {
  if (perms === undefined || perms === null) return true;
  if (typeof perms === "string") return perms !== "read-all";
  return Object.values(perms).some((v) => v === "write");
}

function readsSecret(node) {
  const text = JSON.stringify(node ?? null);
  return /\bsecrets\.(?!GITHUB_TOKEN\b)\w/.test(text);
}

/**
 * The major version of `uses`: from the ref, or for a SHA pin from its
 * `# vN` comment (YAML drops comments, so `pins` is read from the raw text).
 * A pin with no such comment is assumed to be the newest.
 */
function majorOf(uses, pins) {
  const m = /@v(\d+)/.exec(uses);
  if (m) return Number(m[1]);
  const pinned = pins.get(uses);
  return pinned ?? Infinity;
}

function pinsOf(text) {
  const pins = new Map();
  for (const m of text.matchAll(/uses:\s*(\S+@[0-9a-f]{40})\s+#\s*v(\d+)/gi)) pins.set(m[1].toLowerCase(), Number(m[2]));
  return pins;
}

/** Why `step` restores a cache, or null. */
function restoreOf(step, pins = new Map()) {
  const uses = typeof step.uses === "string" ? step.uses.toLowerCase() : "";
  const w = step.with ?? {};
  const on = (v) => v !== undefined && v !== null && v !== false && v !== "" && v !== "false";
  const gated = (v) => typeof v === "string" && PR_ONLY_CACHE.test(v.trim());
  if (typeof step.run === "string" && /--cache-from\b/.test(step.run)) return "`--cache-from` in run";
  if (!uses) return null;
  const name = uses.split("@")[0];
  if (name === "actions/cache/save") return null;
  if (name === "actions/cache" || name === "actions/cache/restore") {
    return w["lookup-only"] === true || w["lookup-only"] === "true" ? null : `${name} restore`;
  }
  if (name === "pnpm/action-setup") return on(w.cache) ? "pnpm/action-setup cache" : null;
  if (name === "docker/setup-buildx-action") return w["cache-binary"] === false || w["cache-binary"] === "false" ? null : "setup-buildx cache-binary";
  if (name === "docker/setup-qemu-action") return w["cache-image"] === false || w["cache-image"] === "false" ? null : "setup-qemu cache-image";
  if (name === "oven-sh/setup-bun") return w["no-cache"] === true || w["no-cache"] === "true" ? null : "setup-bun cache";
  if (name === "actions/setup-go") return on(w.cache ?? true) && !gated(w.cache) ? "setup-go cache" : null;
  if (name === "actions/setup-node") {
    if (on(w.cache)) return gated(w.cache) ? null : "setup-node cache";
    if (majorOf(uses, pins) >= 5 && on(w["package-manager-cache"] ?? true)) return "setup-node@v5+ package-manager-cache";
    return null;
  }
  if (/^actions\/setup-(python|java|dotnet|ruby)$/.test(name)) return on(w.cache) && !gated(w.cache) ? `${name} cache` : null;
  if (/^docker\/(build-push|bake)-action$/.test(name)) return on(w["cache-from"]) ? "docker cache-from" : null;
  if (name.includes("cache")) return name;
  return null;
}

/** `file:job: reason` for every trusted, powerful job that restores a cache. */
function violations(file, text) {
  const wf = YAML.parse(text);
  const pins = pinsOf(text);
  const trusted = eventsOf(wf).some((e) => !UNTRUSTED_EVENTS.has(e));
  if (!trusted) return [];
  const out = [];
  for (const [name, job] of Object.entries(wf.jobs ?? {})) {
    if (!powerful(wf, job)) continue;
    for (const step of job.steps ?? []) {
      const why = restoreOf(step, pins);
      if (why) out.push(`${file}:${name}: ${why}`);
    }
  }
  return out;
}

function powerful(wf, job) {
  const perms = job.permissions !== undefined ? job.permissions : wf.permissions;
  return canWrite(perms) || readsSecret(job) || readsSecret(wf.env) || job.secrets !== undefined;
}

function workflows() {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: f, text: readFileSync(path.join(WORKFLOWS, f), "utf8") }));
}

test("no trusted job holding a secret or a write token restores an Actions cache", () => {
  const all = workflows();
  assert.ok(all.length >= 10, `found only ${all.length} workflows`);
  assert.deepEqual(all.flatMap((w) => violations(w.file, w.text)), []);
});

test("the checker sees the publish jobs as trusted and powerful", () => {
  // Without this, a parser change that made every job look harmless would pass.
  const expected = {
    "ci.yml": ["verify-self"],
    "docker-publish.yml": ["build", "merge"],
    "npm-publish.yml": ["publish"],
    "publish-ghpage.yml": ["build-and-deploy"],
  };
  for (const [file, jobs] of Object.entries(expected)) {
    const wf = YAML.parse(readFileSync(path.join(WORKFLOWS, file), "utf8"));
    assert.ok(eventsOf(wf).some((e) => !UNTRUSTED_EVENTS.has(e)), `${file} has no trusted trigger`);
    for (const j of jobs) assert.ok(wf.jobs[j] && powerful(wf, wf.jobs[j]), `${file}:${j} not seen as powerful`);
  }
});

test("the checker refuses the restores it exists to catch", () => {
  const wf = ({ on = "push", perms = "    permissions:\n      contents: read\n", step }) =>
    `on: ${on}\njobs:\n  j:\n    runs-on: x\n${perms}    steps:\n      - run: echo \${{ secrets.T }}\n${step}`;
  const nodeCache = (v) => `      - uses: actions/setup-node@v4\n        with:\n          cache: ${v}\n`;
  const gate = "${{ (github.event_name == 'pull_request' || github.event_name == 'merge_group') && 'pnpm' || '' }}";

  const bad = {
    setupNode: nodeCache("pnpm"),
    setupNodeV5Default: "      - uses: actions/setup-node@v5\n",
    setupNodeShaPin: "      - uses: actions/setup-node@0123456789abcdef0123456789abcdef01234567\n",
    setupNodeShaPinV5: "      - uses: actions/setup-node@0123456789abcdef0123456789abcdef01234567 # v5.0.0\n",
    setupNodeWidenedGate: nodeCache(`"\${{ github.event_name != 'release' && 'pnpm' || '' }}"`),
    setupNodePushGate: nodeCache(`"\${{ (github.event_name == 'pull_request' || github.event_name == 'push') && 'pnpm' || '' }}"`),
    setupGoDefault: "      - uses: actions/setup-go@v6\n",
    setupPython: "      - uses: actions/setup-python@v5\n        with:\n          cache: pip\n",
    actionsCache: "      - uses: actions/cache@v4\n        with:\n          path: x\n          key: k\n",
    actionsCacheRestore: "      - uses: actions/cache/restore@v4\n        with:\n          path: x\n          key: k\n",
    rustCache: "      - uses: Swatinem/rust-cache@v2\n",
    dockerCacheFrom: "      - uses: docker/build-push-action@v6\n        with:\n          cache-from: type=gha\n",
    actionsCacheLookupFalse: "      - uses: actions/cache@v4\n        with:\n          path: x\n          key: k\n          lookup-only: false\n",
    pnpmCache: "      - uses: pnpm/action-setup@v4\n        with:\n          cache: true\n",
    buildxDefault: "      - uses: docker/setup-buildx-action@v3\n",
    qemuDefault: "      - uses: docker/setup-qemu-action@v3\n",
    bunDefault: "      - uses: oven-sh/setup-bun@v2\n",
    buildxFlag: "      - run: docker buildx build --cache-from type=gha .\n",
  };
  for (const [label, step] of Object.entries(bad)) {
    assert.equal(violations(label, wf({ step })).length, 1, label);
  }

  const ok = {
    shaPinV4: "      - uses: actions/setup-node@0123456789abcdef0123456789abcdef01234567 # v4.4.0\n",
    noCache: "      - uses: actions/setup-node@v4\n        with:\n          node-version: 22.x\n",
    prOnlyGate: nodeCache(`"${gate}"`),
    setupGoOff: "      - uses: actions/setup-go@v6\n        with:\n          cache: false\n",
    setupNodeV5Off: "      - uses: actions/setup-node@v5\n        with:\n          package-manager-cache: false\n",
    cacheLookupOnly: "      - uses: actions/cache@v4\n        with:\n          path: x\n          key: k\n          lookup-only: true\n",
    pnpmNoCache: "      - uses: pnpm/action-setup@v4\n",
    buildxOff: "      - uses: docker/setup-buildx-action@v3\n        with:\n          cache-binary: false\n",
    qemuOff: "      - uses: docker/setup-qemu-action@v3\n        with:\n          cache-image: false\n",
    bunOff: "      - uses: oven-sh/setup-bun@v2\n        with:\n          no-cache: true\n",
    cacheSaveOnly: "      - uses: actions/cache/save@v4\n        with:\n          path: x\n          key: k\n",
    dockerCacheToOnly: "      - uses: docker/build-push-action@v6\n        with:\n          cache-to: type=gha\n",
  };
  for (const [label, step] of Object.entries(ok)) {
    assert.deepEqual(violations(label, wf({ step })), [], label);
  }

  // Each trigger and each kind of power is enough on its own.
  const cache = nodeCache("pnpm");
  const noSecret = (s) => s.replace("echo ${{ secrets.T }}", "echo hi");
  for (const on of ["push", "release", "workflow_run", "schedule", "workflow_dispatch", "workflow_call", "pull_request_target", "[pull_request, push]"]) {
    assert.equal(violations(on, wf({ on, step: cache })).length, 1, `trigger ${on}`);
  }
  assert.deepEqual(violations("pr-only", wf({ on: "[pull_request, merge_group]", step: cache })), []);
  assert.equal(violations("no-perms", noSecret(wf({ perms: "", step: cache }))).length, 1, "no permissions block = write");
  assert.equal(violations("write", noSecret(wf({ perms: "    permissions:\n      id-token: write\n", step: cache }))).length, 1, "a write scope");
  assert.equal(violations("write-all", noSecret(wf({ perms: "    permissions: write-all\n", step: cache }))).length, 1, "write-all");
  assert.deepEqual(violations("read-only", noSecret(wf({ step: cache }))), [], "read token, no secret");
  assert.deepEqual(violations("github-token", wf({ step: cache }).replace("secrets.T", "secrets.GITHUB_TOKEN")), [], "GITHUB_TOKEN is judged by its permissions");
  assert.equal(violations("wf-env", noSecret(wf({ step: cache })).replace("jobs:", "env:\n  K: ${{ secrets.K }}\njobs:")).length, 1, "a workflow-level env secret");
});
