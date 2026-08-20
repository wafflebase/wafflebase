# Lessons — frame runtime (PR 10b, #855)

## A kill-switch that answers is worse than one that refuses

`installFetchGuard` reports a miss instead of falling through to the network. A scene whose
data silently 401s is indistinguishable from a scene that is broken, and the frame's whole
premise is that it reaches nothing. The one request that still escapes —
`/api/notifications/stream`, an `EventSource` — is recorded rather than quietly tolerated.

## Dispose what you install, or the suite tells you nothing

The picker installs capture-phase listeners and a MutationObserver at module scope so a
fast-refresh update cannot stack a second set. That only holds if there is a `disposePicker`
and the tests use it; otherwise every later test inherits the previous one's observers.
