# Lessons — board nested `doc.update`

## A nested `doc.update()` is a correctness bug, not a style issue

The Yorkie SDK builds a `ChangeContext` from `doc.changeID` when
`update()` is entered and only advances `changeID` when that update
commits. An inner `update()` that opens and closes while an outer one is
still running therefore takes the **same `clientSeq`** the outer one is
about to use. Reproduced against `@yorkie-js/sdk` 0.7.17 with nothing but
the SDK:

```js
doc.update((r) => {
  r.elements.push({ id: 'a', type: 'shape' });
  doc.update((_, p) => p.set({ selectedElementIds: ['a'] }));
});
doc.createChangePack().getChanges().map((c) => c.getID().getClientSeq());
// → [1, 2, 2]
```

The server refuses the pack ("change clientSeq must increase by one") and
`changeID` is left a step behind, so **every later push and the final
detach fail identically**. One nested update ends the session's syncing.

**How to apply:** any callback that can fire synchronously from inside a
`store.batch()` must write through the store, never through the raw
`doc`. When porting a store, port its presence seam too — `activeRoot`
without `activePresence` is half a port.

## The symptom named the wrong layer

The user-visible failure was the sync chip's "The server rejected your
recent changes" toast on a board shape insert. Nothing about it points at
presence, at selection, or at the editor. Two greps closed it:
`grep` the toast string to find `sync-status-chip.tsx` (so: a real
server-side rejection, not a client throw), then `docker logs` on the
Yorkie container for the actual RPC error.

**How to apply:** when a collaborative edit "just fails", read the Yorkie
container's log before reading any application code. It names the RPC and
the reason in one line. `docker logs -t --since 48h <yorkie> | grep -i
error` was the whole diagnosis.

## The sibling implementation was already correct, with the reason written down

`YorkieSlidesStore.activePresence`'s comment says exactly this: "a
selection change fired synchronously while a batch's `doc.update` is
still open would otherwise nest updates." The board store was ported from
it and dropped that field.

**How to apply:** when a parallel implementation exists (the board store
says "verbatim port of `YorkieSlidesStore`" in its own class comment),
diff the two for *missing* members before theorizing. A field the
original has and the port doesn't is a bug report someone already wrote.

## Stale `dist/` masks unrelated test failures

`pnpm verify:fast` first reported 25 failing frontend files (missing
`hyparquet`) and 4 failing CLI files. `pnpm install` fixed the first;
rebuilding `@wafflebase/docs` + `@wafflebase/slides` fixed the second —
the CLI resolves those packages against `dist/`. Confirmed pre-existing
by re-running on a stashed tree before touching anything.

**How to apply:** a failure in a package you did not edit → `git stash`
and re-run before investigating. Then `pnpm install` and rebuild the
engine packages. See [[reference_slides_export_build_step]].
