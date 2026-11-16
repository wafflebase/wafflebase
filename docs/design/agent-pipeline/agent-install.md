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

Since the switch to yorkie's shared harness core, the four jobs are yorkie's
workflows, copied unchanged, and the install is this repository's toolchain
action, `.github/actions/agent-toolchain`: `action.yml` fetches the pinned
pnpm and runs `install-deps.mjs` beside it, which is the install described
here. The jobs use main's copy of the action, checked out beside the branch.

## The property

Before the agent starts, the job has executed nothing the branch wrote and has
written nothing outside the workspace on the branch's behalf. The branch is
data to the install: it names registry packages, and the install fetches
exactly those.

This is a property of the *setup*, not of the agent. The agent runs the
branch's code by design — that is what verifying is — and holds the token it
pushes with. What the setup must not do is run that code first, for its own
convenience.

## How it is kept

Two layers. **The install runs in a container** that can reach the workspace
and nothing else of the runner — that is what holds when a manifest, a
lockfile or a package turns out to steer the install in a way nobody listed.
**Before that, everything the install reads is read by allow-list** — that is
what refuses the ways that are known, early and with a message.

### The container

pnpm is never run on the runner itself. `install-deps.mjs` runs
`docker run` with:

| The container gets | How |
| --- | --- |
| The workspace | read-write, at the same absolute path, so what pnpm records about it holds afterwards |
| The workspace's `.git`, and each `.trusted-*` checkout in it | **covered** by an empty read-only directory: the install can neither read nor change them, so a credential a checkout persisted in `.git/config` is not in there |
| pnpm's store, `$RUNNER_TEMP/agent-pnpm/store` | read-write, at the same path |
| The pnpm the action fetched | read-only at `/opt/pnpm`; it is located on `PATH` and its version read, not executed |
| `install-deps-container.cjs` | that one file of the staged scripts, read-only |
| Node | the image's: `node:22-bookworm-slim`, pinned by digest |
| An environment | `CI=true`, `HOME=/tmp/home` — nothing of the job's |
| Privileges | the runner's uid:gid, `--cap-drop=ALL`, `no-new-privileges`, read-only image, an in-memory `/tmp` |
| A network | `--network=bridge`: out to the registry, not the runner's own namespace |

It does **not** get: the action's directory, `$RUNNER_TEMP/agent-tools`, the runner's
`$HOME`, the job's environment, the container runtime's socket, or any other
path. It does share the runner's kernel, and can reach the network.

The image is pulled with an empty client configuration (`DOCKER_CONFIG` points
at a fresh empty directory), so no registry credential the runner holds is
used.

So whatever an install is led to do, the files it can change are the
workspace's working tree and the store. A path that climbs out of the
workspace lands in the container's own filesystem, which is discarded; a write
into `.git` fails.

**The runner works around the container, and that work is held to a rule: once
the container has run, the runner writes nothing under the workspace.** A
write there after the install goes wherever the tree then leads it. So the one
piece of file work the install needs — setting the branch's `.npmrc` files
aside and putting them back — is done *inside* the container, by
`install-deps-container.cjs`, where the furthest it can reach is what the
container was given. Before the container runs, the runner reads the branch's
files only as regular files of bounded size, opened without following a link.
After it, the runner only reads.

There is no fallback. If `docker` cannot be run the step fails. GitHub's
`ubuntu-latest` image ships Docker (client and server) and the runner user may
use it.

One script, `.github/actions/agent-toolchain/install-deps.mjs` (with
`install-deps-lockfile.mjs`), run by the toolchain action from main's copy of
it, checked out to `.trusted-toolchain` beside the branch.

That staged directory can itself pass through a symbolic link. Node resolves
a module's own `import.meta.url` through links but leaves `argv[1]` as typed,
so a "was I run directly" check that compares the two as written answers
"imported" and exits 0 having done nothing. The toolchain action's
`install-deps.mjs` takes both sides through `realpath` (`isDirectRun`), so a
linked path still installs or refuses. #1152 fixed the same comparison in every
tool under `scripts/agent/` with a shared helper; the switch to the shared core
(which still compares as written) superseded that copy, and the fix is being
carried upstream so that every repository on the core gets it.

