# Multi-File Upload — Lessons

## What went well

- **Reusing the `zoom-controller.ts` module-singleton pattern** (hand-rolled
  `Set<listener>` + `subscribe`, array-reference-replace on mutate) gave a
  library-free cross-component store that plugs straight into a
  `useState + useEffect + subscribe` hook — matching the codebase's only
  established convention (no `useSyncExternalStore` anywhere).
- **Splitting `pickAndImportXxx` into File-taking cores + picker wrappers**
  kept the single-file menu working while the queue drove the same parsers.
  (The wrappers later became dead once the menu itself routed through the
  queue — worth removing eagerly rather than keeping "for future consumers".)
- **Dependency-injected worker** (`startUploads(onItemDone, deps)`) made the
  concurrency cap, error isolation, and retry dup-guard unit-testable with
  zero network — the highest-value test surface in the feature.

## Traps hit (fix if repeated)

- **Plan sample vs. plan prose mismatch.** The plan's Risks section promised a
  retry duplicate-document guard, but the plan's *code sample* set `docId`
  only inside `finish()` (after both create AND stash succeed), so the guard's
  precondition was unreachable. The implementer correctly caught it and added
  `getOrCreateDoc` persisting `docId` immediately after `createDoc`. Lesson:
  when writing plans, make the sample code actually implement the guarantees
  the prose claims — reviewers/implementers otherwise transcribe the broken
  sample.
- **Wrong import path in the plan** (`getDocumentPath` is in
  `./document-list-utils`, not `@/api/documents`). Verify symbol locations
  while writing the plan, not just signatures.
- **jsdom gaps surface as "the plan's own test fails".** `Blob.arrayBuffer`
  and `@testing-library/jest-dom`'s `toBeInTheDocument` are absent in this
  repo's jsdom setup; tests needed a `Blob.prototype.arrayBuffer` polyfill
  (added to `tests/setup.ts` beside the existing ResizeObserver shim) and
  `.toBeTruthy()` on `getByText` instead of jest-dom matchers.
- **Full-page drop needs a window-level guard.** A drop zone that only
  `preventDefault`s inside its own element lets a stray drop on surrounding
  page chrome navigate the tab to the raw file (data loss). Always pair the
  zone with a `window` `dragover`/`drop` `preventDefault` gated on
  `dataTransfer.types.includes("Files")`. The final (opus) review caught this;
  per-task reviews couldn't see it because the enclosing chrome is out of the
  task's file scope — a case for the whole-branch review step.
- **"Full-page drop zone" means the window, not the component wrapper.** The
  design said full-page, but the first implementation scoped the drop
  handlers + highlight overlay to the list's `relative w-full` wrapper, so a
  drop on the surrounding chrome did nothing (the window guard only swallowed
  the default). User feedback ("drag area should be bigger") → moved ALL of
  dragenter/over/leave/drop to window-level listeners with an enter/leave
  depth counter (children fire spurious leave events; a counter prevents
  overlay flicker) and made the overlay a `fixed inset-0` viewport layer.
  When a spec says "full-page/drop-anywhere," bind to `window` from the start;
  a component-scoped drop zone is a narrower thing that will read as a bug.
  Guard against double-enqueue: with window-level drop handling, remove the
  inner element's own `onDrop` so a single drop enqueues once.

## The big one: a deferred queue broke the pendingImports contract

The client-side importers (xlsx/docx/pptx) parse into a CRDT document that is
**not** persisted at create time — the old single-file flow stashed it in an
in-memory `pendingImports` Map and relied on the immediate `navigate` →
editor-mount to push it into Yorkie. The deferred upload queue dropped the
navigate (you can't navigate to N documents), so a batch could reach "done"
with the backend document created but **empty**, and the parsed content lived
only in memory — lost on reload or if the user never opened the doc. Every
earlier review (per-task + the branch-level subagent review) missed this
because it's an emergent property of the whole flow, not visible in any single
diff; the high-effort multi-agent code review caught it.

**Lesson:** when you decouple document *creation* from content *application*,
the content must be persisted by the operation itself, not by a later,
optional editor mount. Fix was a headless `applyImportedContent` that attaches
to the Yorkie doc (`@yorkie-js/sdk` `Client`/`Document` are fully React-free),
writes the same root the editor would, and detaches — so "done" means saved.
Watch for the residual create-then-populate exposure: if the apply fails after
create, the doc exists empty (retryable, surfaced) — inherent to any
create-then-write model.

**Meta-lesson:** cheap per-task reviews and even a whole-branch review can all
miss a flow-level architectural gap. For a feature that changes *when/where*
persistence happens, run the deep multi-agent review before calling it done —
it paid for itself here.

## Process notes

- The `.superpowers/sdd/` scratch (briefs/reports/ledger) accumulated stale
  files from *earlier* SDD runs with the same task numbers (spell-check,
  BackendSpellProvider). Implementers overwrote them correctly, but the reused
  numbering is a foot-gun — namespace the ledger/brief files per feature if
  running multiple SDD features in one repo.
- Cheap-tier (haiku) was fine for the pure classifier; the worker loop and the
  list integration genuinely needed a standard model (concurrency reasoning,
  large-file editing, both menu copies).
