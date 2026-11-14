---
title: agent-install
target-version: 0.6.15
---

# The Dependency Install of the Agent Jobs

Four jobs check out a pull request's branch and install its dependencies so an
agent can verify a change: `agent-fix.yml` (`fix`), `agent-review-panel.yml`
(`fix`), `agent-iterate-ci.yml` (`iterate`) and `agent-review-reply.yml`
(`reply`). When the install runs, the workspace is the branch and the job
already holds an App token, and the steps that follow run main's staged scripts
with credentials. This document states what the install guarantees, where each
guarantee is enforced, and what to redo when pnpm moves.

## The property

Before the agent starts, the job has executed nothing the branch wrote and has
written nothing outside the workspace on the branch's behalf. The branch is
data to the install: it names packages, and the install fetches exactly those.

This is a property of the *setup*, not of the agent. The agent runs the
branch's code by design — that is what verifying is — and holds the token it
pushes with. What the setup must not do is run that code first, for its own
convenience.

## How it is kept

One script, `scripts/agent/install-deps.mjs`, run by all four jobs from main's
copy of `scripts/agent` (never the branch's).

| What decides how an install behaves | What the agent jobs do with it |
| --- | --- |
| Which pnpm runs | Set up by `pnpm/action-setup` (pinned to a commit) with an explicit `version`, **before** the branch is checked out. The script asks the binary for its version from an empty directory and refuses any other than `PNPM_VERSION`; `packageManager` must name the same version; version switching is off for the install |
| Lifecycle scripts (root, workspace packages, dependencies) | `--ignore-scripts` |
| `.pnpmfile.cjs` and other hooks | `--ignore-pnpmfile` |
| What gets installed | `--frozen-lockfile` |
| `.npmrc`, in any directory | Set aside for the install, put back afterwards. Main carries none; if it ever does, a copy ships beside the script and stands in |
| Where pnpm writes (`modules-dir`, `virtual-store-dir`) | Pinned on the command line |
| `pnpm-workspace.yaml` (projects, and in pnpm 10 settings) | Must be byte-identical to main's, shipped as `scripts/agent/install-deps.workspace.yaml` |
| `pnpm.*` in the root `package.json` | Only the keys in `ALLOWED_PNPM_KEYS` (`overrides`); any other key is refused |
| The shape of the tree | Refused before pnpm runs: any `node_modules` (a fresh checkout has none), any symbolic link that does not resolve inside the workspace and outside `.git` |
| Paths in `pnpm-lock.yaml` | Every importer and every `link:` / `file:` / `directory:` target must be a plain path under the root; the file must be in the plain form pnpm writes |
| Afterwards | Every project's `node_modules` is a real directory whose entries resolve inside the workspace, and nothing appeared beside the workspace |
| Dependency caches | None: no `cache:` on any setup action in an agent workflow |

Every refusal is a `::error::install-deps: …` line and a non-zero exit before
pnpm is reached.

`scripts/agent/install-deps.test.mjs` runs the script — every refusal against a
stubbed pnpm, and one install against the real one.
`scripts/test/agent-workflow-guards.test.mjs` holds the four jobs to calling it
from a trusted location, with the toolchain set up before the branch and pinned,
and no inline install, cache or build step beside it.

## Step order

| Job | Order |
| --- | --- |
| `agent-fix` / panel `fix` | trusted main checkout → stage `scripts/agent` to `$RUNNER_TEMP/agent-tools` → pnpm + Node → branch checkout → `node "$RUNNER_TEMP/agent-tools/install-deps.mjs"` |
| `iterate` | pnpm + Node → branch checkout → clear `.trusted-agent`, check main out to it, stage to `$RUNNER_TEMP/agent-tools` → install from there |
| `reply` | pnpm + Node → branch checkout → clear `.trusted-cred`, check main out to it → `node .trusted-cred/scripts/agent/install-deps.mjs` |

A script rather than a composite action: every job already has main's
`scripts/agent` in hand before the install, so the install rides the staging
that exists instead of adding a second trusted checkout and a directory that has
to outlive the job.

## Lifecycle scripts are not replaced

The workspace has two install scripts. The root `postinstall` wires `.githooks`,
which the agent jobs do not want. The backend's runs `prisma generate`.

Generating the Prisma client is a build step of the branch — it loads the
branch's schema and whatever generators the schema names — so it is not run by
the setup either. The agent runs it as part of verifying; the prompts of all
four jobs say so. `agent-fix.yml` used to re-run it in a step of its own after an
`--ignore-scripts` install; that step is gone for the same reason the scripts
are off.

## What this costs

- **A pull request that changes the pnpm version, `pnpm-workspace.yaml`, a
  `pnpm` setting other than `overrides`, or adds a `.npmrc` setting the install
  needs, gets no agent fix round until it is merged.** The comparison is against
  main's copies. Such a change needs a person; the refusal says so.
- **Installs are uncached.** A cold install of this repository through the
  script took 32 s on a developer machine (1,795 packages). The jobs' walls are
  45 and 90 minutes.

## When pnpm moves

`PNPM_VERSION` is pinned and `install-deps.test.mjs` fails when the root
`packageManager` differs, on purpose: the list above was established by
experiment against pnpm 10.5.2, which reads settings from `.npmrc`, the command
line, the `pnpm` field of the root `package.json`, and a fixed list of keys in
`pnpm-workspace.yaml`. Later versions read more settings from the workspace
file. Before moving the pin, check for the new version that:

1. no setting readable from a file in the tree changes where the install writes
   or what it executes once the flags above are given — in particular any new
   file or key pnpm starts reading;
2. `--ignore-scripts` still covers workspace, dependency and git-hosted
   packages, and `--ignore-pnpmfile` still covers every way a hook file can be
   named;
3. the real-pnpm test in `install-deps.test.mjs` still passes.

## Out of scope

`agent-implement.yml` installs main, not a branch, and keeps its own install
with scripts on; it shares the pinned setup and has no cache. Other actions in
these workflows that are still referenced by tag are a separate change.
