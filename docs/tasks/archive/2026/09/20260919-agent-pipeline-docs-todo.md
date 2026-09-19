# Gather the agent-pipeline design docs into one folder

Design: [`docs/design/README.md`](../../design/README.md) §Agent Pipeline (new)

Six design docs describe one subject — the loop that takes work from *somebody
noticed something* to *a pull request a human merges* — and they are scattered
across `## Common`, a table of thirty unrelated rows. There is no folder, and
the one doc that is supposed to be the entry point
(`agentic-dev-loop.md`, marked "**Start here** for the agent pipeline") sits
between `harness-engineering.md` and `agentic-office-workflow.md` with nothing
saying it governs them.

A second, independent problem shares the same fix window: `agentic-dev-loop.md`
does not follow the house document shape, and the deviation is structural
rather than cosmetic.

## What is actually wrong

### 1. No folder, and the name that should hold one is taken

`docs/design/agentic-dev-loop/` **already exists** and holds three Korean
walkthrough pages — `index.html`, `deck.html`, `tutorial.html` — attached to
the top-level `agentic-dev-loop.md`. It is an asset directory, not a doc
directory. Putting markdown there would flip the folder's identity and make
`agentic-dev-loop.md:290,299`'s serve recipe
(`http://localhost:8080/docs/design/agentic-dev-loop/`) read ambiguously.

### 2. `agentic-dev-loop.md`'s `## Proposal Details` spine breaks mid-document

```
 44:## Proposal Details
 46:### 1. The components
 93:### 2. Where work comes from
111:### 3. When each piece landed
136:---                            ← bare rule
138:## The agent pipeline          ← now a SIBLING of Proposal Details
246:## Design → code               ← sibling
288:## Walkthroughs you can open   ← sibling
304:## Risks and Mitigation
```

Every other design doc in the set keeps every body section at `###` under one
`## Proposal Details` until Risks — `document-copy.md` 52→173,
`sync-status.md` 71→444, `debug-report.md` 59→698,
`agentic-office-workflow.md` 52→327. Here it governs three of seven body
sections. The two `---` rules (136, 244) exist to paper over the break.

Consequence beyond tidiness: line 59 cites `**none** — see §4`, and **there is
no §4** — numbering stops at §3. The intended target is `### What has no design
doc` (229), which line 308 cites by quoted title precisely because it has no
number.

### 3. Boilerplate that was supposed to be deleted

Line 6 still carries
`<!-- Make sure to append document link in design README.md after creating the document. -->`
although the README row has existed since `5b0edd169`.

## Non-Goals

- **Normalizing `harness-engineering.md` or `eval-harness-usage.md`.** They
  deviate further than `agentic-dev-loop.md` does — the first is a 3,677-line
  roadmap log with no `Proposal Details` and no top-level `Risks`, the second a
  pure runbook with zero template sections — but both are deviating *by genre*,
  not by accident. `template.md` describes a design proposal; an operator's
  guide and a phase roadmap are different documents. Forcing them into the
  proposal skeleton would damage them. Recorded here so the gap is findable.
- **Merging `docs/design/design-editor/`.** It has its own README section, its
  own `harness.config.json:125` advisory pattern (`"^design-editor/"`), and the
  links are one-directional (pipeline → design-editor, never back).
- **Rewriting `CONTRIBUTING.md`'s `@claude` verb table**, which
  `agentic-dev-loop.md:311-315` already records as a known divergence.
- **Renaming five of the six docs.** Folder-name-prefix is the live convention
  (`docs/`, `slides/`, `board/`, `design-editor/`) but `sheets/` is precedent
  for not applying it, and renaming `debug-report.md` alone would churn 34
  source-comment references for no reader's benefit.

## Target shape

```
docs/design/agent-pipeline/
├── agent-pipeline.md          ← renamed from agentic-dev-loop.md (umbrella)
├── harness-engineering.md
├── hunter-usage.md
├── eval-harness-usage.md
├── debug-report.md
├── agentic-office-workflow.md
└── walkthrough/               ← the whole of docs/design/agentic-dev-loop/
    ├── index.html
    ├── deck.html
    └── tutorial.html
```

