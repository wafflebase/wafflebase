---
title: sync-status
target-version: 0.6.7
---

# Sync Status

## Summary

A document editor that loses its connection to Yorkie today looks exactly like
one that has not. The caret still moves, text still appears, the toolbar still
works — and every keystroke lands in a queue that is never drained. Close the
tab and the work is gone, with no warning at any point.

This proposes the missing feedback: a **status chip** next to the document
title, a **one-shot notice** at the moment connectivity changes, and a
**`beforeunload` guard** that fires only while unpushed edits exist. All three
read signals the Yorkie SDK already emits; none of them changes the CRDT, the
schema, or any store.

The framing is borrowed from Google Docs, which ties the severity of what it
shows to the **durability of the pending edits** rather than to connectivity
itself: with offline mode on, edits are in IndexedDB and the message is calm
("Saved to this device"); with offline mode off, edits are in memory and it
warns and blocks the unload. Wafflebase is unconditionally in the second
situation — the Yorkie JS SDK persists nothing locally *unless asked to*, and
we do not ask — so this adopts the warning half and states the risk plainly.

### Goals

- A document editor always shows whether its local edits have reached the
  server.
- A user who loses connectivity finds out **while it happens**, not by
  discovering missing work later.
- Leaving a document that holds unpushed edits requires a deliberate
  confirmation — closing or reloading the tab, and navigating away inside the
  app.
