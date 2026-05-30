# Docs Pending Inline Style — Lessons

Companion to `20260530-docs-pending-inline-style-todo.md` (design doc at
`docs/design/docs/docs-pending-inline-style.md`).

## What landed

1. `view/pending-style.ts` controller (`createPendingStyle(doc)`) — 50 LOC,
   10 unit tests.
2. `view/editor.ts` — `applyStyleImpl` branches on collapsed selection to
   record pending; `getSelectionStyle` merges pending so the toolbar
   reflects the toggle immediately; `clearInlineFormatting` records
   `CLEAR_INLINE_STYLE` as pending when collapsed; `handleBlur`, `undoFn`,
   `redoFn`, and the inline-image insert path clear pending; controller is
   wired into `TextEditor` via a `setPendingStyle` setter.
3. `view/text-editor.ts` — three private helpers `docInsertText`,
   `docDeleteText`, `docSplitBlock` wrap every `doc.*` mutation with the
   pending hooks (consume on insert, clear or rewind on delete via
   `keepPending` opt, rebind on split). Non-typing handlers
   (`handleMouseDown`, `handleArrow`, `handleHome`, `handleEnd`,
   `handleDocStart`, `handleDocEnd`, `handleCopy`, `handleCut`,
   `handlePaste`) clear pending.
4. `test/view/pending-style-integration.test.ts` — 6 end-to-end scenarios
   (collapsed toggle + typing, caret-move discard, Enter rebind, IME
   composing rewind, layered toggles, anchor-mismatch clearing).

## Deviations from the written plan

- **Plan suggested constructor option for `pending` on TextEditor.**
  Reality: `TextEditor`'s constructor already takes 18 positional args
  (slides text-box-editor also instantiates it). Added a
  `setPendingStyle()` setter instead — symmetric with the existing
  `setCursorTarget()` setter and keeps the constructor signature stable
  for both call sites. Slides text-boxes simply don't call the setter,
  so pending behavior is opt-in.

- **Plan suggested per-call-site wiring for ~30 mutation sites.** Reality:
  added three private helpers (`docInsertText`, `docDeleteText`,
  `docSplitBlock`) that centralize the pending hooks; swapping the
  call sites was a uniform replace. Result is much harder to forget a
  site (one place to look for the wiring), and the slides text-box
  path stays no-op via the `?.` operator on `this.pending`.

- **Plan's "Task 2 alone" commit failed the typecheck.** The pre-commit
  hook ran `pnpm verify:fast`; the unused `pending` field on
  `TextEditor` (set in Task 2, only read in Task 3) tripped TS6133.
  Bundled Task 2 + 3 + 4 into a single commit instead. The plan
  anticipated this case in Step 2.7 — bundled commit was the chosen
  resolution.

- **Plan's integration test scaffold assumed `Doc` constructs blocks.**
  Reality: `MemDocStore` starts empty; explicit
  `store.setDocument({ blocks: [createEmptyBlock()] })` was needed
  (matches the pattern in `test/model/document.test.ts:680`).

## Browser smoke caught a parallel keyboard code path (876e40f0)

After the first commit batch landed, manual `pnpm dev` smoke surfaced
two symptoms: Cmd+B at an empty caret did nothing, and re-pressing
Cmd+B never toggled off. Root cause was a second entry point into
inline-style writes that the design doc never named: the toolbar
buttons call `editor.applyStyle` → `applyStyleImpl`, but keyboard
shortcuts call private `text-editor.toggleStyle` / `clearFormatting`,
and only the toolbar surface had been wired for pending. Both private
methods early-returned on `!hasSelection`.

Fix: route both methods through `pending.set` on collapsed selection,
flipping the toggle against the *visual* style (caret style + pending
merged) so re-pressing reads the displayed state and not the stale
doc state. 4 new keyboard-path tests
(`pending-style-editor.test.ts`) dispatch synthetic `KeyboardEvent`s
on the hidden textarea to exercise the surface end-to-end.

### Generalisable lesson

Cross-cutting state changes need test coverage at every public surface,
not just the most prominent one. Controller-level integration tests
(`pending-style-integration.test.ts`) and the editor-API spec
(`pending-style-editor.test.ts`'s `applyStyle` test) both pass with
this bug present — neither touched the keyboard path. The follow-up
keyboard-shortcut tests are the institutional fix: any future
inline-style write must come through one of two surfaces, and both
have explicit coverage.

When the design doc lists Architecture, walk every code path that
*writes the data the design models* — not just the most visible one.
The original design doc named `applyStyleImpl` and
`clearInlineFormatting` but never mentioned `text-editor.toggleStyle`,
which is what the keyboard shortcuts call. That omission is what
allowed the gap to ship past the controller-level tests.

## Things I'd note for future similar work

- When wiring a cross-cutting transient state, prefer wrapping the
  underlying mutation API in helpers on the consumer rather than
  scattering hook calls at every site. Future contributors changing
  the editor will reach for `this.doc.*` and immediately see the
  helpers as the canonical path.

- Pending state's anchor model (anchor block id + offset that
  advances on consume) is robust to anchor-mismatch from any other
  edit path — markdown auto-convert and unrelated peer edits naturally
  fall through to "clear" without explicit guards.

- IME wiring through `keepPending: true` on the delete-then-reinsert
  cycle was the only place where the wrapping pattern had to expose
  per-call-site policy. Two of those four sites live in the Hangul
  software assembler; future IME work should keep them in sync.

## Verification evidence

- `pnpm --filter @wafflebase/docs test` — 50 files / 822 tests passing
  (816 prior + 10 controller unit + 6 integration; 1 pre-existing skip).
- `pnpm verify:fast` — exit 0 across the full monorepo.
- Pre-commit hook ran `verify:fast` on the Task 2+3+4 commit and
  succeeded.

## Manual browser smoke

- First pass surfaced two bugs in `pnpm dev`: Cmd+B did nothing on
  collapsed caret and never toggled off. Both fixed in 876e40f0; see
  "Browser smoke caught a parallel keyboard code path" above.
- Remaining scenarios from the design doc's "Testing" section (Enter
  preserve, arrow-key clear, IME, color via toolbar, mobile bottom
  sheet) — user verifies before merge.
