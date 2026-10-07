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

