# Slides Hover & Text-Edit Entry — Browser smoke follow-up

Spun off from [`20260601-slides-hover-text-edit-entry-todo.md`](20260601-slides-hover-text-edit-entry-todo.md)
after the umbrella PR ([#346](https://github.com/wafflebase/wafflebase/pull/346))
shipped. Two manual/browser scenarios were deferred because the slides
interaction-test harness is still sheets-only (tracked in the umbrella
lessons file under "Deferred / known limitations").

## Open items

- [x] **Phase C — `dblclick` coexistence smoke.** In a real browser
      (`pnpm dev`), confirm a fast double-click on an already-selected
      text-capable element enters edit mode exactly once. P1.5 fires on
      pointerup (slow-click path) and then the browser's `dblclick`
      handler should no-op via `onDoubleClick`'s `editingElementId`
      guard. Verify the docs text-box editor's word-selection (the
      docs `TextEditor` second-mousedown selects a word) survives — i.e.
      the slides editor must NOT remount the textbox on the second
      dblclick.
      **PASS** (manual smoke, 2026-06-21). Fast dblclick + slow-click
      both enter edit once; word-selection survives (no remount). The
      guard is `editor.ts:3505` (`hitResult.elementId === editingElementId`
      early-return).
- [x] **Phase D — Real-Canvas type-to-edit scenario.** Vitest jsdom
      coverage in `test/view/editor/text-box-initial-text.test.ts`
      exercises the wiring (`api.insertText` injection on first focus),
      but the cross-Canvas + real-IME path needs the browser-test lane.
      Spec: select a shape, type `H`, expect `H` in the freshly mounted
      text-box; repeat with Korean IME to verify the partial jamo
      renders immediately (regression hedge on the docs composing
      preview wiring fix).
      **D1/D2 PASS** (ASCII `H`, then `Hi`). **D3 = KNOWN ISSUE** (not
      fixed): typing Korean with a *shape* selected produces decomposed
      `ㅎㅏ` instead of `하`, live from the first jamo. This is the
      regression the scenario was hedging against. Root-caused below; a
      first fix attempt was reverted because it had no effect in a real
      browser. Tracked as a known limitation — see Known issue below.

## Known issue (2026-06-21): Korean IME type-to-edit on shapes

**Symptom.** With a shape (or text element) selected but NOT in edit mode,
typing Korean to enter text-edit ("type-to-edit", `keyboard.ts` rule that
forwards the first keystroke as `initialText`) decomposes the syllable:
`하` renders as `ㅎㅏ`, live from the first jamo. **Scope is narrow:** Docs
documents, Sheets cells, and Slides text entered via double-click all
compose Korean correctly. Only the *keyboard type-to-edit entry* path on
Slides is affected.

**Root cause (hypothesis).** The type-to-edit rule forwards the triggering
keystroke into the freshly-mounted text-box as `initialText` (via
`api.insertText`) and `preventDefault()`s the keydown. That is correct for
an ASCII key, but for an IME-composing keydown it commits a lone jamo and
kills the OS composition, so the next jamo can't join it. The comment at
`packages/slides/src/view/editor/text-box-editor.ts:546` already flagged
"routing a lone Hangul jamo … starts an unintended composition"; an
earlier PR changed *how* the key was injected (textarea hack →
`api.insertText`) but not *that* it is injected for IME keystrokes.

**Attempted fix that did NOT work (reverted).** Added an
`isImeComposingKeyEvent` guard (parity with `sheets/.../worksheet.ts:74`)
so IME keydowns enter edit mode *without* `preventDefault` / `initialText`,
letting the browser composition flow into the synchronously-focused
textarea — the pattern Sheets uses (`worksheet.ts:4086`). Unit tests in
`keyboard.test.ts` went green, but in a real browser D3 still produced
`ㅎㅏ`. Most likely the IME guard never fired: on this environment the
first jamo keydown arrives as `key === 'ㅎ'` (length 1, so it matches the
*printable* gate) and apparently does NOT carry `isComposing` /
`keyCode === 229`, so the keystroke still took the ASCII `initialText`
path. The change was reverted to avoid shipping unverified dead behavior.

**Next investigator: start here.** Instrument the *actual* keydown in
`pnpm dev` (`keydown` on `document`/canvas: log `key`, `code`, `keyCode`,
`isComposing`, `e.which`) while typing the first Korean jamo with a shape
selected. That tells you which signal (if any) distinguishes the IME entry
keystroke. If none is reliable on the entry keydown, the fix likely has to
move off `initialText` injection entirely for this path — e.g. enter edit
mode on the keydown, focus the textarea, and let the *native* keystroke
land in it (true Sheets parity: Sheets never injects, it focuses a real
input and lets the browser route the key). The jsdom unit lane cannot
prove this; it needs the browser smoke lane this task was spun off for.

## Why this is separate

Both scenarios require a slides interaction-test harness that does not
exist yet. Adding the harness is its own scaffolding effort:

- slides bridge methods on `packages/frontend/src/app/harness/interaction/page.tsx`
- scenario registration in `scripts/verify-interaction-browser.mjs`
- slides fixture loader

Out of scope for #346. When the harness exists, both items collapse to
adding a `slides-hover-text-edit-entry.spec.ts` scenario.
