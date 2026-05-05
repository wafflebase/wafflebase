---
title: docs-peer-jump
target-version: 0.3.8
---

# Docs Peer Jump

## Summary

Let users click a collaborator's avatar in the docs SiteHeader to smoothly
scroll the editor so that peer's caret is visible. Mirrors the click-to-jump
UX that already exists for Sheets (`UserPresence.onSelectActiveCell`), but
adapts it to the docs data model: peer position is a `DocPosition`
(`blockId` + `offset`), and only the viewport scrolls — the local caret is
not moved.

This change also generalises the shared `UserPresence` component so it no
longer hard-codes the Sheets-specific cell address. After the change,
`UserPresence` only emits `onSelectPeer(clientID)` and asks the host page
for a tooltip hint via `getJumpHint(clientID)`. Sheets and Docs each wire
their own resolver. The Sheets behaviour is preserved unchanged.

## Goals / Non-Goals

### Goals

- Clicking a peer avatar in the docs header smooth-scrolls the editor so
  the peer's caret sits roughly one-third from the top of the viewport.
- Disable the click affordance when the peer has not broadcast a cursor
  position yet, or for the local user's own avatar.
- Briefly re-show the peer's name label after the jump so the user can
  confirm whose position they landed at.
- Generalise `UserPresence` so the component no longer carries
  Sheets-specific prop names. Sheets call sites keep working with no
  behavioural change.
- Reuse the existing `resolvePositionPixel` helper so this feature stays
  in lockstep with peer cursor rendering.

### Non-Goals

