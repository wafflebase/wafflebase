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
situation — the Yorkie JS SDK persists nothing locally — so this adopts the
warning half and states the risk plainly.

### Goals

- A document editor always shows whether its local edits have reached the
  server.
- A user who loses connectivity finds out **while it happens**, not by
  discovering missing work later.
- Closing a tab that holds unpushed edits requires a deliberate confirmation.
- One implementation covers sheets, docs, slides, notes, and board — no
  per-engine work beyond opting the shell in. PDF comments are excluded; see
  [Where it lives](#where-it-lives).

### Non-Goals

- **Offline persistence.** Making edits survive a reload would mean persisting
  Yorkie's local change queue to IndexedDB. That is a much larger change with
  its own correctness questions (reattach semantics, GC, epoch mismatch), and
  it is what would let the calm "saved to this device" wording become true.
  Deferred; this document only makes the current, non-durable behavior
  visible.
- **A user-facing offline mode toggle.** There is nothing to toggle until
  persistence exists.
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

### The four states

The chip is a function of two booleans — connected, and pending — plus
a transient "a sync is in flight" bit:

| Connection | Local changes | Chip | Tone |
| --- | --- | --- | --- |
| Connected | none | `Saved` | muted |
| Connected | pending | `Saving…` | muted |
| Disconnected | none | `Reconnecting…` | muted |
| Disconnected | pending | **`Not saved`** | destructive |

Only the fourth state is loud, and only it arms the unload guard. That is the
whole point of keying on outstanding work rather than on connectivity: a
user reading a document on a flaky train connection should not be alarmed, and
a user who has typed a paragraph into a dead socket should be.

The chip carries a tooltip that says what the state actually means. For
`Not saved`: *"Changes since <time> haven't reached the server. They exist only
in this tab — closing or reloading it will lose them."* The wording commits to
the real risk rather than the reassuring version.

`DocSyncStatus.SyncFailed` while still connected (a rejected push — auth
expiry, a removed document) also resolves to `Not saved`, since the outcome for
the user is identical. It is ignored once the queue has drained: a failed
*pull* costs the user none of their own edits, so reporting it would be alarm
with no consequence behind it.

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

Retraction and confirmation are **two different things**, and conflating them
hands out a false receipt. Leaving `Not saved` dismisses the warning
immediately — it is no longer true. But the confirmation waits for `Saved`,
because reconnecting moves the state to `Saving…`: the push has not been
attempted yet and can still be rejected. Saying *"your changes reached the
server"* at the moment the socket comes back would be a durability claim with
no evidence behind it, which is the one thing this feature must never do.

### The unload guard

Registered only while the state is `Not saved`, deregistered as soon as it is
not:

```ts
useEffect(() => {
  if (state !== 'not-saved') return;
  const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}, [state]);
```

There is no `beforeunload` handler anywhere in `packages/frontend/src` today,
so nothing conflicts. Conditional registration matters: a handler that is
always attached would prompt on every navigation away from a perfectly synced
document, which trains users to click through it.

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
export type SyncState = 'saved' | 'saving' | 'reconnecting' | 'not-saved';

/** Reads the ambient DocumentProvider. Must be called inside one. */
export function useSyncStatus(): {
  state: SyncState;
  /** When the oldest currently-unpushed change was made; null when saved. */
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

## Risks and Mitigation

**The chip could imply durability it does not have.** The largest risk is
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
persistence, listed as a Non-Goal and the natural follow-up to this document.

**In-app navigation is not guarded at all.** `beforeunload` covers closing the
tab and reloading. It does not fire for a route change, and every editor
renders `AppSidebar` inside its own shell — so one click on a sidebar link
unmounts the `DocumentProvider` and detaches a document whose queue was never
pushed, silently. This is the *more common* way to leave an editor, and it is
uncovered. Closing it means a router-level block (`useBlocker`) alongside the
unload guard; recorded here as a known limitation rather than left implied by
the Goals, which speak only of closing a tab.

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
