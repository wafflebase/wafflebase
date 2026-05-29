# Design Docs Cleanup — Lessons

Companion to `20260530-design-docs-cleanup-todo.md`. Notes the patterns
and pitfalls that came out of the 4-area audit + 8-commit cleanup of
`docs/design/`.

## Pattern: 4-area parallel audit before any cleanup

The cleanup started with four general-purpose audit agents
(Sheets / Docs / Slides / Common), each given the same shape of prompt:
identify duplication, stale content, granularity mismatch, naming
inconsistency, structure violations, and rank the top consolidation
actions per area. That single round produced a concrete list of
problems that we then split across four PRs.

- Parallel beat sequential because each audit area was independent —
  no agent needed another's findings.
- Constraining each report to a fixed format (`[tag] file:line —
  description — recommendation`) plus a "top 3-5" summary made
  synthesis cheap.
- Worth re-running when scope grows past ~20 docs again.

## Pattern: delete vs. archive vs. absorb

Three disposal paths emerged, with different criteria:

- **Delete** when a successor doc fully absorbs the content. Example:
  `slides-textbox-autogrow.md` → grow-mode section inside
  `slides-text-autofit.md`. Git history is the record.
- **Archive** when the feature shipped, the doc is single-PR-sized,
  and no successor doc has absorbed its content. Example: the
  transient peer-cursor-label UX (4 s timer, hover trigger,
  edge-case clamping) is real design that still applies to
  `overlay.ts`, but it doesn't fit inside any current subsystem
  reference. → `docs/design/archive/` with a README explaining the
  criteria.
- **Absorb** when two docs cover the same surface and one of them is
  authoritative-leaning. Example: `docs-remote-cursor.md` +
  `docs-peer-jump.md` → `docs-presence.md`. Keep the successor name
  domain-neutral so future presence work has a home.

Refusing to pick a path leaves a half-deleted state — see "Staging
bug" below.

## Pattern: umbrella + subfolder for clusters > 5 docs

When a feature grows past 5 sibling docs (the table cluster was 7),
move the per-feature docs into a subfolder and write an umbrella doc
at the parent level that owns:

- The data model
- The CRDT / persistence shape
- The cross-cutting invariants
- A cluster index linking the subfolder docs

The umbrella avoids the "where do I start" problem; the subfolder
stops the parent table-of-contents from drowning under one feature.

Pattern applied: `docs/design/docs/tables/` (UI / resize / copy-paste /
row-splitting / nested) with `docs/design/docs/docs-tables.md` as the
umbrella. README's Docs section dropped from 23 rows to a single
table-cluster row.

## Pattern: single source of truth for shared types

When the same `Worksheet` / `SpreadsheetDocument` / `Document` shape
gets re-declared in 5+ docs, each re-declaration ages independently
and the four-way schema drift is invisible until something breaks.
The fix is mechanical but worth doing in one pass:

1. Pick the canonical home (the doc that owns the CRDT semantics —
   for Sheets that's `collaboration.md`).
2. Inline a "Single source of truth" callout at the top of the
   canonical declaration.
3. Convert every other declaration to **patch form**:

   ```typescript
   // patch on Worksheet
   +  comments?: { [threadId: string]: Thread };
   ```

4. Same rule for numeric drift (grid dimensions, function counts):
   pick the doc whose subject owns the number, point everywhere
   else at it.

Done for Sheets in D4 (commit 88b59cbc).

## Pattern: shipped phases belong in CHANGELOG, not design docs

"Phase N — ✅ shipped" tables in design docs require new readers to
mentally subtract historical context to find what currently
asserts. Two fixes:

- **Compact roadmap.** `docs-wordprocessor-roadmap.md` went from 392
  lines (with per-phase per-feature detail for shipped work) to 147
  lines that point each shipped phase at its design doc. Same shape
  applied to `slides.md` phasing, `slides-shapes.md` P3 roadmap,
  `slides-themes-layouts-import.md` PR Plan, `pivot-table.md`
  Phase 1 checklist.
- **Status note + xref.** When a doc still owns load-bearing
  architecture but its narrative is outdated (the way
  `docs-collaboration.md` still owns the snapshot/restore contract
  but no longer owns text-edit flow), prepend a one-paragraph
  Status note pointing at the current truth. Don't rewrite.

## Pitfall: `git rm` auto-stages deletions but `Edit` does not

PR B (`babe0313`) committed file deletions (from `git rm`) without
the matching content-absorption edits that the same deletions
required. The deletions were auto-staged by `git rm`; the `Edit`
calls I made to absorb the deleted content modified the working
tree only. Then `git commit -m '...'` only picked up the
already-staged deletions.

**Net effect:** half-broken commit — `slides-textbox-autogrow.md`
was deleted but `slides-text-autofit.md` still cross-referenced it;
`slides-keyboard-shortcuts.md` still had the duplicated shift table.

**Fix in the next commit (4db72fbc):** committed the missed edits
under PR C with an explicit "restore PR B absorption edits" section
in the commit message.

**Lesson for next time:** before any `git commit` that follows a
mix of `git rm` and `Edit`, run `git status` and explicitly
`git add` the modified-but-unstaged files. Or use `git commit -a`
when the staging mix is obviously a single logical unit. Better
yet, stage every modified file with `git add` as part of the
edit, not at commit time.

## Pitfall: stack PRs vs. one branch — pick early

The user chose "continue on the same branch" after PR A, so
PR A→D ended up as 8 commits on one branch. That's fine for review
when each commit's message stands alone — but it does mean a
single merge swallows everything, and a one-commit revert is not an
option.

If feature-stacked PRs are wanted instead, switch branches **before**
the next commit. Halfway through is too late: README hunks span
multiple PRs and you can no longer cleanly split.

## Pitfall: don't trust file moves without checking cross-refs

When archiving or moving docs, `grep -rn` the destination tree for
references *before* committing. Even relative-link refactors miss
xrefs hiding in adjacent areas:

- `slides.md` referenced `docs-remote-cursor.md` after the file was
  merged into `docs-presence.md` (caught and fixed in D2).
- `docs.md` referenced `docs-cli.md` after the CLI split (caught and
  fixed in PR C).
- `docs-pagination.md` referenced `docs-table-row-splitting.md`
  without the `tables/` prefix after the subfolder move (caught and
  fixed in D1).

A pre-commit `grep` saved each of these from shipping as a broken
link.

## Mechanics that worked

- **`pnpm verify:fast` after each commit's edits** — even for
  markdown-only changes — caught the one or two cases where a code
  snippet got truncated mid-line.
- **Read large files in chunks** with `offset`/`limit` instead of
  full reads. Saved meaningful context, especially on
  `docs-tables.md` (699 lines) and `docs-wordprocessor-roadmap.md`
  (392 lines).
- **One commit per PR scope** kept commit messages from becoming
  multi-page; each commit explains a single coherent change.
- **Explicit "Why" framing in commit body** (per CLAUDE.md) made
  each commit message review-ready without a separate write-up.
