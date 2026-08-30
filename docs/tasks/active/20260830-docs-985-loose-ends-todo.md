# Docs: close the four loose ends from #985

Issues: #988, #989, #990, #991. All four descend from the review of PR #985
("Surface Docs page setup, text exports, and format painter"). None is a
regression of that PR — every one is pre-existing and was filed rather than
folded in, to keep #985's blast radius small.

They ship as one branch because three of the four live in `packages/docs`,
issues #988 and #990 are two defects in the *same function*, and #991 item 3
is a line of the same proxy #989 replaces.

## #990 — PDF link href is injected unescaped into a PDF literal string

`PDFString.of` writes its argument verbatim. An unbalanced `)` in an href
closes the literal early, `>>` closes the `/A` action dictionary, and the
remainder becomes keys on the annotation dictionary itself. Verified against
the installed pdf-lib 1.17.1: the emitted object is
`/URI (https://x/)>>/JS(app.alert(1)))`, and `PDFDocument.load` then fails to
parse the file at all — so the bug corrupts PDFs as well as injecting into
them. `(` alone is harmless (balanced parens are legal); the dangerous
characters are an unbalanced `)` and `\`.

- [x] Escape `\`, `(`, `)` per PDF 32000-1 §7.3.4.2 before constructing the
      literal, rather than switching to a hex string — `/URI` is an ASCII
      string per §7.11.5, not a text string, so `PDFHexString.fromText`'s
      UTF-16BE-with-BOM output is out of spec for this key. Escaping is also
      byte-identical to today for every href without those three characters.
- [x] Regression test: an href containing `)` and `\` round-trips through
      `PDFDocument.load` with the exact original string.

## #988 — PDF export writes a validated-then-unvalidated href

`isSafeUrl` is `new URL(href)`, and the WHATWG parser deletes tab/CR/LF and
trims C0-or-space *before* it reads the scheme. So the string that clears the
protocol allowlist and the string written into the annotation are not the same
string.

- [x] Close the differential with the rule the Markdown serializer already
      uses (`isLiteralDestination`, `serialize/markdown.ts`): refuse any
      destination the consumer would transform, rather than modelling each
      rewrite. Only the whitespace/control clause applies here — a PDF viewer
      decodes no entity references and strips no `<…>` wrapper, so the
      CommonMark-specific clauses buy nothing.
- [x] Hoist that clause into `@wafflebase/core/url` next to `isSafeUrl` and
      have both `markdown.ts` and `pdf-painter.ts` import it, rather than
      copying the regex into a second file — the duplication that module
      exists to prevent. No new subpath, so no backend tsconfig path entry.
- [x] Regression test over the `BREAKOUT_PAYLOADS` table already in
      `test/serialize/markdown.test.ts`: no annotation is emitted for any of
      them.

## #989 — Read-only is bypassable through `getStore()` and `getDoc()`

`MUTATING_METHODS` neuters 33 `EditorAPI` methods under `readOnly`, but
`getStore()` and `getDoc()` are not in it and hand out objects that write
straight through — 36 `DocStore` mutators, and ~30 more on `Doc`, whose
`private store` is private in the TypeScript sense only.

Load-bearing facts from the investigation:

- `DocStore` is **8 readers / 36 mutators**. The read side has been stable
  while the write side churned (`batch` in #983, `applyStyles`,
  `insertBlocksAfter`). So an allowlist of *readers* fails closed for new
  mutators; a denylist of mutators drifts exactly like `MUTATING_METHODS`.
- `Doc` owns no persistence — every mutator delegates to the store it holds.
  Giving the editor's own `Doc` a neutered store closes `getDoc()` and
  `doc['store']` in the same stroke, with no second list to maintain.
- Only four call sites are read-only-reachable, and every one is a pure read:
  `docs-view.tsx:393` (`getDoc().refresh()` — a viewer needs it to see peer
  edits), `docs-find-bar.tsx:66`, `docs-comments-controller.ts:146` and `:358`.

- [x] Add a read-only `DocStore` view that allowlists the 8 readers and
      no-ops everything else, with `getPrototypeOf` nulled and
      `defineProperty`/`set` refused — a `get`/`set`-only Proxy is reachable
      via `Object.getPrototypeOf(store).insertText.call(store, …)`.
- [x] Route both `getStore()` and the editor's own `Doc` through it under
      `readOnly`. One `Doc` instance, not two: handing out a second `Doc` over
      a read-only store would leave `docs-view.tsx:393`'s `refresh()`
      updating a throwaway while the editor's cache went stale, and remote
      edits would stop repainting for viewers.
- [x] `batch(fn)` runs `fn` rather than swallowing it, so a read-only caller
      that batches reads still gets its reads.
- [x] Correct `docs/design/sharing.md`, which asserts in one place that the
      Yorkie auth webhook enforces the viewer role server-side and in another
      that the client flag is the effective boundary. Only the second is true
      by default: `YORKIE_AUTH_WEBHOOK_ENFORCE` is unset ⇒ shadow mode.

## #991 — three loose ends

- [x] **1.** Export `MIN_CONTENT_PX` from the Node entry (`src/node.ts`). It
      is a `const = 1` in a module that entry already re-exports 20+ symbols
      from, so the DOM/Canvas admission rule at `node.ts:26-30` does not
      exclude it — this is sync drift against that file's own "kept in sync
      with the browser entry" instruction.
- [x] **2.** Clear `copiedFormatListeners` in `TextEditor.dispose()`. Note the
      earlier round was right that there is no observable leak today — the
      toolbar unsubscribes on `[editor]` change. But the reason is the
      subscriber's discipline, not the editor's, and
      `compositionStartListeners`/`compositionEndListeners` are the same shape
      with *no unsubscriber at all*. Clear all three and state the invariant.
- [x] **3.** Delete the `set` trap on the `getStore()` proxy. The issue's
      stated symptom is wrong: `vi.spyOn` installs via `Object.defineProperty`,
      which the proxy does not trap, so it does not throw — it silently spies
      the *underlying* store while `get` keeps returning the guard, which is
      worse than a throw. The `set` trap itself guards nothing, because `get`
      returns `guardedSetPageSetup` unconditionally regardless of what sits on
      the target.

## Verification

- [x] `pnpm verify:fast` (exit 0, 11 lanes)
- [x] `tsc --noEmit` over `packages/docs` — caught one test-only error that
      every vitest run passed
- [x] Each new test demonstrated failing with its fix reverted, not just
      passing with it applied
- [x] Three adversarial review passes over the full branch diff

## Review

Three review rounds. The first two each broke a shipped fix; the third found
no exploitable defect.

**Round 1** — two real defects, both in the security fixes:

1. The #990 escape ran on code points, but pdf-lib writes a literal one byte
   per UTF-16 code unit, so `Щ` (low byte `0x29`) emitted a raw `)` and
   re-opened the injection; `Ш` corrupted the file. The original regression
   test passed only because it used an ASCII `)`.
2. `readOnlyDocStore`'s `get` forwarded non-function properties, handing out
   `MemDocStore.doc` / `YorkieDocStore.doc` — the live document and the CRDT
   handle — with no method call at all.

**Round 2** — one full escape and two more doors, plus a gap in #988:

3. `setPrototypeOf` was untrapped, so it forwarded to the target; a planted
   accessor then ran with `this` bound to the real store. It left every
   published assertion passing, since the handle still reported a null
   prototype.
4. `preventExtensions` was untrapped, so `Object.freeze(handle)` made the real
   store non-extensible and every later enumeration threw.
5. `has` disagreed with `get` about hidden fields.
6. #988 was only half closed: the WHATWG parser also folds `\` to `/` in a
   special-scheme authority, so `https://good.com\@evil.com/` cleared a gate
   that saw `good.com`. Fixed by emitting `new URL(href).href` — the string
   the gate parsed — rather than enumerating rewrites.

