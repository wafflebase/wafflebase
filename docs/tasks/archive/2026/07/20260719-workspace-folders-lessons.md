# Workspace Folders — Lessons

Paired with `20260719-workspace-folders-todo.md`. Captured after
subagent-driven implementation + final whole-branch review.

## What was non-obvious

- **Push the delete rule into the database.** The "a folder delete must never
  delete a document" contract is enforced entirely by Prisma `onDelete`: the
  `Folder.parent` self-relation is `Cascade` (subtree collapses) while
  `Document.folder` is `SetNull` (documents return to root). No service code
  computes this — the schema is the guarantee, and one e2e test proves it. When
  a rule can be an FK constraint, make it one; it can't be bypassed by a future
  code path.

- **Reuse the gate, don't re-derive it.** Folder move/delete gating reuses the
  existing `isDocumentManager(role, authorID, userId)` by giving `Folder` an
  `authorID` column — no `isFolderManager`. Fewer predicates, no divergence.

- **`class-validator` `@IsOptional()` passes `null` through.** For the
  "`undefined` = leave unchanged, `null` = move to root" semantics on
  `parentId`/`folderId`, `@IsOptional() @IsUUID()` is exactly right: it skips
  validation for both `null` and `undefined`, so an explicit `null` survives the
  whitelisting `ValidationPipe` and reaches the controller, which distinguishes
  the two with `body.x !== undefined` + `x === null`.

- **`noUnusedLocals` bites e2e scaffolding.** Backend `tsconfig` has
  `noUnusedLocals: true`, applied to `test/*.e2e-spec.ts` too. Pre-adding an
  `authCookie`/`JwtService` scaffold "for the next task" fails to compile
  (TS6133). Add auth scaffolding only in the task that first uses it.

- **Validate EVERY folderId write, not just the move path.** The final review's
  one Critical: the document *move* branch validated `folder.workspaceId ===
  targetWorkspace`, but both *create* handlers connected `folderId` with no
  check — a member of workspace A could POST a doc with a workspace-B folderId,
  orphaning it across a tenant boundary (and a nonexistent id 500'd instead of
  400'ing). The design doc's Risks section had literally called this out
  ("validate on every document `folderId` write"); the create path was missed
  because the task brief's create snippet didn't include the guard. Lesson: when
  a design names an invariant on "every write," enumerate the write sites
  (create AND update) in the plan, not just the one you're thinking about.

- **`invalidateQueries` is prefix-matching by default.** The docs list query key
  is `["workspaces", wid, "documents", folderId ?? "root"]`; mutations invalidate
  the prefix `["workspaces", wid, "documents"]` and TanStack refreshes every
  folder segment. No need to invalidate each folder's key exactly.

- **Radix `<Select>` can't hold `null`.** The move-dialog folder picker uses a
  `"__root__"` sentinel string mapped back to `null` on change — Radix Select
  values must be non-empty strings.

## Process notes

- Subagent-driven-development with a fresh implementer + reviewer per task kept
  the 967-line `document-list.tsx` edits reliable: each task re-read the file
  (line numbers shifted between Task 6 and Task 7) rather than trusting stale
  anchors.
- The final whole-branch review (most-capable model) earned its keep — it caught
  the cross-tenant create hole that all seven per-task reviews missed, because
  per-task reviews only saw their own diff and the create path's gap was an
  *absence* spanning Task 4's brief.
- `verify:browser` fails locally on Docker-calibrated visual baselines run
  against a non-Docker Chromium (systemic across chart/slides/shapes, zero
  folder screenshots). Known environment gap; CI runs it in Docker. Not a
  folder regression.
- Slides `tsc --noEmit` fails against a stale `@wafflebase/docs` dist unless docs
  is built first (the documented "Slides typecheck gate gap"); `verify:self`
  builds in order so it's green there.
