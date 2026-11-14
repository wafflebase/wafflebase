# Harden the Agent Jobs' Dependency Install — Task Tracking

Four agent jobs install a pull request's dependencies while holding a token:
`agent-fix` (`fix`), `agent-review-panel` (`fix`), `agent-iterate-ci`
(`iterate`), `agent-review-reply` (`reply`). Goal: before the agent starts, the
job has run nothing the branch wrote and written nothing outside the workspace.
Design: `docs/design/agent-pipeline/agent-install.md`.

## Plan

- [x] Establish by experiment, on pnpm 10.5.2 / Node 22, what decides how each
      job's install command behaves (tree shape, `.npmrc`, pnpmfile, lifecycle
      scripts, `pnpm-workspace.yaml` keys, `package.json` `pnpm.*`,
      `packageManager`, lockfile fields, manifest fields)
- [x] `scripts/agent/install-deps.mjs`: pnpm runs in a container (workspace
      read-write, `.git` read-only, store, pinned pnpm; nothing else), no
      uncontained fallback
- [x] Allow-lists before it: `pnpm-lock.yaml` through a strict reader
      (`install-deps-lockfile.mjs`), every project's `package.json`, main's
      workspace file, `pnpm.*` keys, the pnpm version
- [x] The runner writes nothing under the workspace after the container ran:
      `.npmrc` set-aside and restore happen inside it
      (`install-deps-container.cjs`); branch files are read no-follow, capped
- [x] Checks afterwards: beside the workspace, `$RUNNER_TEMP`, the staged
      scripts, `.git` hooks/config/info, home dotfiles, links anywhere in the
      workspace, the working tree as git sees it
- [x] All four jobs: pnpm + Node before the branch checkout, actions pinned to
      commits, no cache, no persisted checkout credential, scripts staged in
      `$RUNNER_TEMP/agent-tools` (reply too), digest recorded before and
      verified after the install
- [x] No lifecycle script re-run by the setup; the four prompts tell the agent
      to generate the Prisma client
- [x] Reply job reports a failed install on the pull request
- [x] `agent-implement.yml`: `ref: main`, pinned actions, no cache
- [x] Tests: `install-deps.test.mjs` (stubbed runtime for every refusal, real
      Docker + real pnpm for one install, main's own lockfile and manifests
      held to the allow-lists) and `agent-workflow-guards.test.mjs`; every
      assertion mutation-checked
- [x] The experiments re-run against the contained install
- [x] Clean contained install of this repository
- [x] `pnpm verify:self`, actionlint
- [ ] PR; first real run on a runner (not verified locally: Docker as the
      runner user, install time there, the host using the container-installed
      `node_modules`, `pnpm/action-setup` in an empty workspace, the agent's
      push without a persisted checkout credential, the Prisma instruction)

## Decisions

- **Containment first, allow-lists second.** Three rounds of review each found
  another field that steers an install. Listing fields does not converge; a
  container bounds what any of them can reach.
- **A script, not a composite action.** Every installing job already stages
  main's `scripts/agent` before the install; the script rides that.
- **A strict reader instead of a YAML library** for the lockfile: the staged
  scripts have no dependencies, and a reader that accepts only one way of
  writing each thing cannot disagree with pnpm's parser about what it read.
- **`pnpm-workspace.yaml` is compared byte for byte with main's.**
- **The allow-lists are main's shape, and a test holds main to them**, so a PR
  that leaves the shape fails CI on that PR rather than in a later agent round.
- **The agent generates the Prisma client**, not the setup.
- **The pnpm version is pinned in three places** — root `packageManager`,
  `PNPM_VERSION`, the workflows' `version:` — and tests fail when they differ.