| What decides how an install behaves | What the agent jobs do with it |
| --- | --- |
| Which pnpm runs | Fetched by the toolchain action: one tarball from the npm registry, checked against a pinned sha512 before it is unpacked under `$RUNNER_TEMP`, nothing of the workspace read. The script reads the version of the package behind `pnpm` on `PATH` and refuses any other than `PNPM_VERSION`; `packageManager` and the action's `PNPM_VERSION` must name the same version; version switching is off for the install |
| Lifecycle scripts (root, workspace packages, dependencies) | `--ignore-scripts` |
| `.pnpmfile.cjs` and other hooks | `--ignore-pnpmfile` |
| What gets installed | `--frozen-lockfile`, and the lockfile allow-list below |
| `.npmrc`, in any directory | Set aside for the install and put back afterwards, inside the container. Main carries none; if it ever does, a copy ships beside the script and stands in |
| The job's environment (`npm_config_*`, `PNPM_*`, `NODE_OPTIONS`, tokens) | Not passed into the container at all. The runtime's client gets `PATH`, `HOME` and `DOCKER_HOST` |
| Where pnpm writes | `modules-dir` and `virtual-store-dir` pinned inside the workspace; the store pinned to `$RUNNER_TEMP/agent-pnpm/store`, outside it. The same store is exported to later steps (`npm_config_store_dir` via `$GITHUB_ENV`) so a pnpm command the agent runs agrees with the install |
| `pnpm-workspace.yaml` (projects, and in pnpm 10 settings) | Must be byte-identical to main's, shipped as `install-deps.workspace.yaml` beside the script |
| `pnpm.*` in the root `package.json` | Only the keys in `ALLOWED_PNPM_KEYS` (`overrides`); any other key is refused |
| The shape of the tree | Refused before pnpm runs: any `node_modules` (a fresh checkout has none), any symbolic link that does not lead into the working tree — followed one component at a time the way the kernel follows it, each link on the way resolved where it stands before the next `..` is applied, with every place passed through and the place reached required to be in the working tree; a target under `/proc`, `/dev` or `/sys` is refused by its text, since it is a different place for every process that follows it — a project directory that is itself a link, a second `.git`, a package manifest in YAML or JSON5 form, anything that cannot be listed. The workspace path itself must be absolute, without `..`, and not a link; `.git` must be a real directory |
| `pnpm-lock.yaml` | Read by allow-list — see below |
| `package.json` of every project | Read by allow-list — see below |
| Afterwards | Every project's `node_modules` is a real directory whose entries resolve inside the workspace; nothing appeared beside the workspace or in `$RUNNER_TEMP` outside pnpm's own directory; the directory the script ran from is byte-for-byte what it was; `.git/hooks`, `.git/config` and `.git/info` are what they were; the package managers' configuration in the runner's home (`.npmrc`, `.yarnrc*`, `.pnpmrc`, `.config/pnpm`) is what it was; every symbolic link in the workspace — those the checkout brought as well as new ones — leads into the working tree, as written and as resolved; there is no second `.git`; nothing in the workspace is unlistable (what cannot be read is a refusal, never a skip); and a digest of the working tree — everything but `.git` and the `node_modules` directory of each project the lockfile installs for; every path, mode, link target and file body, each length-prefixed so that two different trees cannot read as one — is what it was. Anything else named `node_modules` is part of the tree like any other entry. The runner computes all of this by reading files; it runs no other program in the workspace, git included |
| Dependency caches | None: no `cache:` on any setup action in an agent workflow |
| The checkout's credential | The branch checkout persists the agent's own narrow token in `.git/config`, the one it pushes with; `.git` is covered in the container, so the install cannot read it |

Every refusal is a `::error::install-deps: …` line and a non-zero exit before
pnpm is reached.

### The lockfile allow-list

The lockfile decides what is fetched, from where, and how. A check that looks
for known-bad values in it is only as good as its list, and only as good as its
reading of YAML. So the script accepts a lockfile only if **everything** in it
is of a kind main's own lockfile uses:

- top-level sections: `lockfileVersion` (`'9.0'`), `settings`, `overrides`,
  `importers`, `packages`, `snapshots` — nothing else (no patches, no pnpmfile
  checksum, no catalogs);
- every package is keyed `name@version` and its `resolution` is exactly
  `{integrity: sha512-…}` — fetched from the registry by name and version,
  verified by hash. No `tarball`, `type`, `repo`, `commit`, `directory` or
  `path`, in any spelling;
