# Warn before in-app navigation with unsent document changes

Issue: #987
Design: `docs/design/sync-status.md` (§ Risks — "In-app navigation is not
guarded at all")

## Problem

`SyncStatusChip` registers a `beforeunload` guard while local edits are still
ahead of the server, so closing or reloading the tab prompts. A **route
change** does not fire `beforeunload`: one click on a sidebar link unmounts the
`DocumentProvider` and discards Yorkie's in-memory change queue silently. The
chip says `Not saved` right up to the moment the work disappears.

## Constraint found while exploring

The design doc proposes `useBlocker`. `useBlocker` needs a **data router**
(`useDataRouterContext` throws otherwise), and `App.tsx` mounts
`<BrowserRouter>` — as do ~dozen component tests via `<MemoryRouter>`. Reaching
`useBlocker` means migrating the app entry to `createBrowserRouter` +
`RouterProvider`, moving `AnalyticsTracker`/`Suspense`/`DebugReportMount` into a
root route, and changing route error handling for every route in the app.

Instead the guard intercepts at the **navigator** seam: react-router routes
every `<Link>` click and every `useNavigate()` call through
`UNSAFE_NavigationContext`'s `navigator.push` / `replace` / `go` (verified in
`react-router@7.18.2`, which reads only those five members off it). Wrapping
that object blocks the same navigations `useBlocker` would, without touching a
single route.

What this does **not** cover: browser back/forward (`popstate`), which arrives
through the history listener rather than the navigator. `beforeunload` does not
cover it either. Recorded as a known limitation.

## Plan

- [x] `src/components/navigation-guard/navigation-guard.tsx`
  - `NavigationGuardProvider` — re-provides `UNSAFE_NavigationContext` with a
    patched navigator, holds the deferred navigation, renders one
    `AlertDialog` (Stay / Leave).
  - `useNavigationGuard(active, guard)` — a guard returns the prompt to show,
    or `null` to let the navigation through. Asked at **fire time**, so the
    decision is the live signal and not a rendered label.
  - Same-pathname navigations (a query/hash update on the document you are
    already on) are never blocked — the issue is about leaving the document.
  - Outside a provider the hook is a no-op, so the ~dozen `MemoryRouter`
    component tests keep working untouched.
- [x] Mount `NavigationGuardProvider` inside `<Router>` in `App.tsx`.
- [x] Register the guard in `SyncStatusChip`, next to the `beforeunload` one,
      gated on the same `mayHaveUnsent` and deciding on the same
      `hasUnsentEdits()`. Mounting the chip is already what arms the unload
      guard, and the chip is mounted exactly where the issue asks — the five
      editable editors via `SiteHeader syncStatus`, and share-link **editors**
      via `SharedHeaderStatus` (a viewer gets the "View only" badge and no
      chip, so viewers are never prompted).
- [x] Tests
  - `tests/components/navigation-guard/navigation-guard.test.tsx` — blocks,
    stays, leaves, lets an unguarded navigation through, no-op outside a
    provider, same-path exemption.
  - extend `tests/components/sync-status/sync-status-chip.test.tsx` — prompts
    only with unsent edits; silent when saved, when disconnected with nothing
    pending, and for a viewer (no chip → no guard).
- [x] Update `docs/design/sync-status.md`: the limitation becomes the shipped
      behaviour, with the `useBlocker` deviation and the `popstate` residual.

## Acceptance criteria (from the issue)

- [x] Block in-app navigation only when local edits have not reached the server
- [x] Do not prompt when all changes are saved
- [x] Do not prompt for a disconnected document with no pending edits
- [x] Do not prompt for read-only viewers
- [x] Keep the existing `beforeunload` behaviour
- [x] Applies to editable Sheets, Docs, Slides, Notes and Board
