# Lessons — in-app navigation guard for unsent edits

## `useBlocker` is not reachable from this app

The design doc named `useBlocker` and it cannot be called here. In
`react-router@7.18.2` it opens with
`useDataRouterContext("useBlocker")`, which throws outside a router created by
`createBrowserRouter` / `createMemoryRouter`. `App.tsx` mounts
`<BrowserRouter>`, and every component test that renders an editor subtree
mounts `<MemoryRouter>` — so even after migrating the app entry, the hook would
throw in those tests unless each of them migrated too.

The cheap seam is one level down. `NavigationContextObject.navigator` is the
only route react-router takes to change the URL from inside the app: a `<Link>`
click goes through `useLinkClickHandler` → `useNavigate` → `navigator.push`,
and `navigate(-1)` → `navigator.go`. Grepping the shipped bundle for
`navigator.` shows five members read in total (`createHref`, `encodeLocation`,
`go`, `push`, `replace`), which is what makes re-providing the context with a
wrapper safe rather than a gamble.

Worth knowing for next time: react-router calls those methods **unbound** —
`(options.replace ? navigator.replace : navigator.push)(to, …)` — so the
replacement must not depend on `this`.

## The residual is `popstate`, and it is invisible

The navigator wrapper covers everything the app initiates. Browser back/forward
does not go through it; it arrives on the history listener, which is why
`useBlocker` (which sits inside the router's own history integration) covers
`POP` and this does not. Nothing in the UI tells the user that, and
`beforeunload` does not cover it either — so the honest statement is that this
narrows the data-loss window rather than closing it, exactly as the unload
guard does.

## Deciding at fire time, again

The unload guard already learned this: register on the smoothed label, decide
on the live signal. The same split applies to navigation, and for a sharper
reason — `Saving…` persists for a two-second quiet window after the last
keystroke, and a modal dialog in front of every sidebar click for two seconds
after any edit is worse than no dialog at all, because people learn to dismiss
it without reading.

## Same-path navigations are not "leaving"

A guard that blocks on every `navigator.push` also blocks a document updating
its own query string. No editor does that today, so the exemption is not fixing
a live bug — but the distinction the issue actually asks for is "leaving this
document", not "changing the URL", and encoding it costs three lines.

It cost four, because `createHref` does **not** prepend the basename (it is
`createPath(to)` for both the browser and memory histories) while `useNavigate`
has already joined the basename into the pathname it pushes, and `useLocation`
strips it back off. Comparing the two raw makes every navigation read as
"leaving" the moment `VITE_FRONTEND_BASENAME` is set — a deployment setting, so
the bug would have been invisible in dev and in every test.

## `push` is the user; `replace` is the app

The first draft guarded `push`, `replace` and `go` alike, and self-review found
that this breaks the app's own redirects. Every editor runs
`navigate(fallback, { replace: true })` from an effect when its document 404s,
and `PrivateRoute` renders `<Navigate to="/login" replace />`. Holding one of
those back and then answering *Stay* swallows it **permanently** — the effect
is keyed on state that does not change again — leaving the user inside an
editor for a document that no longer exists.

That is the general shape of the hazard in any navigation guard: it can only
safely refuse a navigation whose issuer will ask again. A user clicking a link
will. An effect will not. In this codebase the two are already cleanly
separated by `push` versus `replace`, so the rule costs nothing to adopt.

Two smaller versions of the same problem, both found by review rather than by
running it: a prompt has to be dropped when the location moves under it (the
provider outlives the route the dialog is about), and a second held navigation
must not overwrite the first (the dialog names one destination and would send
you to another).

## The eager import nobody sees

`components/ui/alert-dialog.tsx` looks free. It is not: `vite.config.ts` splits
`@radix-ui/react-alert-dialog` into a deferred `vendor-ui-history` chunk
*because it had exactly one consumer*, a lazy panel. Importing it from a
provider mounted in `App.tsx` would have quietly put ~14 kB back on every
route's first paint and falsified the comment explaining the split. `ui/dialog`
costs nothing because the shell already loads Radix Dialog eagerly.

Worth checking, on any change that adds an import to an eagerly-loaded module:
whether `manualChunks` says something about what you are importing.
