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

These files are written ahead of the switch. Until the sync runs, today's
`scripts/agent/**` and `agent-*.yml` (wafflebase's own copy of the harness)
neither read this directory nor use the toolchain action; they keep running
as they are. The sync then writes `upstream.json` here, replaces the shared
half, and from then on `npm test` and `npm run test:repo` in `scripts/agent`
grade the copy and this directory. `scripts/agent/install-deps*`, which the
toolchain action came from, are deleted by that sync.

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

## What changes at the switch

What wafflebase's own copy of the harness does today that the shared one will
not, or will do differently. Each is known and accepted for now:

- **Renaming a Jest e2e or frontend integration suite away is not recorded.**
  The shared test-removal rules take `*.test.*` and `*.spec.*` for names a
  runner picks up, not `*.e2e-spec.ts` or `*.integration.ts`; those files are
  still test files by their directory, so tests added, removed or switched
  off in them are recorded. yorkie-team/yorkie#2362 adds the two suffixes;
  `repo.test.mjs` pins the gap and says when to flip it.
- **The issue classification step goes.** The shared `agent-implement.yml`
  has none.
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
- **`scripts/ci/summarize-ci.mjs` in yorkie** has the two rendering issues
  fixed here: a cut can leave a fence open, and the lane name in the heading
  is not escaped.
