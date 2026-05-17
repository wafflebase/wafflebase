# Slides Thumbnail Scroll + Arrow Key Nav — Lessons

## 1. `innerHTML = ''` silently destroys parent scrollTop

`render()` in `thumbnail-panel.ts` had wiped children via
`container.innerHTML = ''` for over a year. The visible regression
(snap-to-top on every click) was easy to miss in jsdom because jsdom
doesn't run layout, so `scrollHeight` never collapses and `scrollTop`
isn't clamped. Real-browser smoke catches it instantly.

**Rule:** for any DOM-rebuilding render path, ask: "what does the
scrollable ancestor look like when this container is empty for a frame?"
If `scrollHeight` would drop below the current `scrollTop`, the browser
clamps. Always save & restore (or diff instead of wipe).

## 2. Focus retention on non-focusable elements is the default

Clicking a `<canvas>` does NOT move focus away from the previously
focused element in any major browser — `mousedown`'s default
focus-retarget is a no-op when the target isn't focusable. This made
the arrow-key nudge regression non-obvious: the panel had focus from
the thumbnail click, kept it through the canvas element click, then
ate ArrowUp/Down.

**Rule:** when adding scoped keyboard handlers via panel-level
listeners, always gate on whether the handler's "domain" is currently
the user's intent. For the slides editor, that meant
`editor.getSelection().length > 0` → defer to canvas-level rules.

## 3. `scrollIntoView` is missing in jsdom

Optional-chain (`?.scrollIntoView?.()`) is the cheap fix; otherwise the
unit test throws an unhandled exception that vitest reports as "Errors"
even when individual asserts pass.

## 4. Test the *clamp*, not the *behavior under jsdom*

The scroll-preservation test had to override the `innerHTML` setter to
synthesize the real-browser clamp (set `scrollTop = 0` synchronously
during the wipe). Without that, the test passes both with AND without
the fix — no regression coverage. **Rule:** when fixing a
browser-platform behavior, make the test fail by *simulating the
platform behavior*, not just by exercising the changed code path.

## 5. `defaultPrevented` is observed after the full dispatch chain

My first canvas-selection-bail test asserted `event.defaultPrevented
=== false`, then was surprised when it was `true` — the document-level
nudge rule was preventDefault-ing downstream. Asserting on terminal
event state mixes the panel handler's bail with whatever runs after.
**Rule:** verify by observing the *intended side effect* (the element
moved by 1px, the current slide didn't change), not the event flag.

## 6. CLAUDE.md task-doc workflow is paired

Forgot to write this lessons file before opening the PR. Workflow says
"capture lessons in `*-lessons.md`" before archiving. Going forward:
add the lessons file as soon as the implementation lands, not after
merge — the context is freshest right after coding.