`docs/design/agentic-dev-loop/` ceases to exist, so the name collision is
removed rather than managed. The umbrella takes the bare folder name, matching
`board/board.md`, `notes/notes.md`, `docs/docs.md`, `slides/slides.md`.

A new `## Agent Pipeline` section goes in `docs/design/README.md` **between
`## Design Editor` (130) and `## Common` (144)** — tooling sections sit after
the engine and Files sections, and `## Obsolete docs` / `## Template` stay
last. Rows 169-174 are already a contiguous block, so they lift out whole.

## The gates this has to satisfy

| Gate | Rule that bites |
|---|---|
| `verify:doc-index` | `docs/design/README.md` must link **every** `.md` under `docs/design` recursively. A row whose target does not exist grants **zero** coverage (`scripts/verify-doc-index.mjs:167`), so a typo'd row fails silently-green in the other direction |
| `verify:doc-links` | BFS from `CLAUDE.md` / `AGENTS.md` / `README.md`; every reachable target must exist. `docs/tasks/archive/**` is FROZEN and never traversed |
| `verify:entropy` | Walks `docs/design` recursively, so coverage survives the move — but advisory suppressions are keyed on the **exact** designDir-relative path |

## Tasks

### Phase 0 — move (serial, one commit)

- [x] `git mv` the six docs into `docs/design/agent-pipeline/`
- [x] `git mv docs/design/agentic-dev-loop.md docs/design/agent-pipeline/agent-pipeline.md`
- [x] `git mv docs/design/agentic-dev-loop docs/design/agent-pipeline/walkthrough`
- [x] Update `title:` frontmatter of the renamed umbrella to `agent-pipeline`

### Phase 1 — must-fix references (parallel ×4, disjoint file sets)

**A1 — inbound markdown links (13 links / 9 files).** `README.md:231`,
`CONTRIBUTING.md:154,221`, `MAINTAINING.md:185`,
`docs/design/workspace-folders.md:55`, `scripts/README.md:7`,
`scripts/agent/eval/README.md:55`, `packages/debug-report/README.md:13,14`,
`docs/tasks/active/`{`20260729-autonomous-issue-hunting-todo.md:3`,
`20260729-autonomous-issue-hunting-lessons.md:3`,
`20260812-path-aware-ci-todo.md:3`,
`20260831-agentic-office-workflow-todo.md:3`}

- [x] A1 done, `docs/design/README.md` **not** touched (A4 owns it)

**A2 — outbound links inside the moved docs (11 links / 4 files).**
`../../CONTRIBUTING.md` → `../../../` (agent-pipeline.md:39,199,312);
`../../MAINTAINING.md#merge-queue` → `../../../` (harness-engineering.md:800);
`../../scripts/agent/eval/README.md` → `../../../`
(eval-harness-usage.md:14); `design-editor/…` → `../design-editor/…`
(agent-pipeline.md:41,54,284,285 and debug-report.md:29,570)

- [x] A2 done, headings **not** touched (Phase 2 owns them)

**A3 — config and ownership (3 files).**

- [x] `harness.config.json:219` — `"doc": "harness-engineering.md"` →
      `"agent-pipeline/harness-engineering.md"`. **Miss this and the next
      `verify:entropy` run turns red**: the advisory stops matching and
      `harness-engineering.md:221`'s deliberate "there is no
      `mixed-controls.tsx`" becomes a blocking finding
- [x] `.github/CODEOWNERS:35` — `/docs/design/harness-engineering.md` →
      `/docs/design/agent-pipeline/harness-engineering.md`. **Fails silently
      forever**: no CI error, the maintainer-review requirement just disappears
- [x] `scripts/agent/review-panel.mjs:1449-1450,1498` — the comment and prompt
      assert "the 22 top-level `docs/design/*.md` and none of the 81 nested
      ones". Already false (`listDesignDocs` recurses); the move makes it
      29/95. Pre-existing bug, fixed here because the move is what exposes it

**A4 — `docs/design/README.md` (sole owner).**

- [x] Delete rows 169-174 from `## Common`
- [x] Add `## Agent Pipeline` between line 130 and 144, umbrella first, with
      `**Start here.**` as the Description cell's first token

### Phase 2 — format normalization (serial, `agent-pipeline.md` only)

Deliberately after Phase 1: A2 edits this file by line number, and
re-parenting headings concurrently would conflict.

