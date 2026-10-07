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