- Moving the local caret to the peer position (Sheets does this; in docs
  it would interrupt the local editor's typing flow).
- Off-screen indicators ("User X is on page 3"). The avatar tooltip
  already conveys whether a peer is jumpable.
- Following / camera-locked tracking of a peer over time. This is a
  one-shot navigation.
- A new EditorAPI for peers as first-class objects. The new editor
  method takes a generic `DocPosition`, not a `clientID`.
- Centralised `scrollToTopOneThird` helper shared with the find-bar
  jump (`editor.ts:1881-1889`). Two call sites is not enough to
  justify extraction; revisit once a third lands.

## Proposal Details

### 1. Architecture Overview

```text
[UserPresence avatar click]
        │
        ▼
onSelectPeer(clientID)              ← domain-agnostic event
        │
        ▼
DocsLayout (docs-detail.tsx)
        │
        ├─ doc.getOthersPresences() → DocsPresence for clientID
        │  → activeCursorPos { blockId, offset }
        │
        ├─ jumpHandle.jumpToPeer(clientID)   (exposed by DocsView)
        │     ├─ editor.scrollToPosition(pos)
        │     │     → resolvePositionPixel(...)
        │     │     → container.scrollTo({ top, behavior: 'smooth' })
        │     │
        │     └─ visiblePeerLabels.add(clientID) + reset 4s timer
        │           → editor.setPeerCursors(buildPeerCursors())
```

**Responsibility split:**

- `@wafflebase/docs` (editor package) — gains a domain-agnostic
  `scrollToPosition(pos: DocPosition)` API. Knows nothing about presence,
  clientID, or users. Same isolation principle that
  `docs-remote-cursor.md` already enforces.
- `frontend/components/user-presence.tsx` — knows nothing about the
  presence shape. Emits "peer X clicked" and asks the host for a
  jump-hint string.
- `frontend/app/docs/docs-view.tsx` and
  `frontend/app/docs/docs-detail.tsx` — glue layer that resolves
  `clientID → DocPosition` from presence and triggers the editor jump
  plus label flash.

### 2. UserPresence API Change

```ts
interface UserPresenceProps {
  className?: string;
  /** Invoked when a peer avatar is clicked. Avatars are non-clickable when omitted. */
  onSelectPeer?: (clientID: string) => void;
  /**
   * Returns a hint string describing where the click will jump to,
   * or undefined if the peer is not jumpable. Used both to gate the
   * click affordance and to populate the tooltip.
   */
  getJumpHint?: (clientID: string) => string | undefined;
}
```

The existing `onSelectActiveCell` prop is **removed**. The component no
longer references `UserPresenceType.activeCell` / `activeTabId`. The
`isCurrentUser` guard stays inside `UserPresence` so call sites do not
re-implement it.

**Click affordance gating:** an avatar is clickable iff
`onSelectPeer && getJumpHint(clientID) !== undefined && !isCurrentUser`.
The tooltip reads `Click to jump to {hint}` when clickable, and shows
just the username otherwise.

**Hint conventions:**

- Sheets — return `presence.activeCell` (e.g. `"A1"`).
- Docs — return the decoded `username` when `activeCursorPos` is set,
  otherwise `undefined`. Docs lacks a meaningful textual address for a
  caret position, so the username is the most informative hint.

### 3. Sheets Migration (No Behaviour Change)

Both Sheets call sites — `document-detail.tsx:513` and
`shared-document.tsx:107` — adopt the new prop shape.
`handleSelectPresenceCell` is renamed to `handleSelectPeer` and its
signature becomes `(clientID: string) => void`. The function body
performs a single extra lookup at the top:

```ts
const peer = doc.getOthersPresences().find((p) => p.clientID === clientID);
const activeCell = peer?.presence?.activeCell as Sref | undefined;
const peerActiveTabId = peer?.presence?.activeTabId as string | undefined;
if (!activeCell) return;
// ... existing tab-resolution + setPeerJumpTarget logic, unchanged
```

`getJumpHint` returns `presence.activeCell` directly. This is a pure
refactor — every existing Sheets behaviour (tab switch, peer-jump-target
state, cell selection) is preserved.

### 4. Editor API: `scrollToPosition`

Added to `EditorAPI` in `packages/docs/src/view/editor.ts`:

```ts
export interface EditorAPI {
  // ... existing methods
  /**
   * Smooth-scroll the viewport so the given document position sits
   * roughly one-third from the top of the visible area. Silent no-op
   * when the position cannot be resolved (e.g. stale blockId).
   */
  scrollToPosition(pos: DocPosition): void;
}
```

**Implementation:**

```ts
scrollToPosition: (pos: DocPosition) => {
  const pixel = resolvePositionPixel(
    pos, 'backward', paginatedLayout, layout, measurer, logicalCanvasWidth,
  );
  if (!pixel) return;

  const targetTop = pixel.y * scaleFactor - canvasHeight / 3;
  container.scrollTo({
    top: Math.max(0, targetTop),
    behavior: 'smooth',
  });
}
```

**Design notes:**

- Reuses `resolvePositionPixel` (`peer-cursor.ts:97`), which is already
  exercised by peer cursor rendering and Cmd+F result jumps. No new
  coordinate math.
- Default `lineAffinity` is `'backward'`, matching peer cursor rendering
  for visual consistency at line-wrap boundaries.
- `* scaleFactor` converts the logical Y returned by
  `resolvePositionPixel` to scaled (mobile zoom-to-fit) coordinates,
  the same way the find-bar jump does (`editor.ts:1881-1889`).
- `behavior: 'smooth'` honours `prefers-reduced-motion` automatically.
- Pagination is handled inside `resolvePositionPixel` itself — peers on
  later pages resolve to the correct absolute Y.

### 5. DocsView Wiring

`docs-view.tsx` already manages `peerLabelTimers`, `visiblePeerLabels`,
and `prevPeerCursorPos`. The jump handle is added there.

```ts
// exported from docs-view.tsx for DocsLayout to consume
export interface JumpHandle {
  jumpToPeer: (clientID: string) => void;
}

interface DocsViewProps {
  // ... existing props
  onJumpHandleReady?: (handle: JumpHandle | null) => void;
}
```

```ts
const jumpToPeer = useCallback((clientID: string) => {
  const store = storeRef.current;
  const editor = editorRef.current;
  if (!store || !editor) return;

  const peer = store.getPresences().find((p) => p.clientID === clientID);
  const pos = peer?.presence.activeCursorPos;
  if (!pos) return;

  editor.scrollToPosition(pos);

  // Reset / restart the 4-second label timer so the user can confirm
  // whose position they landed at.
  const existing = peerLabelTimers.current.get(clientID);
  if (existing) clearTimeout(existing);
  visiblePeerLabels.current.add(clientID);
  const timer = window.setTimeout(() => {
    visiblePeerLabels.current.delete(clientID);
    peerLabelTimers.current.delete(clientID);
    editorRef.current?.setPeerCursors(buildPeerCursors());
  }, LABEL_VISIBLE_DURATION);
  peerLabelTimers.current.set(clientID, timer);

  editor.setPeerCursors(buildPeerCursors());
}, [buildPeerCursors]);

useEffect(() => {
  if (onJumpHandleReady) onJumpHandleReady({ jumpToPeer });
  return () => onJumpHandleReady?.(null);
}, [onJumpHandleReady, jumpToPeer]);
```

### 6. DocsLayout Glue

`DocsLayout` already lives under `<DocumentProvider>` (see
`docs-detail.tsx:208`), so it can call `useDocument` directly to access
the Yorkie doc for presence lookups.

```tsx
const { doc } = useDocument<YorkieDocsRoot>();
const [jumpHandle, setJumpHandle] = useState<JumpHandle | null>(null);

const handleSelectPeer = useCallback((clientID: string) => {
  jumpHandle?.jumpToPeer(clientID);
}, [jumpHandle]);

const getJumpHint = useCallback((clientID: string) => {
  const peer = doc?.getOthersPresences().find((p) => p.clientID === clientID);
  if (!peer?.presence?.activeCursorPos) return undefined;
  const username = peer.presence.username;
  if (typeof username !== 'string') return 'cursor';
  try {
    return decodeURIComponent(username);
  } catch {
    return username;
  }
}, [doc]);

// JSX
<UserPresence onSelectPeer={handleSelectPeer} getJumpHint={getJumpHint} />
<DocsView
  onEditorReady={setEditor}
  onJumpHandleReady={setJumpHandle}
  documentId={documentId}
/>
```

### 7. Edge Cases

| Case | Behaviour |
|------|-----------|
| Peer has not broadcast `activeCursorPos` yet | `getJumpHint` returns `undefined` → avatar disabled, tooltip shows username only |
| Local user's own avatar | UserPresence's existing `isCurrentUser` guard disables it |
| Peer's `blockId` is stale (block was deleted) | `resolvePositionPixel` returns `undefined` → `scrollToPosition` is a silent no-op. Label flash still runs but the caret simply does not render until the peer moves |
| Peer is on a different page in zoom-to-fit | `pixel.y * scaleFactor` produces correct scaled scroll offset |
| Peer disconnects between hover and click | `getOthersPresences().find(...)` returns `undefined` → silent no-op |
| Same peer clicked rapidly | Each click resets the 4s timer; native `scrollTo` smoothly retargets |
| Peer position already in viewport | Still calls `scrollTo` — small or zero delta produces no visible jump |
| Read-only mode | Jump still works; viewing collaborators need navigation too |

### 8. Testing Strategy

**Unit:** `resolvePositionPixel` is already covered by peer cursor tests.
`scrollToPosition` itself is mostly DOM glue (`scrollTo`, scaled
coordinates) and is exercised through the manual checks below.

**Type / lint:** `pnpm verify:fast` catches the prop-rename ripple
through every Sheets call site.

**Manual verification checklist** (recorded in the task lessons file):

1. Two browsers open the same document. Peer scrolls to a far page and
   types — the local user sees the peer avatar in the SiteHeader.
2. Hovering the avatar shows `Click to jump to {username}`.
3. Clicking the avatar smooth-scrolls so the peer caret sits roughly
   one-third from the top of the viewport, and the peer label is
   visible for ~4 seconds afterwards.
4. Before the peer has clicked or typed, the avatar tooltip shows only
   the username and the avatar is non-clickable.
5. Clicking your own avatar does nothing.
6. Sheets regression: peer-jump in a multi-tab document still switches
   tabs and selects the peer's cell.
7. Mobile zoom-to-fit: peer-jump scrolls to the correct Y.

### 9. Files Changed

| File | Change |
|------|--------|
| `packages/docs/src/view/editor.ts` | Add `scrollToPosition(pos)` to `EditorAPI` and implement it |
| `packages/frontend/src/components/user-presence.tsx` | Replace `onSelectActiveCell` with `onSelectPeer` + `getJumpHint`; drop Sheets-specific types |
| `packages/frontend/src/app/documents/document-detail.tsx` | Migrate handler signature, add `getJumpHint`, update JSX |
| `packages/frontend/src/app/shared/shared-document.tsx` | Same migration as `document-detail.tsx` |
| `packages/frontend/src/app/docs/docs-view.tsx` | Add `jumpToPeer` callback and `onJumpHandleReady` prop |
| `packages/frontend/src/app/docs/docs-detail.tsx` | Wire `jumpHandle`, `handleSelectPeer`, `getJumpHint` into `<UserPresence>` and `<DocsView>` |
| `docs/design/docs/docs-peer-jump.md` | This document |
| `docs/design/README.md` | Add link to this document under the Docs section |

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Sheets peer-jump regression from prop rename | Migration is a pure rename + one extra `find` call. Manual regression check in PR plus type-checked prop rename across all call sites |
| `getJumpHint` looking up presence on every render | Peer count is small in practice; `find` over a short list is cheap. Memoise with `useCallback` so identity is stable |
| Stale `blockId` after peer deletes their block | `resolvePositionPixel` returns `undefined`; jump silently no-ops. Label flash is harmless |
| Mobile zoom-to-fit miscalculation | Reuse the same `* scaleFactor` pattern as the find-bar jump (`editor.ts:1881-1889`) |
| Smooth scroll feeling slow on long jumps | Browser native; honours `prefers-reduced-motion`. Revisit only if user feedback indicates it |
| New imperative handle pattern (`onJumpHandleReady`) becomes a junk drawer | Scoped to the jump operation only; if more imperative ops appear, refactor into a single editor-host context then |
