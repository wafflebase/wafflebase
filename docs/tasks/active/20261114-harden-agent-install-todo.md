# Harden the Agent Jobs' Dependency Install — Task Tracking

Four agent jobs install a pull request's dependencies while holding a token:
`agent-fix` (`fix`), `agent-review-panel` (`fix`), `agent-iterate-ci`
(`iterate`), `agent-review-reply` (`reply`). Goal: before the agent starts, the
job has run nothing the branch wrote and written nothing outside the workspace.
Design: `docs/design/agent-pipeline/agent-install.md`.

## Plan

- [x] Establish by experiment, on pnpm 10.5.2 / Node 22, what decides how each
      job's current install command behaves (tree shape, `.npmrc`, pnpmfile,
      lifecycle scripts, `pnpm-workspace.yaml` keys, `package.json` `pnpm.*`,
      `packageManager`)
- [x] `scripts/agent/install-deps.mjs`: refuse before pnpm runs, neutralise
      branch pnpm configuration, pin the flags and the pnpm version, re-check
      afterwards; `install-deps.workspace.yaml` is main's workspace file
- [x] All four jobs call it from main's copy; pnpm + Node set up before the
      branch checkout, pinned to a commit, explicit pnpm version, no cache
- [x] No lifecycle script re-run by the setup: the `prisma generate` step leaves
      `agent-fix.yml`, the four prompts tell the agent to run it
- [x] `agent-implement.yml` (installs main): pinned setup, no cache
- [x] Behavioural tests (`install-deps.test.mjs`: stubbed pnpm for every
      refusal, real pnpm for one install) and workflow guards
      (`agent-workflow-guards.test.mjs`); each assertion mutation-checked
- [x] Re-run the experiments against the hardened install: every case refused
      before pnpm or inert
- [x] Clean install of this repository through the script (exit 0, 32 s cold)
- [x] `pnpm verify:self` lanes for scripts and agent tests, actionlint
- [ ] PR; first real run on a runner (not verified locally: `pnpm/action-setup`
      with an explicit version in an empty workspace, store location on the
      runner, the agent following the Prisma instruction)

## Decisions

- **A script, not a composite action.** Every installing job already stages
  main's `scripts/agent` before the install; the script rides that.
- **`pnpm-workspace.yaml` is compared byte for byte with main's**, rather than
  parsed for an allow-list of keys. No YAML parser is needed in a script that
  runs without dependencies, and it stays correct for a pnpm that reads more
  keys from the file. Cost: a PR that edits the file gets no agent fix round
  until merged.
- **`package.json` `pnpm.*` is an allow-list of keys** (`overrides`), because
  `overrides` changes with every security patch and cannot be compared whole.
- **The agent generates the Prisma client**, not the setup. `prisma generate`
  is a build step of the branch.
- **The pnpm version is pinned in three places** — root `packageManager`,
  `PNPM_VERSION`, the workflows' `version:` — and tests fail when they differ,
  so moving pnpm is a decision that includes re-running the audit.
