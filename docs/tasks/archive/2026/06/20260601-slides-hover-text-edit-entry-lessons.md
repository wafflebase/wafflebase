# Lessons — Slides Hover & Text-Edit Entry

Captured across the P0 PR (Phase A, #331), the P1.4 PR (Phase B, #334),
and the umbrella follow-up PR (Phases C/D/E + Hangul fix, #346) for
`docs/design/slides/slides-hover-and-text-edit-entry.md`.

## Phases C/D/E + Hangul fix (PR #346)

### Things that diverged from the plan as written

- **`text-box-editor.ts` had two latent pre-existing bugs uncovered by
  P2.6 smoke.** Phase D's brief was "forward the printable key into the
  freshly mounted box." Real-world Korean smoke immediately exposed
  that the docs text-box wrapper (`packages/docs/src/view/text-box-editor.ts`)
  never wired `TextEditor.onComposingContextChange`, so Hangul jamo /
  IME pre-edits never rendered — the whole composition surface was
  invisible in docs tables AND slides text-boxes. Sibling bug: blur
  did NOT call `cancelComposition()`, so a partially-composed syllable
  was dropped on focus-out. Both fixes are one-line each; the main
  editor at `packages/docs/src/view/editor.ts:1487` had the right
  wiring all along. Lesson: when a wrapper duplicates a TextEditor
  instance from elsewhere in the codebase, diff the lifecycle hooks
  side-by-side BEFORE shipping the wrapper. The composing path is
  invisible (view-local rendering) so neither typecheck nor unit
  tests caught the omission.
- **Spec said `beforeinput` + `InputEvent`, code dispatches plain `input`
  + `Event`.** Design doc at `slides-hover-and-text-edit-entry.md:208`
  prescribed `beforeinput`/`InputEvent` with `inputType: 'insertText'`.
  The docs `TextEditor.handleInput` actually listens for plain `input`
  and reads `textarea.value`, ignoring any `inputType`. Initial v1
  implementation matched the docs editor's actual contract (plain
  `input`) but that made the inject brittle to future `inputType`
  gating AND it routed a lone Korean jamo through the software-Hangul
  assembler, starting an unintended composition. Final design: typed
  `TextBoxEditorAPI.insertText(text)` method instead — bypasses the
  textarea + event hack entirely. Lesson: when a spec calls for a
  browser-level synthetic event, check whether the consumer actually
  reads the event's typed fields; if not, a typed API call is both
  simpler and more future-proof.
- **P1.5 semantics ("second click") were not enforced at first.** The
  initial Phase C implementation gated eligibility on "selection
  includes this id," which a programmatic `setSelection` would also
  satisfy. The spec at `§ P1.5` clearly says "a second pointer-down →
  pointer-up sequence," implying there must have been a prior click.
  Caught by self-review (#346 finding #2). Final design: track
  `lastClickElementId` + `lastClickAt` and require the current click
  to match within a 600 ms sequence window. Lesson: when a gate's
  precondition reads "X is selected," ask whether "selected via a real
  click" matters — programmatic selection (presence restore, keyboard
  nav, undo of a deselect) flows through the same selection-state
  channel and will trigger gates that ASSUME user intent.

### Process surprises

- **Self-code-review with 6 parallel finder agents at extra-high effort
  produced 15 findings, all valid.** Six angles (line-by-line scan,
  removed-behavior auditor, cross-file tracer, TS/DOM pitfall scan,
  wrapper/state correctness, reuse/simplify/altitude). All 15 fixed
  in one branch. The xhigh effort cost ~800k tokens but the next
  human review found only 3 minor follow-ons, all already correctly
  scoped. Lesson: parallel finder agents with non-overlapping briefs
  (NOT "review this generically" repeated 6 times) catch a
  qualitatively wider set of defects than sequential passes — the
  removed-behavior auditor in particular surfaced the `detach()`
  symmetric flush bug that line-by-line scans missed.
- **Coderabbit's three actionable findings were a tighter pass on the
  same surface area as my own review.** All three (tautological
  assertion, shape-without-text-body fallback, both-axes-narrow
  corner cursor) were within scope of the line-by-line / cross-file
  finder agents but didn't surface. Lesson: a second pair of eyes
  on the same diff at a lower effort level is complementary, not
  redundant — model variance matters even with comparable prompts.

### Deferred / known limitations

- **Phase C dblclick coexistence manual smoke was deferred.** Vitest
  jsdom can't reliably simulate the synthetic browser `click` that
  follows pointerup, which is the actual hazard P1.5's preventDefault
  guards against. The implementation looks correct (preventDefault on
  the eligible pointerdown), but a real-browser smoke before the next
  follow-up that touches this path is the right safety net.
- **Phase D English type-to-edit browser smoke was deferred.** Vitest
  covers the wiring (`text-box-initial-text.test.ts`) but the
  cross-Canvas + real IME interaction lane lives in the browser test
  harness, which is still sheets-only (see Phase A deferred-list
  below).

### What worked well

- **Splitting the docs fix into its own commit.** The docs
  `text-box-editor` + `text-editor` changes (composing wiring,
  cancelComposition on blur/detach, insertText API) commit cleanly
  on top of `main` independent of the slides feature work. If the
  slides commit ever needs to be reverted, the docs fix can stay.
- **One shared `RESIZE_HANDLE_CURSORS` map in `hit-test.ts`.** Two
  separate sites in the diff (overlay.ts `handleCursor`, new
  hit-test.ts `edgeZoneCursor`) used the same 8-direction mapping.
  Consolidating to one Readonly<Record> caught zero bugs but means
  the next designer-driven cursor-convention change (e.g. iOS
  touch-cursor overrides) has exactly one source of truth.
- **Pure helpers in `hit-test.ts` (edgeZoneAt) + tests against the
  helper, not the editor.** 21 hit-test unit tests covered every
  edge-direction / rotation-cap / narrow-frame combination without
  needing the SlidesEditor scaffolding. The two integration tests
  in `hover-highlight.test.ts` only verify the wiring (canvas style
  cursor reflects the helper's output).

## Phase A (P0 PR)

### Things that diverged from the plan as written

- **No padding to reuse in `text-box-editor.ts`.** The plan started from
  the assumption that the contenteditable mount had a named padding
  constant we could thread into `getTextRegionRect`. It didn't — the
  text-box mounts at the full element frame. We introduced
  `HOVER_TEXT_REGION_INSET_PX = 6` instead and explicitly documented
  that it is a cursor affordance only. Lesson: when a plan claims
  "reuse existing constant X", verify X exists before drafting; the
  exploration subagent missed this in the spec pass.
- **Existing keyboard entry shipped.** `keyboard.ts:481-500` already
  handles `Enter` / `F2` text-edit entry, and `keyboard.ts:514-532`
  handles printable-char-enters-edit (with a v1 caveat noted in the
  source comment that the consumed first character is not forwarded
  to the freshly-mounted text-box). Spec was revised mid-plan-writing
  to reflect this baseline; Phase D (P2.6 follow-up) is now scoped
  specifically to closing the first-character forwarding gap, not
  introducing the rule itself. Lesson: grep for the behavior in the
  codebase **before** asserting "not yet implemented" in a spec.
- **`hitTestSlide` API differs from the plan snippet.** Plan showed
  `hitTestSlide(slide, x, y, { scope: this.selection.getScope() })`;
  the real signature uses `this.hitOptions()` plus `pickScopeId(...)`
  for scope handling. Implementer adapted correctly. Lesson: plan
  pseudocode that "looks reasonable" still needs to compile — when
  in doubt, paste the real call sites from neighboring code into the
  plan, not invented signatures.
- **Overlay state passed via options, not pulled from the editor.**
  The plan suggested calling `editor.getHoverHighlightId()` from
  inside the overlay render. The implementer threaded
  `hoverHighlightFrame` through `OverlayOptions` instead, matching
  how other render state flows. Cleaner. Lesson: when the plan
  picks the "obvious" wiring direction but the codebase already
  established the opposite convention, follow the codebase.

### Process surprises

- **Implementer subagent silently amended the controller's prior
  commit** during Task A1. The controller had just landed the spec +
  plan as `9031f0cd`; the implementer ran `git commit --amend` and
  squashed both into one commit. Recovery (reflog → `git reset
  --mixed` → re-stage in two batches → two fresh commits) was clean
  but added friction. Lesson saved as
  `~/.claude/projects/.../memory/feedback_implementer_never_amend.md`
  and the implementer-prompt template was updated mid-run to forbid
  `--amend`, `git reset`, `git rebase`. Every subsequent task commit
  was clean.

### Deferred / known limitations

- **Browser-test scenario (Task A6) deferred to a follow-up PR.** The
  existing interaction harness
  (`packages/frontend/src/app/harness/interaction/page.tsx`) is
  sheets-only — it loads `@wafflebase/sheets`, builds a grid, and
  exposes a sheet-cell-focused bridge. Adding a slides interaction
  harness is itself a non-trivial scaffolding effort (slides bridge
  methods + scenario registration in
  `scripts/verify-interaction-browser.mjs` + a slides fixture
  loader). Out of scope for the P0 PR. P0 verification rests on the
  9 unit tests in `hover-highlight.test.ts` (state transitions,
  cursor regions, suppression) plus a manual smoke in `pnpm dev`.
  When the slides interaction harness exists, add a `hover-highlight`
  scenario asserting:
  1. `[data-slides-hover-highlight]` appears under the cursor and
     clears when the cursor leaves all elements.
  2. Hovering a selected title placeholder's text region yields
     `getComputedStyle(canvas).cursor === 'text'`.
- **Manual smoke was not run in this session** (controller has no
  browser). The unit tests cover state correctness; the overlay paint
  was reviewed against neighboring `appendOutline` patterns. A human
  smoke before merge is still the right gate.

### What worked well

- **Phasing the work P0 → P2 with explicit "already shipped" notes.**
  Discovering mid-stream that Enter/F2 and printable-key entry were
  already live did not derail the plan because the spec separately
  listed every behavior and the plan let us strike P0.3 cleanly.
- **`getTextRegionRect` as a pure helper.** Decoupling the region
  predicate from the cursor logic let A1 ship + test in isolation,
  and A3 became a thin wiring task.
- **Suppression sites concentrated in `clearHoverHighlight()`.** All
  five suppression triggers (edit, insert, handle, pointer-down,
  pointer-leave) call the same one-liner, so any future suppression
  site is one call away.
