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
| Watch stream up/down | `doc.subscribe('connection', …)` → `StreamConnectionStatus.Connected \| Disconnected` | Whether the realtime channel is open. Also surfaced as the `useConnection()` hook. |
| Push/pull outcome | `doc.subscribe('sync', …)` → `DocSyncStatus.Synced \| SyncFailed` | The result of the last sync attempt. |
| **Unpushed edits** | `doc.hasLocalChanges()` | `localChanges.length > 0` — the queue of changes not yet accepted by the server. This is the durability bit the whole feature turns on. |

`hasLocalChanges()` is a getter, not an event. It is read on every
`connection`/`sync` event and on a low-frequency interval (see
[Sampling](#sampling)), never in a render path.

### The four states

The chip is a function of two booleans — connected, and hasLocalChanges — plus
a transient "a sync is in flight" bit:

| Connection | Local changes | Chip | Tone |
| --- | --- | --- | --- |
| Connected | none | `Saved` | muted |
| Connected | pending | `Saving…` | muted |
| Disconnected | none | `Reconnecting…` | muted |
| Disconnected | pending | **`Not saved`** | destructive |

Only the fourth state is loud, and only it arms the unload guard. That is the
whole point of keying on `hasLocalChanges()` rather than on connectivity: a
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
surface. Recovery dismisses it and shows a brief `Saved` confirmation, so a
blip that resolves itself does not leave a stale warning on screen.

Transitions are debounced (~2s) so that a single dropped frame of the watch
stream, which the SDK recovers from on its own, never produces a toast.

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

`hasLocalChanges()` is read:

- on every `connection` and `sync` document event, and
- on a 1s interval, but **only while disconnected or while local changes are
  pending** — a healthy connected document polls nothing.

The interval exists because the transition from "connected, queue draining" to
"connected, queue empty" is not always announced by an event the subscription
sees. 1s is well under the threshold where a status chip feels stale and far
above anything that costs measurable work: the call is a length check on an
array.

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
severity on `hasLocalChanges()` (a reader sees only a muted
`Reconnecting…`), and by making recovery clear the notice automatically.

**`beforeunload` is unreliable by design.** Browsers ignore it without prior
user interaction, and it cannot stop a crash, a tab discard, or an OS restart.
It narrows the window; it does not close it. The real fix is offline
persistence, listed as a Non-Goal and the natural follow-up to this document.

**Mount points that can drift.** Because the chip is opt-in, a new editor can
be written that simply never passes `syncStatus` — and nothing fails. The same
is true of a new shared document type that hand-rolls its own top bar instead
of using `SharedHeaderStatus`. Tests pin the two seams (the header renders the
chip only when asked; the shared status shows the chip for an editor and the
badge for a viewer), but neither can catch a call site that was never written.
This is the cost of the opt-in, accepted because the alternative crashes the
documents list.

**Polling in a hot path.** Reading `hasLocalChanges()` on a timer is cheap, but
a naive implementation that calls `setState` every tick would re-render the
header once a second during any disconnection. The hook must only set state
when the derived `SyncState` actually changes.
