# Tighten the Agent Workflow Guard — Task Tracking

`scripts/test/agent-workflow-guards.test.mjs` holds the trusted steps of the
four installing jobs (`agent-fix` `fix`, `agent-review-panel` `fix`,
`agent-iterate-ci` `iterate`, `agent-review-reply` `reply`) to an allow-list
between the install and the agent. A mutation review found workflow edits the
guard still accepts. None is in the workflows today; each would be a break if a
later edit made it. Design: `docs/design/agent-pipeline/agent-install.md`
("From the job's first step to the agent").

## Plan

- [x] `github-script` steps: an allow-list of the calls and reads the stretch
      uses today, read by a small tokenizer that refuses what it cannot read
      (other calls, bracket access, `constructor`, `Function`, `eval`,
      `require`, `import`, tagged templates, assignments outside a
      declaration)
- [x] Assignments: shell assignments (alone or as a prefix) only to the local
      names used today; step, job and workflow `env:` keys only from the names
      used today; never `PATH`, `NODE_*`, `RUNNER_*`, `GITHUB_*`, `BASH_ENV`,
      `ENV`, `LD_*`, `DYLD_*`, `GIT_*`, `npm_config_*`, `NPM_CONFIG_*`,
      `PNPM_*`; no `defaults:`; `working-directory` only the runner's temp
- [x] Lexer: refuse `$'…'`, `$"…"`, any `${…}` but `${NAME}` and
      `${NAME:-literal}`, `$[`, `((`, `-v`/`-R` for `test`/`[`/`printf`
- [x] Arguments: `git rev-parse <ref>` / `git ls-remote <origin|github URL>
      <pattern>` with no options; `cut`/`date` take no file operands;
      `test`/`[` operators from a list; `gh pr comment` takes a PR, `--body`
      or a `--body-file` the job itself wrote directly under `$RUNNER_TEMP`
- [x] The allow-list starts at the branch checkout, not the install: the
      side-directory steps, the digest record and verify steps pinned to their
      exact text
- [x] A staged script used after the install runs only if its check ran or the
      install did not: no status function in its `if:`, and the record and
      install steps share one plain condition
- [x] A named mutation case per rule (the review's m1–m21 and more), each
      failing for the rule it names; today's four jobs pass
- [x] Re-run the review's `mut.py` against the final tree
- [x] `pnpm verify:self`, actionlint
- [x] Design doc section, PR body
- [x] Second review: read the workflows with a YAML parser (plain-scalar
      continuations, `run: | # …`, continued `if:`, keys after a block); a
      character allow-list on the four files (no CR, tab, U+2028/2029 or
      non-ASCII beyond today's eleven); no anchors, aliases, merge keys, tags
      or second documents
- [x] `//` comments in github-script end at every JavaScript line terminator
- [x] The stretch starts at the job's first step: a pre-branch allow-list up
      to the first checkout of anything but `main`, the strict one after
- [x] Refuse job `container:` and `services:`
- [x] Named edits on a synthetic fixture job; accepted edits as cases too;
      messages that name what is allowed (`core.notice` and the other log
      calls allowed; "quote the variable")
- [ ] PR

## Decisions

- **No workflow changes.** Every rule is written so the four jobs pass as they
  are; a rule that only today's workflows could not meet would have been a
  behaviour change, not a guard.
- **A staged use runs when its check ran, or when the install did not** —
  rather than "the use's `if:` equals the check's". The credential picker in
  `agent-fix` has no `if:`, and the panel's no-credential page runs set-state
  precisely when the record and install were skipped. What makes a skipped
  check safe there is that the install was skipped with it, so the guard holds
  the record and the install to one plain condition and refuses any status
  function on a use.
- **`gh pr comment --body-file` stays, for files the job wrote itself directly
  under `$RUNNER_TEMP`.** Two steps post a body file: the no-credential page
  writes its own in the same step, and the round record is written by the
  guard step before the branch checkout. Refusing the option would mean
  rewriting both; allowing any path lets a step publish any file it can read.
- **printf's single-quoted words are not inspected for `$(` or backticks.**
  The page step's Markdown uses backticks inside single-quoted printf
  arguments. With `-v` refused and the format required to be a literal, printf
  evaluates nothing (its integer conversions do not evaluate arithmetic —
  checked against bash 5.2). `test`/`[` get the check.
- **The record and verify steps are pinned to their text** instead of
  widening the command list with `cd`, `find`, `sort`, `xargs`, `sha256sum` and
  `rm`; the digest test runs exactly that text.
- **`yaml` from `packages/cli`, not a new root dependency.** The lockfile
  already resolves `yaml@2.8.3` for the CLI; the guard reaches it with
  `createRequire`, as `verify-browser-lanes.mjs` reaches Playwright.
- **The stretch starts at the job's first step, with two policies**, rather
  than at a recognised branch ref. Recognising every spelling of a branch
  checkout is a list that cannot be finished; holding the steps before it to
  an allow-list that can only check out `main` makes the first checkout of
  anything else the only door, whatever its ref says.
- **Mutation cases run on a synthetic fixture job**, so they never depend on
  where a harmless step sits in the real workflows; the real workflows are
  held by the main test, and the fixture by its own "accepted" test.
- **The github-script allow-list is of calls, not of namespaces**: the seven
  calls and the reads used today, not `github.rest.issues.*`. A new call is a
  deliberate widening.