- every project is a plain relative path under the root; every dependency is a
  `specifier` and a `version` and nothing else; a specifier is a version range
  or a `workspace:` range; a `link:` lands exactly on another project of the
  workspace;
- every reference from a project or a snapshot lands on a snapshot that was
  itself checked, and every snapshot on a package.

The file is read by a strict reader of its own (`parseStrictYaml`), not a YAML
library — the staged scripts have no dependencies installed — and the reader
accepts only the one plain form pnpm writes: block mappings indented by two,
plain or single-quoted one-line scalars, one-line flow collections. Double
quotes, escapes, anchors, aliases, tags, merge keys, comments, multi-line
scalars, tabs, duplicate keys and anything YAML would read as a number, a date
or null are refused. The point of the strictness is that two readers must not
disagree: within this subset the strict reader and pnpm's parser build the same
tree (checked by a differential run of 1.5 million mutated documents against
the parser pnpm 10.5.2 bundles; none accepted with a different reading).

`toolchain.test.mjs` holds **main's own** `pnpm-lock.yaml` and manifests to
the allow-list, so a pull request that adds a dependency from outside the
registry — or whose lockfile pnpm wrote in a form the reader does not take —
fails CI on that pull request, where the choice is visible: change the
dependency, or widen the allow-list on purpose.

What pnpm 10.5.2 reads from a lockfile that reaches a subprocess, a URL or a
path, and what the allow-list does with it:

| Field | Reaches | Now |
| --- | --- | --- |
| `packages.*.resolution.type: git` + `repo`, `commit` | a `git` subprocess with those arguments | refused (`resolution` is integrity only) |
| `resolution.tarball` (remote URL, git-host archive, `file:`) | a fetch from that URL / a local file / a build of the fetched tree | refused |
| `resolution.type: directory` + `directory` | a copy from that path | refused |
| `resolution.path` | a sub-directory of a fetched tree | refused |
| package key (`name@version`) | the registry URL of the tarball | must be a package name and a semver |
| `packages.*.name`, `version` | which registry scope / tarball is fetched | refused |
| `importers` keys | the directories `node_modules` is written to | plain paths under the root, real directories |
| `importers.*.*.version: link:` | the target of a symlink | another project of the workspace |
| `importers.*.*.version: file:` / snapshot `file:` keys | a copy from that path | refused |
| `importers.*.publishDirectory`, `dependenciesMeta` | a link target / an injected copy | refused |
| `patchedDependencies` | a patch file applied to a package | refused |
| `pnpmfileChecksum`, `packageExtensionsChecksum`, `catalogs`, `ignoredOptionalDependencies` | comparison only | refused (main has none) |
| `settings.*` | comparison with configuration | two known keys, booleans |
| `overrides` | comparison with `package.json` | plain versions and ranges |
| `engines`, `cpu`, `os`, `libc`, `hasBin`, `deprecated`, `peerDependencies*`, `optional`, `transitivePeerDependencies` | platform filtering, messages, bin linking of the fetched package | allowed, shape-checked |

### The manifest allow-list

Each project's `package.json` is read the same way. Its top-level keys must be
ones on a list (`MANIFEST_KEYS`): those this repository's manifests use, plus
plain metadata. `directories`, `man`, `dependenciesMeta`, `resolutions`,
`bundledDependencies`, `workspaces` and anything unheard of are refused.

Every string an install turns into part of a path is held to a grammar with no
separator and no `..` in it:

| String | Becomes | Rule |
| --- | --- | --- |
| `name` | `node_modules/<name>`, and the command name when `bin` is a string | an npm package name |
| keys of `dependencies` etc., and of the lockfile's importers | `node_modules/<key>` | an npm package name |
| keys of `bin` | `node_modules/.bin/<key>` | `[A-Za-z0-9_][A-Za-z0-9._-]*` |
| values of `bin` | the file a command points at | a relative path inside the package, no `..` |
| `publishConfig` | (`directory` would redirect a link) | `access`, `tag`, `provenance` only |
| package and snapshot keys in the lockfile | `node_modules/.pnpm/<key>/…` | `name@version`, with peers |

The names and `bin` entries of **registry** packages are the registry's, not
the branch's, and are not checked here; the container is what bounds them.

A package's own content — its tarball entries and the `bin` names in its
manifest — is the registry's, not the lockfile's. With pnpm 10.5.2, entries and
bin names that point out of the package directory are kept inside it or skipped
(checked by experiment).

