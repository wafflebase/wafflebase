# Docs: close the four loose ends from #985

Issues: #988, #989, #990, #991. All four descend from the review of PR #985
("Surface Docs page setup, text exports, and format painter"). None is a
regression of that PR — every one is pre-existing and was filed rather than
folded in, to keep #985's blast radius small.

They ship as one branch because three of the four live in `packages/docs`,
#988 and #990 are two defects in the *same function*, and #991 item 3 is a
line of the same proxy #989 replaces.

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

- [x] `pnpm verify:fast`
- [x] New tests fail on `origin/main` and pass on the branch
- [x] Self-review over the full branch diff before pushing
