# Lessons — Model refresh: Claude Opus 4.8 → Opus 5

## A model swap is a string change plus whatever defaults moved underneath it

The dangerous part of this change was not any of the ten model strings. It was
one silent default: **Opus 4.8 runs no thinking when the `thinking` parameter is
omitted; Opus 5 runs adaptive thinking.** Since `max_tokens` bounds thinking and
response text *together*, `classify.mjs`'s hand-written `max_tokens: 400` would
have been eaten by thinking before the structured record was emitted, and
`JSON.parse` would have thrown on a truncated response.

That call site was invisible from the plan, which assumed the model lived only in
`claude_args`. The distinction that mattered: `--max-turns` is a *turn* budget
managed by `claude-code-action`, so the five workflow call sites are immune;
`classify.mjs` is the one caller that hits the raw Messages API and sets a token
ceiling itself. Worth asking on any future model change: *which call sites set
`max_tokens` by hand?*

## Check the capability before writing a prompt rule about it

The plan called for a subagent cap, because Opus 5 delegates more readily than
4.8. But `Task` is absent from every `--allowedTools` list, so delegation is
already impossible — the cap would have been dead text that looked like a
control.

Generalisable: when the guidance says "instruct the model not to do X", first
check whether X is even reachable. A mechanical allow-list beats a prompt
instruction, and a prompt instruction that duplicates one is worse than nothing
because it implies the allow-list is not doing the work.

## macOS bash 3.2 mis-parses quoted heredocs inside `$( )`, by apostrophe parity

Adding a single sentence containing `the issue's scope` to
`agent-implement.yml`'s prompt made the whole `run:` block fail `bash -n`
locally, with a misleading `unexpected EOF while looking for matching ''` pointing
at a line 20 lines further down.

Minimal repro on `/bin/bash` (3.2.57, what macOS ships):

```bash
T=$(cat <<'P'
the issue's field
the PR's lane
P
)
```

That parses. Add one more apostrophe anywhere in the heredoc body and it does
**not** — bash 3.2 tracks quote state inside `$( )` even for a *quoted* heredoc,
where the body should be literal. Bash 5.x (ubuntu-latest, what CI runs) is fine.

Two consequences:

- The change would have shipped and worked in CI. It was caught only because the
  prompt builder was executed rather than eyeballed — the same habit that caught
  the unbounded checklist in #569.
- **The prompt currently contains an even number of apostrophes and is therefore
  one edit away from breaking local verification again.** Cheapest durable fix is
  to keep prompt prose apostrophe-free; the alternative is switching the heredoc
  out of `$( )` into a plain redirect, which is a larger change than this PR
  should carry.

## Verification that verifies nothing

Everything green here — YAML parses, 101 tests, `verify:self`, prompt renders —
exercises **zero** model behaviour. It is entirely possible for all of it to pass
and for `claude-opus-5` to be a bad id, or unavailable to this token, and for the
first real autonomous run to fail on it.

That gap is why the smoke-test workflow gained a `model` input. `auth-smoke.mjs`
already honoured `SMOKE_MODEL`; the workflow simply never passed it, so the
"pre-flight" the plan described was not executable. A documented manual step that
cannot actually be performed is worse than no step, because it reads as coverage.