`.github/agent-harness/toolchain.test.mjs` runs the script and the action's
step — every refusal against a stubbed pnpm and container runtime, and one
install in a real container with the real pnpm.
`scripts/test/agent-workflow-guards.test.mjs` holds the four jobs to using
main's copy of the action, and no inline install, cache, other persisted
credential or build step beside it.

## Step order

All four jobs set the toolchain up the same way, after the branch checkout:
clear `.trusted-toolchain` → check main's `.github/actions/agent-toolchain` out
to it (sparse, no credential) → `uses: ./.trusted-toolchain/.github/actions/agent-toolchain`
→ add `/.trusted-toolchain/` to `.git/info/exclude`, so the directory cannot
be committed to the branch. It stays until the job ends: the runner re-reads a
local action's definition before its post steps.

| Job | How main's `scripts/agent` gets to `$RUNNER_TEMP/agent-tools` |
| --- | --- |
| `agent-fix` / panel `fix` | The job starts on a checkout of main and copies `./scripts/agent` and `.github/agent-harness` out before the branch replaces the workspace |
| `iterate` | After the branch checkout: clear `.trusted-agent`, check main out to it (sparse), copy it out, remove it — before the toolchain runs |
| `reply` | Main's scripts for the credential picker are checked out to `.trusted-cred` after the toolchain, and moved out of the workspace whole |

Nothing trusted is run from inside the workspace but the toolchain action,
from main's checkout. A path there is one the branch's own tree can reach — by
a link, or by Node's module resolution walking up into an installed
`node_modules` — which is why that checkout's path is cleared first.

### From the job's first step to the agent

**How a workflow is read.** The guard reads each workflow with a YAML parser
(`yaml`, which the repository already depends on through `packages/cli`), so a
step's `run`, `if`, `env`, `with` and keys are what GitHub reads, not what a
line looks like: a plain scalar continued on the next line, a block header
with a comment (`run: | # …`), an `if:` continued onto a second line, a key
written after a `run: |` block. Before parsing, the four workflow files are
held to a character allow-list: no control character but the newline (no
CR, no tab), no U+2028/U+2029, and no non-ASCII character but the twelve they
use today (`— – … → ≠ ⚠ ⏸ U+FE0F ✅ 🛑 🤖 👋`). A lone CR or a line separator ends
a line for one reader and not for another, and a look-alike letter reads as a
command name it is not. One document, no parse error, no anchor, alias, merge
key or tag.

**Where the branch enters.** The checked stretch starts at the job's first
step, under two policies split at the first `actions/checkout` of anything
but `ref: main` — the branch checkout, however its ref is spelled. Before it
the workspace holds main's tree or nothing, and the steps may run main's own
`./scripts/agent/*.mjs`, but they are held to an allow-list that can bring
nothing else in or set up anything for later: a checkout only of `main` (no
`repository:`), the toolchain and token actions, downloads to `/tmp` or the
runner's temp directory, `github-script` under the reader below, the two
pinned copies of main's scripts out of the workspace, and shell steps under
the command table below (no `git checkout`, no `gh pr checkout`, no
`$GITHUB_ENV`/`$GITHUB_PATH`) with no `env:` name from the never-list. So the
branch can only enter at that checkout, and from it on the rules below hold.
None of the four jobs sets `container:` or `services:`, whose image, options, volumes
and env this guard does not read.

Two rules hold for the trusted steps that run after the branch is checked out
and before the agent, and the guard test enforces both:

- **Nothing is written into the workspace, run from it, or set up to steer a
  later step**, bar one pinned line: `.git/info/exclude`, directly after the
  toolchain. A write there goes wherever the tree leads it, whatever was
  checked before. The CI-fix job's download of the failed run's lane reports
  goes to `$RUNNER_TEMP/ci-reports`, and main's `scripts/ci/summarize-ci.mjs`,
  staged to `$RUNNER_TEMP/trusted-scripts`, is pointed at it.
- **Nothing is written into the staged copies.** A redirect, `mkdir`, `chmod`
  or download under `$RUNNER_TEMP` must land outside every directory the job
  staged main's scripts to.

The guard reads this stretch by **allow-list**, not by a list of forbidden
spellings: there are too many ways to write a file, and more to change what a
later command finds. A step is one of these, or the test fails.

