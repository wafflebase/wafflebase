# Lessons — task archive audit

## A checkbox means "pending work". A disclosure is not one.

The reason 65 tasks had piled up in `docs/tasks/active/` was **not** authors
forgetting to tick boxes. It was that Verification ledgers were written as
checkboxes:

```markdown
- [ ] **Not verified: an `after-window` record on real data.** The corpus is
      frozen at the reviewed commit, so the assertion is fixtures-only.
- [ ] **Not run:** `verify:self`, `verify:fast`, `verify:browser`.
```

These are honest, valuable records of measurement gaps. But `tasks:archive`
keys on `/^\s*-\s*\[ \]/m`, so each one pins its task in `active/` forever, and
no one can ever resolve it — ticking `- [x] Not verified: X` asserts the
opposite of its own text. 60 such boxes across 19 files.

**Rule going forward:** in a `## Verification` section, write gap statements as
plain bullets (`- Not verified: …`), never as checkboxes. Reserve `- [ ]` for
work someone can actually do. When auditing, the tell is grammatical: a box
whose text is a *negative assertion* is a disclosure, not a task.

The fix was to the docs, not to `tasks-archive.mjs`. Teaching the script to
skip a "Not verified, and why" heading would have been a heuristic keyed on
exact prose, and would silently change archive semantics for every future task.

## Watch for the bootstrap-paradox box

`20260810-notifications-todo.md` ended with `- [ ] pnpm tasks:archive && pnpm
tasks:index before merge`. It cannot be ticked until archive runs, and archive
will not run while it is unticked. Any todo whose final step is "archive this
todo" is self-blocking. Tick it as part of the run that performs the step.

## Never pipe a verification command through `tail`

I ran `pnpm verify:fast 2>&1 | tail -25` in the background and the harness
reported **exit code 0**. That was `tail`'s exit code. The real run had 3
failed backend suites and `ELIFECYCLE exit 1`, and I briefly reported the gate
as green on the strength of it.

This repeats a lesson already recorded for `git push`
(`project_prepush_harness_reports`) — it generalizes to every gate. Redirect to
a file and check `$?` on the command itself:

```bash
pnpm verify:fast > /tmp/vf.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/vf.log
```

## A green-looking failure may be a stale generated client

The 3 failing suites were `Property 'lakehouseSource' does not exist on type
'PrismaService'` — a stale Prisma client after #868's
`20260817000000_add_lakehouse_source` migration, not a code defect and nothing
to do with a docs-only diff. `pnpm backend exec prisma generate` clears it.
Worth checking before diagnosing anything else when backend suites fail at
*compile* time while every assertion still passes (858/858 here).

## Audit agents need an explicit "do not reword" rule

Instructing eight parallel agents to *only* flip `- [ ]` → `- [x]` on verified
evidence, and never reword or restructure, kept the sweep reviewable — the
whole diff for a file was N single-character changes. It also surfaced stale
prose as *reports* rather than silent edits: two claims ("the lane has never
run on GitHub", "no merged renderer reads the grid") are now false, and the
agents flagged them instead of rewriting history. Fix those in a separate,
visible change.