**Round 3** — no exploitable defect. Four accuracy items, all fixed: a
comment describing the percent-encode pass as live when normalization had
made it unreachable; `get` not honouring the non-configurable invariant the
other three traps were hardened for; a misleading note on the `has` trap; and
`editor.ts` still calling read-only "a client-side convenience" three lines
above the new text explaining why it is not. Also bound `style.href` to a
local so the gate and the emit provably read one string.

Two findings across the rounds were rejected on inspection: #991's claim that
`vi.spyOn` throws on the page-setup proxy (it uses `defineProperty`, which was
untrapped — it silently spies the underlying store, which is worse), and a
claim that presence would break for viewers (every presence call binds the raw
`docStore`, never `readStore`).

## Known limitations

- `getDoc().document` is a live render cache; mutating it corrupts the
  editor's own view until the next `refresh()`. It reaches neither the store
  nor the CRDT, and it predates this work — out of scope, recorded here so it
  is not mistaken for a gap in the read-only boundary.
- The shadow-mode default of `YORKIE_AUTH_WEBHOOK_ENFORCE` is unchanged. This
  branch makes the client boundary hold and says plainly in the docs that it
  is the boundary; deciding to enforce server-side is a deployment call and
  its own task (#989's third suggested item).
- **The two sibling viewer-writes are now fixed too** (they were initially
  recorded here as deferred; investigating them showed both were safe to
  close):
  1. `ensureTree` (`packages/frontend/src/app/docs/docs-view.tsx`) ran
     `doc.update()` for viewers too, and its branch for a `content` it does
     not recognize *overwrites* what is there. Now gated on `!readOnly`,
     which is the exact shape `notes-view.tsx` already uses for `ensureText`,
     for the same stated reason. Safe because `YorkieDocStore` answers
     `{ blocks: [] }` for a missing tree and every mutator early-returns.
  2. `initialDocsRoot()` seeds `content` and `comments: {}`, and the SDK
     writes any absent root key on every attach. Now routed through
     `docsInitialRootForRole()`, which returns `{}` for a viewer.

  The question this was deferred on — "does skipping the seed break viewer
  comment reading?" — resolves cleanly: every `root.comments` read is
  existence-guarded (`listThreads` returns `[]`, the rest use `?.`), an
  editor's first comment creates the container lazily, and commenting is
  `readOnly`-gated so a viewer never needs it. The LWW rationale for seeding
  applies to two *editors* racing on a first comment, and editors still seed.

  The two must land together: fixing only the second still leaves `ensureTree`
  creating the tree from the viewer's client.

## Follow-up (not in this branch)

`initialDocsRoot()` imports `Tree` from `@yorkie-js/sdk`, but the document is
attached through `@yorkie-js/react`'s `DocumentProvider`, which recognizes CRDT
values by `instanceof` against **its own** bundled `Tree`. Confirmed by probe:
`SdkTree === ReactTree` is `false`, and `initialDocsRoot().content instanceof
ReactTree` is `false` — so the seeded `content` is materialized as a plain
`CRDTObject` and `ensureTree` immediately replaces it.

This is the identical bug notes already fixed and pinned
(`src/types/notes-document.ts:1-10`, `notes-document.test.ts`), whose comment
even claims docs gets it right. It is a one-word import change, but it is not
a clean one: `apply-imported-content.ts` seeds the same root through an
`@yorkie-js/sdk` client, so flipping the import moves the realm mismatch to
that path instead. Whether it self-heals there (`setDocument` →
`writeFullDocument` creates the tree when absent) needs verifying before the
change is safe. Filed rather than folded in, since it changes what lands in
every new document's root.

Also unfixed, and the same shape as (2) above: notes, board and sheets pass a
seeding `initialRoot` on the same `shared-document.tsx` block. Each needs its
own "does anything need the key" trace, which this branch did not do.
