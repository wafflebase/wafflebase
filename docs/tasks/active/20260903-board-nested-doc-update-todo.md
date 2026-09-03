# Board: nested `doc.update` on insert desyncs the document

Inserting any element on a board immediately strands the document: the
sync chip goes to `Not saved` and nothing that session ever reaches the
server again.

## Root cause

`YorkieBoardStore.batch()` opens one `doc.update()` for the whole batch.
The slides editor's insert commit
(`packages/slides/src/view/editor/editor.ts:5021`) selects the new
element *inside* that batch:

```ts
this.options.store.batch(() => {
  const id = this.options.store.addElement(slide.id, init);
  this.selection.set([id]);      // notifies listeners synchronously
});
```

`board-view.tsx:572` answers that notification with a **second**
`doc.update()`:

```ts
editor.onSelectionChange(() => {
  doc.update((_, p) => { p.set({ selectedElementIds: … }); });
});
```

The SDK builds a `ChangeContext` from `this.changeID` on entry and only
advances `this.changeID` on commit, so the inner presence change and the
outer element change are issued the **same `clientSeq`**. Reproduced
against `@yorkie-js/sdk` 0.7.17 — the pushed pack is `[1, 2, 2]`. The
server refuses the pack:

```
PushPullChanges => "invalid_argument: change clientSeq must increase by one"
DetachDocument  => "invalid_argument: change clientSeq must increase by one"
```

`YorkieSlidesStore` already solved this (`yorkie-slides-store.ts:334`):
`batch()` captures the presence proxy as `activePresence`, and
`updatePresence()` folds into it while a batch is open. `YorkieBoardStore`
has `activeRoot` but no presence equivalent, and `board-view` writes
presence straight to `doc`.

Not specific to `chord` or to an empty board — an empty board just makes
the insert the first thing anyone does. Any batch that also changes the
selection (paste, group/ungroup, delete) takes the same path.

## Tasks

- [x] `YorkieBoardStore`: add `activePresence`, take the presence proxy in
      `batch()`, expose `updatePresence(Partial<BoardPresence>)`
- [x] `board-view.tsx`: route the selection broadcast through
      `store.updatePresence()`
- [x] `board-view.tsx`: route the cursor publish through the same seam
      (rAF-deferred so it never nested, but the store is now the single
      presence writer)
- [x] Regression test: a `batch()` whose body writes presence emits one
      change with a strictly-increasing `clientSeq`
- [x] `pnpm verify:fast`
- [x] Self review (4 parallel lenses: bugs / CLAUDE.md / history / comments)
- [ ] Browser smoke: insert a shape on an empty board, confirm `Saved`
      — BLOCKED: Chrome could not reach the local dev server
      (`localhost:5173` and `127.0.0.1:5173` both render an error page
      although `curl` gets a 200). Left for a human.

## Review

Four review lenses ran over the branch diff. The bug lens found nothing.
Three of the four independently flagged the same defect, now fixed:

- **`board-view.tsx` header comment was stale.** It claimed
  `YorkieBoardStore` "does not expose … `updatePresence`" and that this
  view writes presence with `doc.update` — the exact thing the fix
  forbids. Rewritten to split presence READS (straight to `doc`) from
  WRITES (through the store), so a future reader cannot re-derive the
  bug from the comment.
- **A factual error in a test comment.** It blamed `getMyPresence()`
  returning nothing on the SDK "not reconciling presence for a detached
  document". Untrue — `Change.execute()` updates the map unconditionally;
  `getMyPresence()` has an attach-gated early return. Corrected.
- **The batch test asserted less than its comment claimed.** It checked
  `clientSeq` contiguity but not the change count, so "folds into the
  batch's own change" was unproven. Now asserts both.

Design docs updated for the durable invariant: the "Board side" section
of `board-editing-parity.md`, and the "reuse verbatim" list in
`board.md`, which named `batch`/`withUpdate` but not `activePresence` —
the omission that produced this bug in the first place.

The history lens confirmed the root cause independently: slides hit and
fixed the identical hazard in PR #398 (its commit message describes the
mechanism), and board's SP1 (PR #606) landed afterwards claiming a
"verbatim port" while copying only the `activeRoot` half.

`updatePresence` is deliberately NOT part of the `SlidesStore` interface —
`board-view` holds the concrete `YorkieBoardStore`, the same way
`slides-view` does. Nothing in the shared editor calls it.

The cursor publisher's `shouldPublish` / `getOthersPresences` reads stay
on `doc`: they are reads, and the class comment already documents peer
reads as going straight to the document.
