# Lessons — gather the agent-pipeline design docs into one folder

Paired with
[`20260919-agent-pipeline-docs-todo.md`](20260919-agent-pipeline-docs-todo.md).

## Before implementation

**A folder that already exists under the name you want is not necessarily a
doc folder.** `docs/design/agentic-dev-loop/` held only HTML walkthrough
assets for the top-level doc of the same name. Reading the README would never
have revealed it — `verify:doc-index` checks `.md` only, so an asset directory
needs no row and appears nowhere in the index. Listing the directory was the
only way to find it.

**Two of the three gates that guard `docs/design` are keyed differently, and
only one of them fails loudly.** `verify:doc-index` and `verify:doc-links`
both walk structure, so a bad move goes red. But
`harness.config.json`'s entropy advisory is keyed on an exact designDir-relative
path (`"doc": "harness-engineering.md"`), and `.github/CODEOWNERS` on an exact
repo path. The first turns a *deliberate* negative reference into a blocking
finding on the next run; the second removes a maintainer-review requirement
with no error at all. Grep config and ownership files by basename before any
doc move — the markdown link graph does not contain them.

**A stale comment found during the survey is worth fixing in the same PR only
when the move is what makes it wrong.** `review-panel.mjs:1449-1450` claims
nested design docs are unchecked; `listDesignDocs` has recursed for some time,
so the claim was already false. It is in scope here because the move changes
the numbers the comment quotes, not because a survey happened to pass it.

## During implementation

**Partition parallel agents by FILE, not by topic.** Six of the inbound links
lived in `docs/design/README.md`, which also needed a whole new section. Handing
both jobs to the agent that owned "inbound links" would have been the topical
split and would have raced the agent restructuring the table. Giving README.md
to exactly one owner, and telling the other agent explicitly that it did not own
it, cost one sentence in each prompt and removed the only real conflict.

**Serialize edits that address the same file at different altitudes.** One agent
rewrote relative links in `agent-pipeline.md` by matching link text; the heading
re-parenting touched `##`/`###` markers in the same file. Both are "edit
agent-pipeline.md". Running them together would have been fine most of the time,
which is exactly what makes it a bad bet. Splitting them into two phases cost
one extra round-trip.

**A move survey organized by failure mode will miss the failure modes it is not
organized by.** The inventory was built as "which links break when a file moves
one directory deeper", and it was complete for that question. It missed a
same-folder link killed by the *rename* and a set of localhost URLs in HTML
that were instructions rather than links. Give each agent the *rule* (old path →
new path, including the rename) and tell it the list is a starting point, not a
contract — all three misses were found that way.

**An agent that finds its correct fix blocked by a stale test should fix the
test, and say so loudly.** Correcting a comment in `review-panel.mjs` broke
three assertions in `review-panel.test.mjs` that had pinned the wrong claim.
Reporting "cannot proceed" would have been obedient and useless; silently
inverting them would have hidden a real scope decision. The useful behaviour was
both: do it, and name the file as the one to re-reconcile if another agent
touched it.

## Self-review rounds

**Round 0 (void).** All six lenses returned "Reviewer did not produce a valid
verdict: Cannot find package `@anthropic-ai/claude-agent-sdk`". `scripts/agent`
had a `node_modules` but not that package, so the check *looked* satisfied. Six
identical `[major]` findings with no file cited is the shape of a harness that
did not run, not of a branch with six problems — reporting it as a review would
have been reporting a skipped gate as a passing one. Fixed with
`cd scripts/agent && npm ci` and re-run with `--fresh`.

**Round 1 — correctness / test adequacy.** Five lenses clean, `blast-radius`
blocking, one finding, and it was right:
`walkthrough/deck.html:486` still pointed at
`../design-editor/images/foreign-install.png`. Correct from
`docs/design/agentic-dev-loop/`; from `docs/design/agent-pipeline/walkthrough/`
it resolves to a path that does not exist. Fixed to `../../`.

That is the third instance of the same root cause as the misses in "During
implementation", and the sharpest: the sweep agent that owned those files was
told the pages' relative cross-links "must NOT change, since the whole directory
moved together". True of the three sibling `.html` links, false of the one
reference that pointed *out* of the directory — and the instruction's own
reasoning ("moved together") is exactly what does not hold for an escaping path.
A blanket "do not touch relative links" is never right after a move; the rule is
per-link, and the question is whether the target moved with it. Audited all 12
relative `src`/`href` targets in the three pages afterwards; the rest resolve.

**Round 2 — design fit / simplification / blast radius.** _(pending)_
