# Lessons — slides notes live sync + collaboration audit

## What the bug taught

- **A panel that mutates a CRDT store must also subscribe to that
  store's remote-change signal.** The notes panel wrote via
  `store.withNotes` but only re-read on local editor events
  (`onSelectionChange` / `onCurrentSlideChange`). Write-path and
  read-path were asymmetric — the classic "my edits sync out, peers'
  edits don't sync in" shape. When wiring any collaborative surface,
  check both directions against `store.onChange`.

- **Re-syncing a focused input clobbers the local caret.** Naively
  calling `sync()` on every `onChange` would reset `ta.value` and the
  cursor mid-keystroke when a peer commits. Guard with
  `document.activeElement === ta`. This is safe here only because notes
  are whole-array LWW (a focused user owns the field); a Tree-backed
  field would need a finer merge instead of a skip.

- **Discarded handles leak.** `mountNotesPanel` returned a
  `NotesPanelHandle`, but the call site dropped it, so `dispose()` never
  ran. Always capture mount handles and dispose them in the same
  teardown that disposes sibling handles (`thumbHandle`).

## Process lessons

- **The session-start git status said "(clean)" but the tree was NOT.**
  A prior session had left an unrelated, broken, half-finished
  "connector paste remap" change in the working tree (a `keyboard.ts`
  referencing a not-yet-extracted `pasteElements`). It broke
  `pnpm verify:fast` typecheck. Don't trust the snapshot — run
  `git status` before assuming a clean base.

- **Isolate your verification from unrelated dirty state with a
  path-scoped stash, and restore it carefully.** `git stash pop` of a
  pathspec+untracked stash partially applied (untracked files +
  `keyboard.ts`) then aborted, leaving a mixed tree. Recovery: compare
  the working tree against `stash@{0}` per file (`git diff stash@{0} --
  <path>`), `git checkout stash@{0} -- <missing files>` to backfill,
  verify untracked files byte-match the stash's `^3` tree
  (`diff <(git show 'stash@{0}^3:path') path`), unstage, then drop.
  Verify `git diff stash@{0} -- <all stashed paths>` is empty before
  dropping the stash. Never drop a stash until the tree provably
  matches it.

## Audit lesson

- **Design docs drift from implementation.** `slides.md` described
  Yorkie-Tree text/notes and a full peer-cursor presence system as if
  shipped; the code uses `Block[]` LWW and broadcasts only
  slide/selection presence with no peer rendering. When a feature is
  deferred, the design doc must say so — captured the reconciliation in
  `docs/design/slides/slides-collaboration.md` and added inline status
  notes to `slides.md`.