- One implementation covers sheets, docs, slides, notes, and board — no
  per-engine work beyond opting the shell in. PDF comments are excluded; see
  [Where it lives](#where-it-lives).

### Non-Goals

- ~~**Offline persistence.**~~ **No longer a Non-Goal** — it is being built in
  [offline-local-persistence.md](offline-local-persistence.md), and this
  document's premise now holds only for the documents that have not opted in.
  What that changes here:

  - The chip gains a fifth state, `saved-locally` ("Saved to this device"). It
    replaces `not-saved` exactly when the pending work is on this device's
    disk, which drops the loudest state to muted without touching any other
    row. Severity still keys on where the edits are, which is the same
    principle that put `pending` rather than connectivity at the centre of
    `deriveSyncState`.
  - `not-saved`'s tooltip — the wording that names this tab as the only copy —
    stays exactly right for every non-durable document, which is still the
    default. It is now one of two answers rather than the only one.
  - The `beforeunload` guard is suppressed while durable, since what it exists
    to prevent no longer happens.

  The two obstacles this section named were real and are both resolved. The
  random client key was not merely unset: `ClientOptions.key` collides with
  React's reserved `key` prop, so `YorkieProvider` could not receive one at
  all — fixed upstream by a `clientKey` prop (yorkie-js-sdk#1357). The
  single-active-session guard is handled by electing one tab per document in
  the app, before the SDK's own lock is ever reached, so the second tab keeps
  today's behavior instead of failing its attach.
- ~~**A user-facing offline mode toggle.**~~ Shipped as a per-*device* Settings
  preference, off by default. It is device-local rather than account-level
  because an account setting would follow the user onto a shared machine and
  re-enable there, which is the case the toggle exists to prevent.
- **Retry/backoff policy.** Reconnection is the SDK's watch loop. This surface
  reports it and does not steer it.
- **Read-only viewers.** A viewer with no edit rights has no local changes to
  lose; the chip stays hidden there rather than reporting a connection state
  that carries no consequence.

## Proposal Details

### The signals already exist

Verified against `@yorkie-js/sdk` and `@yorkie-js/react` as installed
(`packages/frontend/node_modules/@yorkie-js/sdk/dist/yorkie-js-sdk.d.ts`):

| Signal | API | Meaning |
| --- | --- | --- |
| Watch stream up/down | `useDocument().connection` → `StreamConnectionStatus.Connected \| Disconnected` | Whether the realtime channel is open. Also surfaced as the `useConnection()` hook. |
| Push/pull outcome | `doc.subscribe('sync', …)` → `DocSyncStatus.Synced \| SyncFailed` | The result of the last sync attempt. |
| **The user edited** | `doc.subscribe(cb)` → `LocalChangeEvent` | Edge-triggered, and raised *only* for a change that carried operations. Carries the change's `clientSeq`. |
| **The server took it** | `doc.getCheckpoint().getClientSeq()` | The client sequence the server has acknowledged. |

Outstanding work is `lastEditSeq > checkpoint.clientSeq`.

#### Why not `hasLocalChanges()`

It is the obvious candidate and it is wrong. `Document.update()` reads, in the
published bundle:

```js
this.localChanges.push(change);        // EVERY change, presence-only included
...
if (opInfos.length) {                  // an event only when there were operations
  event.push({ type: 'local-change', ... });
}
```

So a presence-only change — dragging a selection, moving a caret — enters the
queue and makes `hasLocalChanges()` true while emitting no `local-change` at
all. The queue is a transport detail, not a record of the user's work. Driving
the chip from it made Sheets toggle `Saving`/`Saved` on a bare cell drag, with
nothing edited.

The sequence comparison asks the question the chip actually means, and presence
can never enter into it.

### The states

The chip is a function of two booleans — connected, and pending — plus
a transient "a sync is in flight" bit, and, since
[offline-local-persistence.md](offline-local-persistence.md), whether the
pending work is on this device's disk:

| Connection | Outstanding work | Durable | Chip | Tone |
| --- | --- | --- | --- | --- |
| Connected | none | – | `Saved` | muted |
| Connected | pending | – | `Saving…` | muted |
| Disconnected | none | – | `Reconnecting…` | muted |
| Disconnected | pending | yes | `Saved to this device` | muted |
| Disconnected | pending | no | **`Not saved`** | destructive |

`durable` is false unless a document has opted in, which is the default, so
the fifth row is what happens today and the fourth is the exception. It also
covers a push the server keeps rejecting while connected — that work is
exactly as unsent, and exactly as safe on disk — so `saved-locally` is not
strictly a disconnected state.

Only the last state is loud. That is the whole point of keying on outstanding
work rather than on connectivity: a user reading a document on a flaky train
connection should not be alarmed, and a user who has typed a paragraph into a
dead socket should be — unless it is on their disk, which is the row offline
persistence adds. The unload guard covers the rows where work is not on the
server *and* not on the disk —
both mean the work is not on the server yet; see [The unload
guard](#the-unload-guard).

The chip carries a tooltip that says what the state actually means. For
`Not saved`: *"Changes since <time> haven't reached the server. They exist only
in this tab — closing or reloading it will lose them."* The wording commits to
the real risk rather than the reassuring version.

`DocSyncStatus.SyncFailed` while still connected (a rejected push — auth
expiry, a removed document) also resolves to `Not saved`, since the outcome for
the user is identical; only the toast copy differs, per [The transition
notice](#the-transition-notice). A failure is recorded **only when something
was pending at the time** — a pull that did not land costs the user none of
their own edits, and remembering it would make the *next* edit report as
rejected over a push that was never attempted.

Before the provider has a document at all, the state is `Saved` rather than
`Reconnecting…`. There is no connection to have lost and nothing queued to
lose, and the alternative flashes "Reconnecting…" on every document open for
the length of the attach.

### Where it lives

`SiteHeader` (`packages/frontend/src/components/site-header.tsx`) is the one
component every editor shares, and it already renders inside the
`DocumentProvider` subtree in every case — `UserPresence`
(`components/user-presence.tsx:51`) calls `useDocument()` from within
`SiteHeader`'s children today, which proves the context is reachable there.

Mount points, all of which nest `<Layout>` inside `<DocumentProvider>`:

| Type | Layout renders `SiteHeader` | Provider |
| --- | --- | --- |
| sheet | `documents/document-detail.tsx:648` | `:818` |
| doc | `docs/docs-detail.tsx:178` | `:260` |
| slides | `slides/slides-detail.tsx:350`, `:695` (mobile) | `:851` |
| notes | `notes/notes-detail.tsx:187` | `:251` |
| board | `board/board-detail.tsx:117` | `:166` |

So the chip goes in `SiteHeader` itself, left of the `children` slot — the same
position Google's status control occupies relative to the title.

It is **opt-in**, via a `syncStatus` prop, and not because an editor could
reasonably decline it. `SiteHeader` is also mounted by two shells that have no
Yorkie document in scope — the documents list (`app/Layout.tsx`) and the
static-file viewer (`app/files/file-shell.tsx`) — and `useDocument()` throws
`"useDocument must be used within a DocumentProvider"` outside a provider. An
always-on chip would take those pages down. The prop is the smallest thing that
keeps the position uniform while letting the two document-less shells abstain.

`shared/shared-document.tsx` builds a bare top bar instead of using
`SiteHeader`, and its share role can be editable, so it needs its own mount.
That is why the chip ships as a standalone `<SyncStatusChip />` rather than as
markup inlined into `SiteHeader`. All five shared layouts had duplicated the
same inline "View only" badge; that badge becomes one `SharedHeaderStatus`
component which answers the whole question — the badge for a viewer, the chip
for an editor — so the shared path has a single seam rather than five.

PDF and image are **not** covered, on either route. The owned route
(`app/files/file-shell.tsx`) mounts no `DocumentProvider` — the PDF comment
document lives further down in `pdf-collab.tsx` — so the chip cannot be reached
there without restructuring that shell, which is out of proportion to the risk
of losing a stranded comment. The shared PDF layout *could* have it (its header
does sit inside the comment provider), and deliberately does not: a document
type whose sync chip depends on which URL you opened is worse than one with
none. `SharedPdfLayout` keeps its inline badge, with a comment saying why.

### The transition notice

The chip is easy to not look at. The moment connectivity drops is the moment
the user needs to know, so a `sonner` toast (already mounted in `App.tsx`)
fires on the **transition** into `Not saved`:

> **Not saved** — Your connection dropped and recent changes haven't reached
> the server. Keep this tab open; they'll sync when the connection returns.

It is a toast on the edge, not a persistent banner — the chip is the persistent
surface. Transitions are debounced (~2s) so that a single dropped frame of the
watch stream, which the SDK recovers from on its own, never produces a toast.

`Not saved` is reached two ways, and the copy follows the cause. If the
connection is still up, the state came from a **rejected push**, and the
message says so instead — telling someone whose network is fine that it dropped
sends them to debug the wrong thing:

> **Not saved** — The server rejected your recent changes, so they haven't been
> saved. Keep this tab open — closing it will lose them.

Retraction and confirmation are **two different things**, and conflating them
hands out a false receipt. Leaving `Not saved` dismisses the warning
immediately — it is no longer true. But the confirmation waits for `Saved`,
because reconnecting moves the state to `Saving…`: the push has not been
attempted yet and can still be rejected. Saying *"your changes reached the
server"* at the moment the socket comes back would be a durability claim with
no evidence behind it, which is the one thing this feature must never do.

### The unload guard

`Saving…` is not a safe state either — the work is not on the server yet, and a
reload during it loses the edit as surely as one while disconnected. So the
guard covers both, and `Reconnecting…` (nothing outstanding) neither:

```ts
const mayHaveUnsent = state === 'saving' || state === 'not-saved';

useEffect(() => {
  if (!mayHaveUnsent) return;
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!hasUnsentEdits()) return;   // live read, not the smoothed label
    e.preventDefault();
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}, [mayHaveUnsent, hasUnsentEdits]);
```

**Whether it blocks is decided at fire time, not at registration.** The chip
holds `Saving…` through the quiet window after the last keystroke, by which
point the server has usually taken the work — guarding on the label alone would
put a browser dialog in front of every reload for two seconds after any edit,
which is exactly how a prompt gets trained into a reflex. `hasUnsentEdits()` is
the unsmoothed sequence comparison, asked at the instant the user tries to
leave. Smoothing is for the chip; the guard wants the truth.

There is no `beforeunload` handler anywhere in `packages/frontend/src` today,
so nothing conflicts. Conditional registration matters: a handler that is
always attached would prompt on every navigation away from a perfectly synced
document, which trains users to click through it.

### The navigation guard

`beforeunload` does not fire for a route change, and a route change is the
*more common* way to leave an editor. One click on a sidebar link unmounts the
`DocumentProvider` and discards the change queue with nothing said, while the
chip is still reading `Not saved` (issue #987).

So the same condition, decided the same way, also holds back **in-app
navigation** — a Stay / Leave dialog where the browser's own prompt would have
been. `SyncStatusChip` registers it next to the unload guard, which is what
makes the coverage identical and free: the five editable editors reach it
through `SiteHeader`'s `syncStatus`, and share-link editors through
`SharedHeaderStatus`. A **viewer** gets the "View only" badge instead of a
chip, so no guard is ever registered for one.

#### Why not `useBlocker`

It is the supported answer and it is out of reach. `useBlocker` opens with
`useDataRouterContext`, which throws outside a router built by
`createBrowserRouter` / `createMemoryRouter`; `App.tsx` mounts
`<BrowserRouter>`, and a dozen component tests mount `<MemoryRouter>` — so
migrating the app entry would still leave the hook throwing in every one of
those tests unless they migrated too. That is a change to how every route in
the app is mounted, in service of a dialog.

The seam one level down costs nothing: `UNSAFE_NavigationContext`'s
`navigator` is the single path react-router takes to change the URL from inside
the app (`<Link>` → `useLinkClickHandler` → `useNavigate` → `navigator.push`;
`navigate(-1)` → `navigator.go`). `NavigationGuardProvider`
(`components/navigation-guard/`) re-provides that context with a wrapper that
asks the registered guards first, holds the attempted navigation in a ref, and
replays it verbatim if the user leaves. Two details make the wrapper safe
rather than a gamble, both checked against `react-router@7.18.2`: only five
members are ever read off a navigator (`createHref`, `encodeLocation`, `go`,
`push`, `replace`), and they are called **unbound**, so the replacement must
not depend on `this`.

Registering outside the provider is a no-op rather than an error — the same
opt-in reasoning the chip's `syncStatus` prop follows, and what keeps the
existing `MemoryRouter` tests working untouched.

Two navigations are deliberately never held.

A **same-path** one, because a document rewriting its own query string is not
leaving anything, and the question this guard asks is whether the user is
leaving the document. (`createHref` does not prepend the basename while
`useNavigate` already has, so the comparison joins it back onto the current
pathname — otherwise every navigation reads as "leaving" on a deployment that
sets `VITE_FRONTEND_BASENAME`.)

And a **`replace`**, which is the more interesting line: a push is the user
going somewhere, a replace is this app correcting the URL on its own behalf.
An editor sends you back to the workspace when its document 404s
(`document-detail.tsx` and its four siblings), `PrivateRoute` sends you to
`/login`. Those redirects are not refusable — there is nothing to stay on — and
because the effect that issued one does not run again, a *Stay* would swallow
it permanently and strand the user in an editor for a document that is gone.
`go` is the programmatic back button, and is left alone for the same reason the
real one is.

That makes "an app-issued redirect is a `replace`" an **invariant this app has
to uphold**, not a property it happens to have. The 404 redirects pass
`{ replace: true }` to `navigate()`, but `<Navigate>` defaults to `replace={false}`
— a push — so `PrivateRoute` and `PublicRoute` spell it out
(`<Navigate to="/login" replace />`). Without that they would route their
redirect through the guard, which is precisely the case the guard cannot
answer: a *Stay* on an expired session leaves the user sitting in a route their
session no longer reaches.

The router is not the only eviction path, and the other one is not a `replace`
this invariant can reach. `fetchWithAuth` answers a 401 it could not refresh by
logging out and assigning `window.location.href = "/login"`
(`packages/frontend/src/api/auth.ts`) — a full-page navigation, which the
**`beforeunload`** guard above makes *refusable* by the browser's own prompt.
That refusal is a legitimate choice (unlike the in-app dialog, the browser
states plainly that the alternative is losing the page), but the redirect was
latched behind a module-level `isRedirecting` flag so a burst of concurrent
401s produces one navigation — and a refused navigation left that flag set for
the rest of the tab, silently turning session eviction off: every later 401
would throw `AuthExpiredError` while the user sat in an app whose session was
gone. So the latch is released on a short timer. The timer is an inverse test
for an event the browser does not fire: if the navigation commits, the page is
torn down and the callback never observably runs; if it is refused, the page
survives, the callback fires, and the next 401 asks again.

Because the provider outlives the route a dialog is asking about, a prompt is
dropped whenever the location moves under it. Otherwise an unguarded redirect
arriving mid-dialog would leave a stranded dialog whose *Leave* replays a
destination from a page the user is no longer on. For the same reason only the
**first** held navigation is kept: a second one arriving while the dialog is
open would send the user somewhere they never clicked the moment they answer.

That drop is decided **during render**, by comparing the pathname the prompt
was raised on against the current one — not from a `useEffect` keyed on
`location`, for the ordering reason the provider already mirrors `location`
during render. React runs a child's effects before its parent's, so such an
effect also fires on the commit where a child effect *raised* the prompt, which
would wipe the dialog before the user saw it and drop that navigation in
silence. Comparing pathnames rather than whole locations also keeps an open
prompt alive across the same-page query rewrites the guard already exempts.

What the guard does not cover is browser **back/forward**. That arrives on the
history listener rather than through the navigator, which is exactly the part
`useBlocker` gets for free by living inside the router's own history
integration. `beforeunload` does not cover it either, so the honest claim is
the same one that guard makes: this narrows the window, it does not close it.

The dialog is the plain `ui/dialog`, not `ui/alert-dialog`, and the reason is
the bundle rather than the semantics: this provider is imported eagerly by
`App.tsx`, and `@radix-ui/react-alert-dialog` is deliberately split into the
deferred `vendor-ui-history` chunk (`vite.config.ts`) because the version-history
panel is its only consumer. Importing it here would put those bytes back on
every route's first paint. Lazy-loading the dialog instead was the other
option, and is the wrong one — it is needed exactly when the network is down.

### Sampling

There is **no polling**. `pending` is raised only by the `local-change` event,
and the checkpoint is read only at the end of a quiet window, to decide whether
that window may lower the state or must re-arm. A document nobody is editing
schedules no timer and asks the SDK nothing.

An earlier draft polled `hasLocalChanges()` on a 1s interval. Once the raise
became event-driven and the lower became sequence-based, the interval had
nothing left to observe.

#### Why a quiet window is needed on top

Even with the exact signal, the truth oscillates. A push is accepted within
milliseconds, so between two keystrokes there really is nothing outstanding,
and a chip that reported every transition faithfully would strobe between
`Saved` and `Saving…`. A smoke test of the docs editor found exactly that.

So:

- A `local-change` raises `pending` immediately and restarts a **2 s quiet
  window**.
- The window lowers `pending` only if, when it elapses, the user's last edit is
  *also* acknowledged. A quiet keyboard is not a flushed document: if the
  server still has the work, it re-arms and keeps waiting rather than reassure.

Continuous typing therefore holds one `Saving…` for the whole burst and
resolves to `Saved` about two seconds after the user actually stops. Remote
changes are excluded — somebody else's edit must not hold up this user's chip.

One attempt in between is worth recording, because it is the obvious fix and it
does not work: delaying only the "nothing outstanding" observation by 800 ms.
Nothing *re-raised* the state when the next keystroke arrived, because
keystrokes were not a signal at all, so it changed the rhythm of the flicker
without removing it. The problem was never the delay; it was the input.

This is also why `SyncSignals.pending` is not named `hasLocalChanges` —
conflating "the queue is empty" with "there is no outstanding work" is
precisely the bug.

The 2 s quiet window and the toast's 2 s debounce ([The transition
notice](#the-transition-notice)) are separate and differently motivated — one
decides what the chip *displays*, the other whether an interruption is
warranted at all.

### API shape

One hook, one component, both in `packages/frontend/src/components/`:

```ts
export type SyncState =
  | 'saved'
  | 'saving'
  | 'reconnecting'
  // Added by offline-local-persistence.md: pending work that is on this
  // device's disk. Replaces `not-saved` exactly when `durable` is true.
  | 'saved-locally'
  | 'not-saved';

/** Reads the ambient DocumentProvider. Must be called inside one. */
export function useSyncStatus(): {
  state: SyncState;
  /** Tells the two routes into `not-saved` apart: dropped, or rejected. */
  connected: boolean;
  /** A live read of the unsmoothed truth, for the unload guard. */
  hasUnsentEdits: () => boolean;
  /** When the currently-outstanding stretch of editing began; null when none. */
  pendingSince: Date | null;
};

export function SyncStatusChip(props: { className?: string }): JSX.Element;
```

The `saved` steady state is hidden below the `sm` breakpoint (`hidden sm:flex`
rather than a JS media query, so it costs no listener and no re-render) — the
mobile slides header does not lose room to a chip that says "everything is
fine". Every other state is shown at every width.

The toast and the `beforeunload` guard live in `SyncStatusChip`, not in
`useSyncStatus`, so that mounting the chip is what arms them and the hook stays
usable for plain display.

### The third consumer: reloads this app initiates

`hasUnsentEdits()` now has three arms, not two. The chunk-load recovery in
`lib/lazy-with-retry.ts` reloads the document to replace a module the browser
would not fetch, and **`beforeunload` is not a backstop for it**: the event is
unreliable for a programmatic reload and iOS — the platform the failure that
motivated the recovery came from — ignores it outright. So the chip also
registers the same live read into `lib/unsaved-work.ts`, a module-global probe
registry, and the recovery declines to reload while any probe answers yes. The
user keeps the page and their queue, and the fallback's button puts the reload
one deliberate click away.

The registry is deliberately not chip-specific. `app/documents/upload-queue.ts`
registers its own probe for the same reason: an upload in flight exists only in
this tab, since the bytes come from a `File` handle the browser hands over
once. A probe that throws counts as "yes" — the caller is deciding whether to
discard the page, and an unanswerable question is not permission.

One thing this does **not** mean: that an unmount loses the queue. A clean
unmount runs `@yorkie-js/react`'s cleanup, which calls `Client.detachDocument`,
and that sends a final change pack before detaching. A `location.reload()`
sends nothing. That asymmetry is the whole reason the guard is on the reload
and not on ordinary unmounting.

## Risks and Mitigation

**The chip could imply durability it does not have.** Now partly answered:
where the durability exists, the chip says so and means it, and where it does
not — every document without the opt-in, which remains the default — the
paragraph below still applies unchanged.

The largest risk is
copying Google's reassuring vocabulary onto a system with no local
persistence — a user told their work is "saved offline" who then reloads loses
it, and trusted the UI while doing so. Mitigated by wording that never claims
local storage: `Not saved`, and a tooltip that names the tab as the only copy.
This is also why the calm fourth state Google has does not exist here.

**Alarm fatigue on flaky connections.** A watch stream that flaps would
otherwise produce a toast per flap. Mitigated by the 2s debounce, by keying
severity on the user's own outstanding work (a reader sees only a muted
`Reconnecting…`), and by making recovery clear the notice automatically.

**`beforeunload` is unreliable by design.** Browsers ignore it without prior
user interaction, and it cannot stop a crash, a tab discard, or an OS restart.
It narrows the window; it does not close it. The real fix is offline
persistence, which is no longer a Non-Goal: see
[offline-local-persistence.md](offline-local-persistence.md). It closes the
window for documents that opt in, and leaves it exactly as described here for
those that do not.

**Browser back/forward is not guarded.** In-app navigation now is — see
[The navigation guard](#the-navigation-guard) — but only the half the app
initiates. A `POP` reaches the router through its history listener, below the
navigator the guard wraps, so the back button still unmounts a
`DocumentProvider` whose queue was never pushed. `beforeunload` does not fire
there either. Closing it means either migrating the app to a data router so
`useBlocker` can see `POP`, or a `popstate` handler that re-pushes the entry it
was asked to leave; both were judged out of proportion to the case, and this
stays a known limitation.

**A remount inside a live provider forgets what was pending.** The hook's
memory of "the user has edited" is per-mount. `SlidesLayout`
(`app/slides/slides-detail.tsx`) swaps between its mobile and desktop layouts
on a 768px viewport crossing *inside* one `DocumentProvider`, so crossing that
width while offline with unpushed edits drops the chip back to `Reconnecting…`
and disarms the guard until the next keystroke.

Seeding the new mount from `doc.getChangeID().getClientSeq()` was considered
and rejected: that counter includes presence, so it would reintroduce exactly
the confusion [Why not `hasLocalChanges()`](#why-not-haslocalchanges) removes —
a mount after a bare drag would report unsaved work. Correcting it properly
means lifting the pending state to the provider level, which is more machinery
than the window-resize-while-offline case justifies.

**Mount points that can drift.** Because the chip is opt-in, a new editor can
be written that simply never passes `syncStatus` — and nothing fails. The same
is true of a new shared document type that hand-rolls its own top bar instead
of using `SharedHeaderStatus`. Tests pin the two seams (the header renders the
chip only when asked; the shared status shows the chip for an editor and the
badge for a viewer), but neither can catch a call site that was never written.
This is the cost of the opt-in, accepted because the alternative crashes the
documents list.

**The hook can outlive the document it is measuring.** `DocumentProvider` keeps
one store for its whole lifetime and swaps `doc` in place rather than
remounting its children. The replacement starts at checkpoint 0, so a sequence
carried over from the previous document is permanently ahead of it — the chip
sticks on `Saving…` and any blip escalates it to a false `Not saved`. Every
per-document ref and piece of state is therefore reset on a `doc` change, and a
test drives the swap.

**A stranded warning that outlives its chip.** The warning toast is
`duration: Infinity` with no close button, and `<Toaster />` is mounted outside
the router — so an unmount that left it on screen would strand an
undismissable red notice on every other page for the rest of the session, with
no later recovery able to retract it (a fresh chip has no memory of having
warned). The chip dismisses on unmount for that reason.
