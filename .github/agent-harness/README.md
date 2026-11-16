# .github/agent-harness

wafflebase's half of the agent harness: everything the `@claude` command
surface needs to know about this repository. The other half — `scripts/agent/**`
and every `.github/workflows/agent-*.yml` — is meant to be the same bytes in
every repository that runs the harness, copied from
[yorkie-team/yorkie](https://github.com/yorkie-team/yorkie) by its
`scripts/agent/sync.mjs`. Once it is here, `scripts/agent/README.md`
specifies every configuration key, the prompt frames, the glob dialect and
the toolchain action's contract.

## Status

`scripts/agent/**` and every `agent-*.yml` are a copy of yorkie-team/yorkie's
core, written by `sync.mjs` and recorded in `upstream.json`. `npm test` and
`npm run test:repo` in `scripts/agent` grade the copy and this directory, and
`npm run check:upstream` asks yorkie whether the record is true. To take a
newer core, see "Adopting and syncing" in `scripts/agent/README.md`.

## What is this repository's

| File | What it is |
|---|---|
| `config.json` | Every repository-specific value: the CI-defining paths (`harness.config.json`'s `ci.ciConfig`, which `repo.test.mjs` holds it to), the file-class rules, the lens source globs, the ANTLR artefacts left out of a reviewed diff, the sentences the fixer prompts are completed with, the test rules (`vitest`, which covers Vitest, Jest and node:test), the App's logins (`yorkie-agent`), the hunters' two MCP tools, and the shape of a wafflebase API key for redaction |
| `coverage-note.md` | What `ci.yml`'s lanes prove and do not, told to every lens. The same text wafflebase's panel used |
| `repo.test.mjs` | Grades the two files above, and the toolchain action, against this repository (`npm run test:repo` in `scripts/agent`). The reason each configured entry exists is written there, beside the assertion that pins it |
| `toolchain.test.mjs` | The toolchain action's suite: the install's refusals with a stub container runtime, one real install in a real container, the action's pinned pnpm and its step run end to end with a stub download. It needs nothing of the shared core, and it is run by the `scripts:tests` lane through `scripts/test/agent-toolchain.test.mjs` on every pull request — not by `npm run test:repo`, which runs `repo.test.mjs` alone under a 60-second limit this suite would use most of. `repo.test.mjs` keeps the action's static pins |
| `repo.snapshot.json` | Every configured value and rendered prompt, recorded. A change to a gate, a prompt or a value shows its before and after in this file's diff (`AGENT_HARNESS_RECORD=1 npm run test:repo` records it again) |
| `upstream.json` | Which repository and commit the shared half was copied from, and the manifest digest. Written by `sync.mjs`, never by hand |
| `../actions/agent-toolchain/action.yml` | One step, no other action, no cache. It fetches pnpm 10.5.2 — one tarball from the npm registry, checked against a pinned sha512 before it is unpacked under the runner's temp directory — and runs `install-deps.mjs` with a scrubbed environment; then puts the fetched pnpm on the PATH of later steps |
| `../actions/agent-toolchain/install-deps.mjs` | The install (#1142): refuses a tree with a `node_modules`, a link out of the working tree or into `.git` or any `.trusted-*` name, a branch-changed workspace file or pnpm setting; installs in a container (image pinned by digest, local Docker only) whose only writable mount is the workspace, with an empty read-only directory over `.git` and over the trusted checkout the script runs from, and no environment; then checks that nothing outside the working tree changed. Every other `.trusted-*` entry is walked as the branch's. `install-deps-lockfile.mjs` holds the lockfile and manifests to an allow-list, `install-deps-container.cjs` is the half that runs in the container, `install-deps.workspace.yaml` is main's `pnpm-workspace.yaml` |

## What changed at the switch

What wafflebase's own copy of the harness did that the shared one does not, or
does differently. Each is known and accepted for now:

- **`@claude fix` on an issue needs re-approval after the last push on
  `main`.** The shared `agent-implement.yml` refuses to start ("Require a
  human approval on main", `scripts/agent/branch-protection.mjs`) unless the
  required review on `main` also requires approval of the most recent
  reviewable push: classic protection's "Require approval of the most recent
  reviewable push", or a ruleset with `require_last_push_approval: true`.
  wafflebase's own gate asked only for one approval. Turn the setting on
  before `AGENT_PIPELINE_ENABLED` goes back on. It applies to human merges
  too: an approval no longer survives a later push to the pull request.

- **The issue classification step is gone.** The shared `agent-implement.yml`
  has none, and `scripts/agent-arms/classify.mjs`, which only that step ran,
  was removed with its `ANTHROPIC_API_KEY` use. Labels it applied
  (`type:…`, `bugclass:…`) stay on the pull requests that have them.
- **`WAFFLEBASE_AGENT_AUTONOMOUS` is no longer set**, so
  `scripts/hooks/require-ai-disclosure.sh` stops firing in agent jobs; the
  shared report jobs and the ready gate check disclosure.
- **More READMEs are prose.** The shared rules make every `README.md` prose,
  which no code lens reads: `packages/README.md`, `scripts/README.md` and
  `plugins/wafflebase/README.md` move from `code`. The template catalogue's
  README, which states a rule, is kept as policy (`config.json`).
- **The issue-to-PR prompt drops** the SessionStart-hook claim, the
  self-review step and its `<!-- agent-self-review -->` marker (nothing reads
  it), the `set-state.mjs … implementing` step (the shared workflow sets the
  state itself), and writes a new design document as
  `docs/design/<topic>.md` rather than `docs/design/<area>/<topic>.md`.
- **Fix rounds push with the shared scope hook**, not `--no-verify`; the root
  `postinstall` leaves `.githooks` unwired under CI so an agent's own
  `pnpm install` cannot re-arm the minutes-long pre-push.
- **A refused install in the reply job is silent.** wafflebase's reply job
  commented on the pull request when its install failed; the shared one's
  report job posts only the agent's reply, so the person who wrote `@claude`
  sees a red run and nothing else. The fix job, the panel's fix job and the
  CI-fix job still report it. `scripts/test/agent-workflow-guards.test.mjs`
  pins the gap and says when it closes.
- **GitHub's own actions are pinned to a major tag** (`actions/checkout@v4`,
  `setup-node@v4`, `github-script@v7`, `download-artifact@v4`,
  `upload-artifact@v4`) in the jobs that hold a token while a branch is in the
  workspace; wafflebase pinned every action to a commit. The third-party ones
  (`create-github-app-token`, `claude-code-action`) are still commit-pinned. The
  guard holds the list exactly.
- **No digest of the staged scripts.** The install runs in the toolchain
  action's container, which cannot reach `$RUNNER_TEMP`, so the record and
  check steps around wafflebase's install are gone (`toolchain.test.mjs`
  holds the containment).
- **`agent-implement` runs in four jobs, and its agent does not push.**
  `prepare` makes the App calls; `implement` installs main with the toolchain
  action (lifecycle scripts off, rather than wafflebase's own install with
  scripts on; the prompt tells the agent to generate the Prisma client) and
  runs the agent with a read-only token and no App secret; `finish` checks the
  agent's commits with `bundle-handoff.mjs` and pushes them with a token
  minted only then; `report` posts the no-App and no-PR comments. A branch
  whose commits touch `.github/workflows/**`, or that is not built on the
  recorded base, is not pushed at all.
- **Every agent is handed a pinned Bun installed without the Actions cache**
  (`oven-sh/setup-bun`, `no-cache: true`), instead of the one
  `claude-code-action` would restore from it. The core's
  `scripts/agent/trusted-cache.mjs` holds every workflow here, wafflebase's
  own included, to restoring no cache in a trusted job that holds a secret or
  a write token; `scripts/test/trusted-cache.test.mjs` is this repository's
  own reading of the same rule.
- **A sweep runs every 30 minutes** (`agent-sweep.yml`, `17,47 * * * *`,
  behind `AGENT_PIPELINE_ENABLED`). wafflebase had nothing like it. On each
  open agent-managed pull request it takes at most one action, recorded in a
  hidden comment: after a usage-limit page, once the backoff has passed, it
  deletes those pages, drops `agent:blocked` and re-runs the head's CI (up to
  three times per head); for a PR left in `agent:reviewing` with nothing
  running, it re-runs CI once, and pages a human if that did not help. It
  holds `actions`, `pull-requests` and `issues: write`. A dispatch with
  `dry_run` logs what it would do without acting; run one before the first
  scheduled sweep.
- **The core is linted for bugs only.** `eslint.config.mjs` turns off three
  style rules the core does not follow (`no-unused-vars`, `no-useless-escape`,
  `no-control-regex`) for `scripts/agent/**`; `no-undef` and the rest stay.

## Upstream candidates

- **One trusted checkout when the toolchain step runs.** `install-deps.mjs`
  leaves out of its walks, and covers in the container, only the
  `.trusted-*` checkout it runs from. Any other `.trusted-*` directory is
  read as the branch's: with a `.git` it is refused as a second `.git`;
  without one (a `cp -R` copy) it is mounted read-write into the container
  like the rest of the workspace, where a write is caught afterwards but a
  read is not. All five shared jobs comply today (`.trusted-agent` and
  `.trusted-protection` are removed before the step, `.trusted-cred` is
  checked out after it). An assertion in the core's `config-wiring.test.mjs`
  that no other `.trusted-*` exists in the workspace at that step would keep
  a future job from breaking it quietly.
- **The reply job's report should say when the agent never ran**, as
  `agent-fix.yml`'s report does (`neverRan`), so a refused toolchain is not a
  silent red run.
- **Pin GitHub's own actions to a commit** in the jobs that hold a token
  while a branch is in the workspace, as the third-party ones already are.
- **Lint findings in the core**: unused imports in
  `prior-findings.test.mjs` and `review-surface.test.mjs`, unused
  destructured bindings in `config-wiring.test.mjs` and `test-removals.mjs`,
  a redundant escape in `config-wiring.test.mjs`, a control-character range
  in a `test-removals.mjs` regex. Harmless, but each is a
  rule wafflebase cannot apply to the copy until upstream fixes it.
- **`scripts/ci/summarize-ci.mjs` in yorkie** needs the four rendering fixes
  made here: a cut can leave a fence open; a fence indented by up to three
  spaces is not counted as one when closing it; the lane name and exit code
  in the headings are not escaped; and a `lanesTotal` that is not a
  non-negative integer is rendered as it is.