- **Pinned steps**, compared with their shape: the side-directory clear (which
  must come before each side checkout); the side checkout of main (exactly
  `ref`, `path`, `sparse-checkout` of main's scripts, configuration or
  toolchain action, `persist-credentials: false`); the staging (main's
  `scripts/agent` first, then its configuration and the variable naming it,
  its `scripts/`, and the side directory's removal) and the move of a side
  directory out whole; the toolchain step, handed nothing; and the
  `.git/info/exclude` line after it. These are the steps that must run `cp`,
  `mv` or `rm`, which no other step may, and none takes a `shell:`,
  `working-directory:` or `continue-on-error:`.
- **Shell steps**, read into their simple commands (command substitutions
  included). Every command is one of these, with these arguments:

  | Command | Arguments |
  | --- | --- |
  | `echo`, `true`, `exit` | anything; none; one literal status |
  | `printf` | a literal format that is not an option first (`-v` assigns, and an array subscript in its name runs `$( … )`) |
  | `test`, `[` | one literal `-f`/`-s`/`-n`/`-z`/`-d`/`-e` and an operand, or two operands around a literal `=`/`!=` — so the operator is never a variable, and never `-v` or `-R` |
  | `cut`, `date`, `tail` | options only (`-f`, `-d`; `-u`, `+format`; `-c <n>`): standard input, no file |
  | `openssl` | `rand -hex <n>` |
  | `mkdir`, `chmod` | `-p` / `+x` and one path under `$RUNNER_TEMP`, outside the staged copies |
  | `git` | `rev-parse <ref>`, or `ls-remote` with `origin` or a `github.com` URL and patterns that begin with a literal; no option at all, so nothing names a program (`--upload-pack`, `-u`, `--exec`, `-c`). Two exact forms more, the fix-scope hook's: `config core.hooksPath` to a directory under `$RUNNER_TEMP`, and `rev-parse --path-format=absolute --git-path hooks` |
  | `gh` | `pr comment`, one pull request, `--body`, or a `--body-file` the job wrote directly under `$RUNNER_TEMP` — in this step before the command, or named by a step before the branch was checked out; any other file is one `gh` would publish. And three exact forms: the branch-head read (`api "repos/$GITHUB_REPOSITORY/git/ref/heads/$BRANCH" --jq .object.sha`), the pre-agent token's revocation (`api -X DELETE installation/token`), the failed run's log (`run view "$RUN_ID" --log-failed`) |
  | `node` | a staged script first: an `.mjs` under a directory the job staged main's copy to, named directly (`"$RUNNER_TEMP/agent-tools/<name>.mjs"`) or through a variable set to that directory |

  A shell assignment is refused unless it stands alone and names one of the
  variables the scripts use (`ACTUAL`, `DIAG`, `UNREAD`, `EOF_MARK`, `HOOKS`,
  `EFFECTIVE`). Every redirection names `$GITHUB_OUTPUT`,
  `$GITHUB_STEP_SUMMARY`, a path under `$RUNNER_TEMP` outside the staged
  copies, stderr or `/dev/null`. A step runs in the workspace or in
  `${{ runner.temp }}`, nowhere else.
- **Actions**: a download into one directory under `$RUNNER_TEMP` (not a staged
  copy), `actions/setup-node` given only a literal `node-version`, and
  `github-script` with only `script`, `retries` and `github-token`. Its code is
  read by a small tokenizer and held to the calls and reads the workflows make
  — `github.rest.pulls.list`/`get`, `github.rest.issues.createComment`/
  `updateComment`, `github.rest.repos.getCollaboratorPermissionLevel`,
  `github.rest.actions.listWorkflowRuns`, `github.paginate` over `listWorkflowRuns`/`listComments`, `core.setOutput`,
  `core.setFailed`, the log calls `core.debug`/`info`/`notice`/`warning`/
  `error`, `core.summary.addRaw(…).write()`, `String`, `Number`, `parseInt`,
  `JSON.parse`, `context.*` and `process.env.<NAME>` reads (or `const { … } =
  process.env`), and `filter`/`some`/`includes`/`startsWith`/`reduce` on its
  own values. No bracket access but `[<integer>]`, no
  optional call, no `constructor`, `Function`, `eval`, `require`, `import`,
  tagged template or `${{ }}`, and no assignment outside a `const`/`let`
  declaration (destructuring included). A `//` comment ends at any line
  terminator, as JavaScript ends it. So `core.addPath` and
  `core.exportVariable` — which would reach every later step — are refused by
  name and by omission.

**Environment.** Every `env:` name — of the step, the job and the workflow — is
one the jobs use today, and never `PATH`, `BASH_ENV`, `ENV`, `HOME`, `IFS`,
`NODE_*`, `RUNNER_*`, `GITHUB_*`, `ACTIONS_*`, `LD_*`, `DYLD_*`, `GIT_*`,
`npm_config_*`, `NPM_CONFIG_*` or `PNPM_*`: each steers how a later command is
found or what it loads, and the redirect and `node` rules above trust the
values of the runner's own variables. Neither the workflow nor the job sets
`defaults:`.

**What it does not read, it refuses.** A backtick, an arithmetic expansion or
command (`$((`, `$[`, `((`), ANSI-C or locale quoting (`$'…'`, `$"…"`), a
parameter expansion other than `${NAME}` or `${NAME:-literal}` (`${x@P}` and
an array subscript both run substitutions), a `#` inside a command
substitution, a here-document, a GitHub expression inside a script, an
unterminated quote, or a key the guard does not read. A line starting with `#`
inside a `run:` or `script:` block is script, as YAML reads it; a script
with no command it can read is refused.

**When a staged script may run.** Any time before the agent. wafflebase's own
workflows ran the install on the runner, so they recorded a digest of the
staged scripts before it and checked it before every later use. The toolchain
action runs the install in a container that is given the workspace and nothing
else of `$RUNNER_TEMP`, and fails the step if anything outside the workspace
changed (`toolchain.test.mjs`), so the staged copies are out of its reach and
there is no digest.

The test carries a named workflow edit for each rule, which must be refused
by that rule, and edits a maintainer may reasonably make (a new `echo` step, a
renamed or moved step, a comment line, `timeout-minutes`, a folded `run: >-`,
`core.notice`), which must be accepted. Both are applied to a synthetic job of
the same shape, `scripts/test/fixtures/agent-guard-workflow.yml`, not to the
real workflows, so renaming or moving a step there never moves a case.

## Lifecycle scripts are not replaced

The workspace has two install scripts. The root `postinstall` wires `.githooks`,
which the agent jobs do not want (and which it skips when `CI` is set; see
`harness-engineering.md`, "Local Git Hooks", for what CI checks instead). The backend's runs `prisma generate`.

Generating the Prisma client is a build step of the branch — it loads the
branch's schema and whatever generators the schema names — so it is not run by
the setup either. The agent runs it as part of verifying; the prompts of all
four jobs say so, and a test holds them to it. `agent-fix.yml` used to re-run it
in a step of its own after an `--ignore-scripts` install; that step is gone for
the same reason the scripts are off. No workflow-owned step needs the client.

## When the install is refused

| Job | What the pull request sees |
| --- | --- |
| `agent-fix` | The placeholder comment becomes "could not start the fix agent — a setup step failed before it ran" |
| panel `fix` | The `stalled` job pages ("fix failed") |
| `iterate` | "Page if the fix produced no commit" runs under `always()` and pages |
| `reply` | Nothing: a red job. wafflebase's own reply job commented; the shared one's report job posts only the agent's reply. A known gap, pinned by the guard and listed as an upstream candidate in `.github/agent-harness/README.md` |

In each case the reason is the `::error::install-deps:` annotation on the run.

## What this costs

- **A pull request that changes the pnpm version, `pnpm-workspace.yaml`, a
  `pnpm` setting other than `overrides`, or that depends on anything but a
  registry package (a git or URL dependency, a local tarball, a patch) gets no
  agent fix round until it is merged** — and CI on that pull request fails the
  allow-list test until the allow-list is widened on purpose. Such a change
  needs a person; the refusal says so.
- **Installs are uncached and contained.** Each run pulls the image (about
  80 MB compressed) and installs from a cold store. Locally — Docker in a Linux VM on macOS, where file sharing dominates — a cold contained install of this repository (1,795 packages) took 2.5 to 3.5 minutes, against half a minute uncontained. On a Linux runner the container should add the image pull and little else; that is not measured. The jobs'
  walls are 45 and 90 minutes.
- **The jobs need Docker on the runner.** GitHub-hosted `ubuntu-latest` has it;
  a self-hosted runner without it cannot run these jobs.
- **The read-only `git ls-remote` calls in these jobs are anonymous** until the
  agent step configures its credential. That is enough for a public repository
  and would not be for a private one.

## What it does not watch

The checks after the install look at the places a later step reads from: beside
the workspace, `$RUNNER_TEMP`, the action's directory, git's hooks and
configuration, the package managers' dotfiles in `$HOME`, the working tree. They do not watch the rest of `$HOME`,
`/tmp` or the rest of the machine. What keeps the install out of
those places is the list above, not a check afterwards.

**What the container still shares with the runner**: the network, the kernel,
the workspace's working tree and the store directory. An install can still be
led to write a file *inside the working tree* (the working-tree digest then
fails the step), and a package fetched from the
registry is whatever the registry serves for that name, version and hash.
Neither runs anything: the next thing to execute files from the workspace is
the agent.

pnpm is passed no proxy settings. A self-hosted runner that reaches the
registry through a proxy needs them added to `PASSED_ENV`, deliberately.

## What is trusted

Stated plainly, the property rests on these and on nothing else:

- **A name is its bytes.** Every name and link text is read as bytes and must
  be valid UTF-8; one that is not is refused. A name decoded leniently comes
  back with a replacement character in it, and that string names a different
  file — so a check would be made on whatever the branch put under that other
  name. (macOS refuses such names; ext4, what the runners use, takes them.)
- **Where a link leads is what the kernel says.** Locations are judged by
  physical resolution (`realpath(3)`), never by simplifying a path's text
  first: the two differ as soon as a `..` follows a link.
- **Docker's isolation and the kernel under it.** The container's mount
  namespace is what keeps the install to the workspace and the store. A fault
  there is outside what this design defends.
- **The image, by digest**, and the registry that serves it.
- **The pnpm the action fetched**, by version and sha512, and the registry it
  came from. It is located on `PATH`, not chosen by the branch.
- **`PATH`, Node and Docker on the runner** as they are when the step starts:
  nothing before the install step has run anything of the branch's.
- **No trusted step before the agent follows a path in the workspace or runs a
  program from it.** The guard holds every step from the job's start to the
  allow-list above — main's own scripts before the branch checkout, the strict
  list after it.
- **Everything after the agent is untrusted**, as before: the agent has a
  shell.
- **The container has open egress and no credential.** It can reach the
  network; it holds nothing worth sending.
- **The store under `$RUNNER_TEMP` is shared with the agent's later pnpm
  commands.** What the install put there is what those commands link from.

## When pnpm moves

`PNPM_VERSION` is pinned, in `install-deps.mjs` and in `action.yml` with the
tarball's sha512, and `toolchain.test.mjs` fails when they or the root
`packageManager` differ, on purpose: the lists above were established by
experiment against pnpm 10.5.2, which reads settings from `.npmrc`, the command
line, the environment, the `pnpm` field of the root `package.json`, and a fixed
list of keys in `pnpm-workspace.yaml`. Later versions read more settings from
the workspace file. Before moving the pin, check for the new version that:

1. no setting readable from a file in the tree changes where the install writes
   or what it executes once the flags above are given — in particular any new
   file or key pnpm starts reading;
2. `--ignore-scripts` still covers workspace, dependency and git-hosted
   packages, and `--ignore-pnpmfile` still covers every way a hook file can be
   named;
3. the lockfile format is still version `'9.0'` and no field outside the table
   above reaches a subprocess, a URL or a path;
4. the YAML parser it bundles still reads the strict subset the same way
   (re-run the differential check);
5. the real-pnpm test in `toolchain.test.mjs` still passes.

## Follow-ups

- **The `always()` steps after the agent** that ran staged scripts with a token
  in the agent's own job are gone: the shared workflows moved that work to
  report jobs on a fresh runner.

## Out of scope

`agent-implement.yml` installs main, not a branch: its `implement` job runs
the toolchain action from the workspace after checking out `ref: main`, with
no cache, holding a token that reads only and no App secret. Its `prepare` job
refuses to start the agent unless `main` requires a human approval that a
later push invalidates ("Require approval of the most recent reviewable
push", or a ruleset with `require_last_push_approval: true`); that setting is
a precondition of the shared harness, not of this install. GitHub's own
actions in the agent workflows are referenced by major tag in the shared core;
the guard pins that list, and pinning them is an upstream candidate.
