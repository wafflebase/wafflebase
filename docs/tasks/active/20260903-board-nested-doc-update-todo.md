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
- [ ] Browser smoke: insert a shape on an empty board, confirm `Saved`

## Review

`updatePresence` is deliberately NOT part of the `SlidesStore` interface —
`board-view` holds the concrete `YorkieBoardStore`, the same way
`slides-view` does. Nothing in the shared editor calls it.

The cursor publisher's `shouldPublish` / `getOthersPresences` reads stay
on `doc`: they are reads, and the class comment already documents peer
reads as going straight to the document.