- [x] Delete the bare rules at 136 and 244
- [x] `## The agent pipeline` → `### 4. The agent pipeline`; its four `###`
      children → `####`
- [x] `### What has no design doc` → `#### 4.1 What has no design doc`
- [x] `## Design → code` → `### 5. Design → code`
- [x] `## Walkthroughs you can open` → `### 6. Walkthroughs you can open`
- [x] Line 59 `see §4` → `see §4.1`; line 308 `§"What has no design doc"` → `§4.1`
- [x] Delete the line-6 boilerplate comment
- [x] Repoint §6's prose and serve recipe at
      `docs/design/agent-pipeline/walkthrough/`
- [x] Prose unchanged otherwise — the five tables, the ASCII diagram, the
      `## Goals / Non-Goals` merge and the H2 `## Risks and Mitigation` are all
      house dialect and stay

### Phase 3 — stale prose sweep (parallel ×5, best-effort, non-blocking)

Nothing enforces these; they are path strings in comments and prompts.

- [x] `packages/**` — 34 refs / 31 files (mostly `docs/design/debug-report.md`)
- [x] `scripts/**` — 13 refs / 13 files, comments and test literals
- [x] `.github/workflows/**` — 9 refs / 5 files, comments and prompt text
- [x] `.claude/commands/{hunt,hunt-ui,report-intake}.md` — 3 refs
- [x] `docs/design/design-editor/*.md` (3) and
      `agent-pipeline/walkthrough/*.html` (3)
- [x] `docs/tasks/active/**` non-link mentions — 13 refs / 6 files
- [x] `docs/tasks/archive/**` — **69 refs, deliberately untouched** (FROZEN)

### Phase 4 — verify

- [x] `node scripts/verify-doc-index.mjs`
- [x] `node scripts/verify-doc-links.mjs`
- [x] `pnpm verify:entropy`
- [x] `pnpm verify:fast`
- [x] `/self-review` bounded rounds, logged in the lessons file

## Why parallel agents, and where the seams are

The work is ~32 must-fix edits over 16 files plus ~85 optional ones over ~68
more. It parallelizes cleanly because the edits are independent *given the
move*, and the only correctness requirement is **disjoint file ownership** —
which is why `docs/design/README.md` is A4's alone even though six of its rows
are inbound links A1 would otherwise take, and why Phase 2 does not run beside
A2.

No worktree isolation: disjoint sets on one branch, and the phases that could
collide are serialized instead.

## Review

Done in one branch, 80 files. `pnpm verify:fast` green; `verify:doc-links`,
`verify:doc-index` and `verify:entropy` each green on their own.

A repo-wide grep for the six old paths — excluding `docs/tasks/archive/**` and
this task's own two files — returns **zero** hits.

### What the survey got wrong

Three things the pre-move inventory missed, all found by the agent that owned
the area rather than by the plan:

- **`agentic-office-workflow.md:28`** linked `agentic-dev-loop.md`. Not a depth
  problem — the *rename* killed it, and a same-folder link looks safe in a list
  organized by "which links break when the file moves deeper".
- **`walkthrough/index.html:175,179`** printed
  `http://localhost:8080/docs/design/agentic-dev-loop/` as the URL to open. The
  plan had the HTML pages down as "relative cross-links only, survives the
  move", which was true of the cross-links and false of the instructions.
- **`scripts/agent/review-panel.test.mjs`** pinned the *wrong* claim about
  design-doc recursion with three assertions. Correcting the note in
  `review-panel.mjs` without them would have left `verify:fast` red. The agent
  inverted the assertions in the same pass rather than reporting a failure.

### Known limitations

- `docs/tasks/active/20260904-class-b-backend-endpoints-todo.md:37` cites
  `agentic-office-workflow.md:215`. The path was repointed; the **line number**
  was not re-verified against the moved file.
- `verify:entropy` reports 84 advisory broken refs repo-wide. Pre-existing and
  unrelated to this move.
- A working tree installed before `ffefac01e` (the Sentry commit) fails
  `verify:entropy` inside knip with `Cannot find module '@sentry/vite-plugin'`.
  `pnpm install --frozen-lockfile` fixes it; no manifest is modified.
