# Token panels + review modal (PR 12a)

Part of #700. Stacked on 11c. Design: `docs/design/design-editor/design-editor-local-plugin.md`
(rollout table row 12).

12 is split because its two halves carry different risk: this one is a known port into
`design-editor` (2,556 prototype lines), and the canvas half is `design-sandbox` work whose
prerequisite — mocking `useDocument()` — the prototype never finished.

## Landed

`TokenEditorPanel` (861) · `TokenBindingPanel` (668) · `ReviewApproveModal` (534) ·
`AddTokenRow` (172) · `Combobox` (170) · `Accordion` (65) · `ComponentList` (86), plus a
local `ui/dialog.tsx` and controlled mode on `ui/popover.tsx`.

⌘S now opens the review, which dry-runs every intent and shows its diff. 11b wrote the plan
straight through because the modal was 12's.

## The D decisions, as taken

- **`PreviewPane` (204) + `registry.tsx` (49): dropped.** The registry is a hand-written
  renderer per component with sample children a human chose (`Button` → `"Continue"`); none
  of it is derivable from source, so a generic package cannot ship it and asking every
  consumer to write one is a new onboarding cliff. The scene frame is the preview surface,
  which is the same argument the design doc already makes for judging a token change on a
  real page. Two consequences, both handled rather than left blank: `ComponentList` shows one
  icon instead of marking "has a live preview", and the review modal shows the class strings
  before/after instead of two empty boxes — which is what a class rewrite exactly is.
- **`AgentPopover` (164): dropped.** The Phase 4 agent pipeline was withdrawn, so it has no
  destination. Recorded as a decision rather than left `unassigned`.

## §6's last coupling is closed

The panels read `TokenFamilyMeta` from `GET /tokens`. What that replaced:

| Prototype | Now |
| --- | --- |
| `FAMILY_META[family].{label,file,cssVar,themeVar,utility,placeholder,defaultValue}` | `familyMetaOf(families, family)` + `cssVarFor`/`themeVarFor`/`utilityFor` |
| `SEMANTIC_FILE`/`RADIUS_FILE`/`TYPOGRAPHY_FILE` — three `packages/core/src/tokens/*.ts` literals | gone; `toTokenIntent` sends `family` and the server derives the path |
| `mockMetadata.tokenVocabulary.semanticRoles` | the adapter's own `bindings.themed.light` keys |
| `Introspection.bindings.{light,dark}` | `bindings.themed` |
| `Introspection.colors: PaletteColor[]` | `bindings.refs: TokenRef[]` (same fields; a reference layer need not be a palette) |
| `Introspection.scales.{radius,typography}` | `bindings.leaves.{radius,typo}` |
| `Introspection.themeMappings` | `utilities` |
| `TokenBinding.kind: literal\|palette\|computed\|other` | `literal\|ref\|expression`, with the ref merged into `value` |
| `previewMutation` / `commitMutations` module functions | the `BridgeClient` prop |

## Findings

**Three defects in code that was already merged.**

1. `CommitResult.results` and `ValidateResult.results` were typed `MutateResult[]`, but both
   routes return `composeIntents`' rows — which carry `located`, `reason`, `label` and
   `file`. The type hid all four, so a caller could only say "the batch failed". Corrected to
   a `BatchOutcome` that matches the wire; the rows are in intent order because
   `composeIntents` iterates sequentially.
2. `BridgeResult` carried no `status`. `/mutate` reports an intent it cannot locate as a 409
   with `ok: false` — the same shape a dead server produces — so "this edit no longer matches
   its file" and "nothing is listening" were indistinguishable. They need different words and
   different recovery.
3. `TokenEditorPanel` looped until React threw #185 when mounted against an adapter with no
   `bindings.themed`: `?? {}` built a fresh object per render, so `colorRoles` → `colorSpecs`
   → `allSpecs` all changed identity and the computed-CSS layout effect set new state each
   pass. Two guards now, either sufficient — the memo removes the churn, an equality check
   makes the loop unreachable.

**A label inaccuracy, deliberately not special-cased.** `core-adapter.ts` reports
`cssVarPrefix: '--radius-'`, but `build-css.ts` emits `radius.base` as the bare `--radius` —
which a pure prefix cannot express. The panel therefore shows `--radius-base`. It is only a
label: `toTokenIntent` sends `family`/`constName`/`path`, so no write is misaddressed. The
prototype special-cased it; doing that here would put a consumer's emission rule back inside
the panel. The contract needs a way to say "this key has no suffix", or the emitter should
emit `--radius-base`.

## Not covered

Staging → review → write is exercised only by `pnpm --filter @wafflebase/design-editor
verify:frame` (37 checks), because the class editor needs a measured selection rect and jsdom
loads no iframe. The `if (openProp === undefined)` guard in `popover` is unobservable through
its public behaviour and is stated as such in the test file.

## Done when

- [x] the three panels mount and render against a live adapter
- [x] ⌘S opens the review, which shows a dry-run diff
- [x] the panels read family metadata from the adapter, not a compiled-in table
- [x] `verify:frame` covers staging → ⌘Z → review
- [ ] a real write lands through the modal's Approve — the gate stops at the diff
