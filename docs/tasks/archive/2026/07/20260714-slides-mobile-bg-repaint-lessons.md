# Lessons — Slides mobile/presenter background repaint

## The bug class: `markDirty()` only flips a flag

`SlideRenderer.markDirty()` sets `this.dirty = true` — it does **not** repaint.
A repaint only happens when a consumer re-calls `render()`. Consumers with a
per-frame RAF loop (desktop editor) or a scheduler (thumbnails) self-heal an
async image load; consumers that paint on discrete events (mobile view,
presenter) do not, so a background image decoded after the first paint stays
blank until an unrelated event.

Takeaway: when wiring an async-asset callback, confirm the consumer actually
re-drives `render()` — a bare `markDirty` is a silent no-op there.

## Don't repaint on top of an active animation loop

The first cut added `onAssetLoad → scheduleRepaint → paint()` and I commented
"paint() handles the animation branches, so this is safe to fire at any time."
That was wrong. `paint()` renders the **settled/resting** slide; firing it
while a transition or object-animation RAF loop is mid-flight flashes the
resting/next slide over the in-progress animation for one frame.

Correct rule: a repaint scheduler must **defer to any running render loop**.
Guard on `rafHandle !== null || transitionRafHandle !== null` — those loops
already repaint every frame (and re-query the image cache), and the transition
settles via its own `onDone` `paint()`. The high-effort code review caught
both manifestations; they shared one guard.

## Effect-scoped async callbacks outlive cleanup

A callback subscribed into a module-level cache (here `image-cache`
`pendingCallbacks`) is retained past the React effect's cleanup. Add a
`cancelled` flag the callback checks, so a late fire can't schedule an
uncancellable RAF against a torn-down scope.
