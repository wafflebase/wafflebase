# design-editor frame runtime (PR 10b)

Part of #700. Follows 10a (#855). The frame's DOM runtime — everything that runs
inside a scene frame and needs no React.

## Scope

| File | Lines | Origin |
| --- | --- | --- |
| `src/scenes/frame-picker.ts` | 641 | port; gains `disposePicker` |
| `src/scenes/fetch-fixtures.ts` | 149 | port; the passthrough prefix fixed |
| `src/scenes/hmr-state.ts` | 158 | port, unchanged behaviour |

`jsdom` joins the dev dependencies — the first DOM test environment in this
package. Per-file `@vitest-environment jsdom`, no config change.

## The defect the port found

`installFetchGuard` let requests through by hardcoded prefix, one of which was
`/__design-sdk/` — a namespace the shipped plugin does not serve. Every request to
the editor's own routes therefore fell through to the miss path and **threw**
instead of passing through. Derived from `BASE` now, so it cannot drift again.

## What the DOM tests forced

`installPicker` attached window listeners, two `ResizeObserver`s and a
`MutationObserver` and had **no teardown**. A `MutationObserver` callback is a
microtask, so it fires after its document is gone — it took the first test run down
twice, once on `Element` and once on `window`, from inside an observer where nothing
catches it. `disposePicker` (one `AbortController` + the observer list) is the fix.

The first attempt instead guarded each global read. Reverting that guard with
`disposePicker` in place changes no test, which is the evidence it was treating the
symptom — so it is gone.

## Not in scope

`SceneHost` + the three panels + `scene-entry` (1,805 lines). They need React, which
this package does not depend on, plus a local `cn()`, a rewrite of the 25 `Select`
call sites away from the consumer's shadcn component, and fixtures that belong in
`design-sandbox`. That is a rewrite of the chrome, not a port.

## Done when

- [x] the frame passthrough derives from `BASE`
- [x] the picker is disposable, and the suite leaks no observer
- [x] the dark selector is a parameter, not a constant
- [x] §8 records what remains and why
