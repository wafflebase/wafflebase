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
