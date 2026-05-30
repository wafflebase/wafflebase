# Docs — Tab/Shift+Tab on Multi-Bullet Selection — Lessons

## 1. Dual command paths drift

`Tab/Shift+Tab` and `Cmd+]/Cmd+[` both mean "indent / outdent", but
they live in two different methods (`handleTab` vs `handleIndent` /
`handleOutdent`). Only the latter pair iterated
`forEachBlockInSelection`; `handleTab` mutated `cursor.position.blockId`
only.

There's a second, parallel pair of `indent()` / `outdent()` methods on
`editor.ts` (lines 2064 / 2084) that the toolbar buttons call — those
are also separate from `handleIndent` / `handleOutdent` on
`text-editor.ts`. The constants (`MAX_LIST_LEVEL = 8`,
`INDENT_STEP = 36`) are repeated in all four call sites.

**Rule:** When you have two surfaces that mean the same action
(key shortcut + named command, or text-editor + editor-API), have one
delegate to the other or extract a shared helper. Cross-reference at
minimum. Otherwise behavior silently diverges as one side gets a fix
and the other doesn't.

**How to apply:** When you spot a "second implementation" of a piece
of behavior, look at the first one's commit history — if it's been
patched (bugfix / new feature), the second one almost certainly has
the old bug too.

## 2. Stale dist masquerading as a regression

After applying the fix, `pnpm verify:fast` failed slides typecheck:

```
src/view/editor/text-box-editor.ts(324,18): Property 'getRangeStyleSummary' does not exist on type 'TextBoxEditorAPI'.
```

This had nothing to do with my change — `packages/docs/dist/` was
stale from before commit `7a8d91fb` ("Add font/size/line-spacing/clear
formatting to Docs toolbar"), which added those methods to
`TextBoxEditorAPI` in source but never rebuilt the dist. Slides resolves
`@wafflebase/docs` to the dist `.d.ts`, so its typechecker sees the old
type surface.

Fix: `pnpm --filter @wafflebase/docs build`, then re-run verify.

**Rule:** When verify:fast fails on a workspace-package "missing
export / property does not exist" error in a package you didn't
touch, rebuild the workspace dependency first before assuming
regression.

This matches the existing memory
`project_workspace_dist_resolution.md` — re-confirmed today, same
shape of failure.

## 3. Wrong tool for the temporary revert

I used `git stash && ... && git stash pop` to verify the slides
typecheck failure was pre-existing on main. Existing memory
`feedback_avoid_stash_for_temporary_revert.md` says: use
`git checkout HEAD -- <path>` (and `git restore` back) instead, since
stash drags along other changes and risks state confusion.

**Rule:** For "check a file/dir as it sits on HEAD without my
changes," use `git checkout HEAD -- <path>` then `git restore <path>`
(or just keep working from the WIP since the file's still in the
worktree). Don't stash.

**How to apply:** Whenever the intent is "temporarily set this one
file back to HEAD," reach for `checkout HEAD --`, not `stash`.
