# Agentic Office Workflow — Task Tracking

Design doc: [agentic-office-workflow.md](../../design/agent-pipeline/agentic-office-workflow.md)
Tracking issue: [#998](https://github.com/wafflebase/wafflebase/issues/998)
Original proposal: @ggyuchive, v1, 2026-08-29

## Principles

- **No number before isolation.** The bench root leaks `CLAUDE.md` and 45 stored
  answers to the subject. Any score taken before that is closed is worthless.
- **Record the CLI version with every run.** Gap A holds the ceiling down; a
  score is only comparable against the same command surface.
- **The bench stays neutral.** It must grade `office-agent` and an unconfigured
  Claude Code on identical terms, or it measures nothing.
- **Grading never calls an LLM.** State inspection only, so the same run always
  yields the same score.
- **Class C is not a wafflebase score.** PDF/image content extraction measures
  the host; report it apart.

## Step 0: Write it down (this PR)

- [x] Capability audit re-measured against `main` at CLI v0.6.7 — routes in
      `packages/backend/src/api/v1/*` vs commands in `packages/cli/src/commands/*`
- [x] A / A′ / B / C classification with file:line evidence
- [x] Corrections to the original audit recorded: tab rearrange A → B, comments
      and sheet floating images A → B, slide editing A → A′ (whole-content
      write only), folders reachable by JWT but not by API key, board B confirmed
- [x] `docs/design/agent-pipeline/agentic-office-workflow.md` + index row in `docs/design/README.md`
- [x] Issue #998 body updated with the measured list

## Step 1: Close the bench's own holes (blocks every number)

- [ ] Move fixtures and `tasks/*/manifest.yaml` out of the agent's working root
- [ ] Confirm `CLAUDE.md` is no longer auto-loaded into the subject's context
- [ ] Emit run records, so "were the answers opened?" stops being unanswerable
- [ ] Answer open question 1 — locate the existing bench prototype, if any

## Step 2: Baseline run

- [ ] Vanilla Claude Code + wafflebase CLI only, all 27 tasks
- [ ] Record success rate, turns, tokens, per-command call counts
- [ ] Report both score branches (CLI-reachable items / whole set)
- [ ] Pin the CLI version in the result

## Step 3: Close gap A (~37 items, CLI layer only)

Ordered by what the bench actually blocks on; re-derive against the current tag
before treating this as a roadmap.

- [x] Content **write** — `docs|slides|notes set-content` (`content-write.ts`,
      one `PUT .../content` for all three; the backend picks the writer from the
      persisted type)
- [x] Rows / columns — `sheets clear` · `insert` · `delete` · `move`
      (`sheets-structure.ts`; the four verbs mirror the backend's own
      `POST clear|insert|delete|move` one-to-one)
- [x] Style / formatting — `sheets styles` · `sheet-style` · `column-styles` ·
      `row-styles` (`sheets-styles.ts`)
- [x] Rules — `sheets conditional-formats` · `data-validations` (`sheets-rules.ts`)
- [x] Analysis — `sheets filter` · `pivot` (`sheets-analysis.ts`)
- [x] Structure display — `sheets freeze` · `hidden` · `merges` (`sheets-view.ts`)
- [x] Dimensions — `sheets column-widths` · `row-heights` (`sheets-dimensions.ts`)
- [x] Charts — `sheets charts` (`sheets-charts.ts`)
- [x] Workspace images — `images upload` / `get` / `delete` (`images.ts`, a new
      top-level namespace: the bucket is workspace-scoped, not document-scoped)
- [x] All of the above registered and discoverable — mounted in
      `sheets.ts` / `docs.ts` / `slides.ts` / `notes.ts` / `cli.ts`, and every
      one carries a `schema/registry.ts` entry with aliases and safety
- [ ] Re-run the baseline on the new CLI version and compare

## Step 4: Decide the A′ question (7 items)

Closed — see [20260903-api-v1-folders-copy-todo.md](../archive/2026/09/20260903-api-v1-folders-copy-todo.md),
archived during the v0.6.9 cut.

- [x] Answer open question 3 — **an API key**. A session expires and belongs to
      a person, so a bench that needs one cannot run unattended
- [x] An `/api/v1` folder surface, **not** `CombinedAuthGuard` on the web
      routes: `WorkspaceScopeGuard` scopes a key by reading `:workspaceId` from
      the path, and `folders/:id` carries none
- [x] CLI commands — `folders list|create|rename|move|delete`, `docs copy`,
      `docs move` — each with a `schema/registry.ts` entry

## Step 5: `office-agent`, then the sweeps

- [ ] `wafflebase-office-agent` — system prompt + command scope
- [ ] Prompt condition (tool surface fixed, prompt varied)
- [ ] Command-scope condition (all / curated / minimal)
- [ ] Model condition (opus / sonnet / haiku) — the actual hypothesis test
- [ ] Check the falsifier: a win on every model means the baseline is too weak
      or the agent is tuned to the 27 tasks

## Step 6: Class B, if the bench justifies it

~~Each needs backend endpoints first; file separately with bench evidence.~~
**All five shipped in #1022** (`20260904-class-b-backend-endpoints`), ahead of
the bench rather than after it, so the preamble and every parenthetical below
was stale. Ticked at the v0.6.10 audit against the controllers, not the PR.

- [x] Comments (6) — ~~no REST surface; comments live in the Yorkie CRDT~~
      `packages/backend/src/api/v1/comments.controller.ts:113`, seven routes:
      `@Get()` :218, `@Post()` :261, `@Post(':threadId/replies')` :348,
      `@Patch(':threadId')` :379, `@Patch(':threadId/comments/:commentId')` :409,
      `@Delete(':threadId')` :442, `@Delete(':threadId/comments/:commentId')` :472.
      CLI `packages/cli/src/commands/comments.ts`.
- [x] Slide granular editing (5) — add / duplicate / delete / move / layouts.
      `packages/backend/src/api/v1/slides.controller.ts`: `@Get('layouts')` :79,
      `@Post('slides')` :96, `@Post('slides/:slideId/duplicate')` :113,
      `@Post('slides/:slideId/move')` :125, `@Delete('slides/:slideId')` :142 —
      exactly the five named. CLI `commands/slides-edit.ts`.
- [x] Tab rearrange (3) — ~~no DELETE on `tabs.controller.ts`~~
      `packages/backend/src/api/v1/tabs.controller.ts:161` `@Delete(':tabId')`,
      `:211` `@Post(':tabId/reorder')`, `:242` `@Post(':tabId/duplicate')`.
- [x] Sheet floating images (2) —
      `packages/backend/src/api/v1/worksheet-images.controller.ts:53`
      `@Get('images')`, `:80` `@Put('images')`. CLI `commands/sheets-images.ts`.
- [x] Board programmatic access (2) — ~~`docs-content.controller.ts:94` rejects it~~
      `packages/backend/src/api/v1/docs-content.controller.ts:80` now types
      `ContentType = 'doc' | 'slides' | 'note' | 'board'`, with board branches at
      :122, :149, :193, :232 and the validator at :639. CLI `commands/board.ts`.

## Review

_To be filled in when the work lands._
