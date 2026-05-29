---
title: docs-presence
target-version: 0.3.8
---

# Docs Presence — Peer Cursors, Labels, and Avatar Jump

## Summary

Real-time presence in the collaborative docs editor: peer carets +
name labels rendered on the canvas, and click-to-jump from the
SiteHeader avatar to a collaborator's caret position. Both surfaces
share the same `peerLabelTimers` / `visiblePeerLabels` /
`buildPeerCursors` machinery in `DocsView`, so they ship and evolve
together.

The cursor + label surface shipped in v0.3.1 (Phase 1); the avatar
jump shipped in v0.3.8 and generalized the shared `UserPresence`
component so Sheets and Docs both flow through `onSelectPeer` /
`getJumpHint`. Remote selection highlight is Phase 2 (planned).

## Goals / Non-Goals

### Goals

- Display a colored caret at each peer's cursor position in the
  document.
- Show the peer's username as a label above the caret. Auto-show for
  ~4 seconds on movement; show on local hover within ~10 px of the
  caret.
- Work correctly with pagination — only render cursors on visible
  pages; skip off-screen positions.
- Reuse Sheets' color palette and label rendering patterns; reuse
  `resolvePositionPixel` for all `DocPosition → pixel` math so cursor,
  label, and jump stay in lockstep.
- Click a collaborator's avatar in the docs SiteHeader → smooth-scroll
  the editor so the peer's caret sits roughly one-third from the top
  of the viewport, and briefly re-show their name label so the user
  can confirm where they landed.
- Generalize `UserPresence` so it carries no domain-specific prop
  names; Sheets and Docs wire their own hint resolvers without
  re-implementing the `isCurrentUser` guard.

### Non-Goals

- Remote selection highlight (Phase 2).
- Avatar or profile picture in the label.
- Animated fade-in / fade-out transitions.
- Off-screen peer indicators ("User X is on page 3"). The avatar
  tooltip already conveys whether a peer is jumpable.
- Showing a label for the local user's own cursor or jumping to it.
- Moving the local caret to the peer position (Sheets does this; in
  docs it would interrupt the local editor's typing flow).
- Following / camera-locked tracking of a peer over time. Avatar click
  is a one-shot navigation.
- A new EditorAPI for peers as first-class objects — the editor's
  `scrollToPosition` takes a generic `DocPosition`, not a `clientID`.
- Centralized `scrollToTopOneThird` helper shared with the find-bar
  jump. Two call sites is not enough to justify extraction; revisit
  once a third lands.

## Proposal Details

### 1. Presence Type Separation

Sheets and docs use separate Yorkie documents (`sheet-{id}` /
`doc-{id}`), so their presence types are separate rather than a
shared union.

```ts
// Shared base — packages/frontend/src/types/users.ts (id, authProvider,
// username, email, photo).

// Sheets presence (existing)
type SheetPresence = {
  activeCell?: Sref;
  activeTabId?: string;
} & User;

// Docs presence (added in v0.3.1)
type DocsPresence = {
  activeCursorPos?: {
    blockId: string;
    offset: number;
  };
} & User;
```

No `activeDocId` filtering field is needed — each Yorkie document is
already scoped to a single document.

### 2. Presence Stays in the Frontend Layer

The `DocStore` interface in `packages/docs/src/store/store.ts` is
**free of presence concerns**. Presence is a collaboration feature
that belongs in the frontend integration layer, not the document
model.

- **`YorkieDocStore`** exposes presence methods directly (not through
  the `DocStore` interface) — it is already a frontend-layer class.
- **`MemDocStore`** is unaffected.
- Peer cursor data is passed into the editor's render method as a
  parameter, keeping `@wafflebase/docs` decoupled from user identity.

```ts
// packages/frontend/src/app/docs/yorkie-doc-store.ts
class YorkieDocStore implements DocStore {
  // DocStore methods (unchanged) ...

  // Presence — frontend-layer only, not on the DocStore interface
  updateCursorPos(pos: DocPosition | null): void {
    this.doc.update((_, p) =>
      p.set({ activeCursorPos: pos ?? undefined }),
    );
  }

  getPresences(): Array<{
    clientID: string;
    presence: DocsPresence;
  }> {
    return this.doc.getOthersPresences();
  }
}
```

### 3. PeerCursor Data Flow

```text
Yorkie others-changed event
  → DocsView subscribes directly to the Yorkie document
  → Updates label visibility state (timers, hover)
  → Passes PeerCursor[] to editor.setPeerCursors(...)
  → DocCanvas renders carets + labels
```

**`PeerCursor`** (defined in the docs package for rendering):

```ts
// packages/docs/src/view/types.ts
type PeerCursor = {
  position: DocPosition;
  color: string;
  username: string;
  labelVisible: boolean;   // controlled by DocsView visibility state
};
```

The docs package receives pre-processed rendering data and has no
knowledge of Yorkie, presence, or user identity systems.

### 4. Peer Cursor Rendering (`doc-canvas.ts`)

`DocCanvas.render()` receives an optional `peerCursors: PeerCursor[]`
parameter. After drawing the local cursor, it iterates over peer
cursors.

**Coordinate calculation** uses the shared `resolvePositionPixel`
helper (`packages/docs/src/view/peer-cursor.ts`), which converts any
`DocPosition { blockId, offset }` into pixel coordinates using
`layout` + `paginatedLayout`. The same helper backs the avatar jump
(§7) and the find-bar jump.

- Look up the block in the layout by `blockId`.
- Find the line containing `offset` and measure text width up to that
  offset.
- Apply pagination offset for the correct page.
- Skip rendering if the resulting position is outside the current
  viewport.

For remote cursors, `lineAffinity` is not in the presence payload.
Default to `'backward'`, which places the cursor at the end of the
previous visual line at wrap boundaries — a minor visual offset that
is acceptable for peer display.

**Caret style:**

| Property | Value |
| -------- | ----- |
| Width    | 2 px  |
| Height   | Same as line height at that position |
| Color    | Peer's assigned color (palette indexed by `clientID` hash) |

### 5. Peer Label Rendering

Drawn above the caret, following the Sheets `drawPeerLabel()` pattern.
Only rendered when `peerCursor.labelVisible` is `true`.

| Property      | Value                                          |
| ------------- | ---------------------------------------------- |
| Position      | Top of caret, offset upward                    |
| Background    | Peer cursor color (opaque)                     |
| Text color    | Dynamic — black or white via `getLabelTextColor()` based on background luminance |
| Font          | 11 px sans-serif                               |
| Padding       | 4 px horizontal, 2 px vertical                 |
| Content       | `username`, truncated with ellipsis at 120 px  |
| Max width     | 120 px                                         |

**Edge cases:**

- **Top boundary:** If caret is near the top of a page, flip the label
  below the caret.
- **Right boundary:** Clamp label x so it doesn't overflow the canvas
  width.
- **Multiple peers at same position:** Stack labels vertically, sorted
  by `clientID` for stable ordering.

### 6. Label Visibility State

Managed in `DocsView` (frontend layer), following the Sheets
`Worksheet` pattern. This state computes `labelVisible` for each
`PeerCursor` before passing it to the renderer, and is **also reused
by the avatar jump** in §7.

```ts
peerLabelTimers: Map<string, number>           // clientID → setTimeout id
prevPeerCursorPos: Map<string, DocPosition>    // previous position
hoveredPeerClientID: string | null
visiblePeerLabels: Set<string>                 // clientID set
```

**Trigger: peer cursor moves.** On each presence update, compare
current `activeCursorPos` with `prevPeerCursorPos`. If different:

1. Clear any existing timer for that peer.
2. Add to `visiblePeerLabels`.
3. Start ~4-second timer; on expiry remove from `visiblePeerLabels`
   and re-render.
4. Update `prevPeerCursorPos`.

**Trigger: local mouse hover.** In the mousemove handler, compute
pixel distance from mouse to each peer's caret position. If within a
10 px radius of the caret, set `hoveredPeerClientID` and show the
label. Clear when the mouse moves away.

**Label visible when:** peer is in `visiblePeerLabels` (active timer)
OR `hoveredPeerClientID === clientID`.

**Peer disconnects:** Remove from all maps/sets, clear associated
timer.

### 7. Avatar Jump

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

#### 7.1 Responsibility split

- **`@wafflebase/docs` (editor package)** — gains a domain-agnostic
  `scrollToPosition(pos: DocPosition)` API. Knows nothing about
  presence, clientID, or users. Same isolation principle as the
  cursor/label rendering above.
- **`frontend/components/user-presence.tsx`** — knows nothing about
  the presence shape. Emits "peer X clicked" and asks the host for a
  jump-hint string.
- **`frontend/app/docs/docs-view.tsx`** and
  **`frontend/app/docs/docs-detail.tsx`** — glue layer that resolves
  `clientID → DocPosition` from presence and triggers the editor jump
  plus label flash.

#### 7.2 `UserPresence` API

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

The legacy `onSelectActiveCell` prop is **removed**. The component no
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

#### 7.3 Sheets migration (no behavior change)

Both Sheets call sites — `document-detail.tsx` and
`shared-document.tsx` — adopt the new prop shape.
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

`getJumpHint` returns `presence.activeCell` directly. Pure refactor —
every existing Sheets behavior is preserved.

#### 7.4 Editor API: `scrollToPosition`

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

- Reuses `resolvePositionPixel`, already exercised by peer cursor
  rendering and Cmd+F result jumps. No new coordinate math.
- Default `lineAffinity` is `'backward'`, matching peer cursor
  rendering for visual consistency at line-wrap boundaries.
- `* scaleFactor` converts the logical Y returned by
  `resolvePositionPixel` to scaled (mobile zoom-to-fit) coordinates,
  the same way the find-bar jump does.
- `behavior: 'smooth'` honors `prefers-reduced-motion` automatically.
- Pagination is handled inside `resolvePositionPixel` itself — peers
  on later pages resolve to the correct absolute Y.

#### 7.5 `DocsView` wiring

`docs-view.tsx` already manages `peerLabelTimers`, `visiblePeerLabels`,
and `prevPeerCursorPos` (§6). The jump handle is added there.

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
```

#### 7.6 `DocsLayout` glue

`DocsLayout` lives under `<DocumentProvider>` so it can call
`useDocument` directly for presence lookups.

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

<UserPresence onSelectPeer={handleSelectPeer} getJumpHint={getJumpHint} />
<DocsView
  onEditorReady={setEditor}
  onJumpHandleReady={setJumpHandle}
  documentId={documentId}
/>
```

### 8. Presence Update & Re-rendering

**Local cursor → presence update:** When the user clicks, types, or
navigates (arrow keys, etc.) and the cursor position changes, call
`yorkieDocStore.updateCursorPos(pos)`. Throttle (~100 ms) to avoid
excessive updates during rapid typing.

**Remote presence → re-render:** `DocsView` subscribes directly to
the Yorkie document's `others-changed` event (not through `DocStore`).
On presence change, update label visibility state, build
`PeerCursor[]`, and trigger `editor.setPeerCursors(...)`. The existing
`store.onRemoteChange` callback handles document content changes
(already wired).

### 9. Pagination Handling

- Convert peer's `DocPosition` to pixel coordinates using paginated
  layout.
- If the peer's cursor falls on a page that is not currently visible
  in the viewport, skip rendering entirely.
- No off-screen indicator is shown.

### 10. Edge Cases

| Case | Behavior |
|------|----------|
| Peer has not broadcast `activeCursorPos` yet | `getJumpHint` returns `undefined` → avatar disabled, tooltip shows username only; no caret rendered |
| Local user's own avatar | `UserPresence`'s `isCurrentUser` guard disables it |
| Peer's `blockId` is stale (block was deleted) | `resolvePositionPixel` returns `undefined` → `scrollToPosition` is a silent no-op; caret render also silently skipped |
| Peer is on a different page in zoom-to-fit | `pixel.y * scaleFactor` produces correct scaled scroll offset |
| Peer disconnects between hover and click | `getOthersPresences().find(...)` returns `undefined` → silent no-op |
| Same peer clicked rapidly | Each click resets the 4 s timer; native `scrollTo` smoothly retargets |
| Peer position already in viewport | Still calls `scrollTo` — small or zero delta produces no visible jump |
| Read-only mode | Jump still works; viewing collaborators need navigation too |
| Pagination edge: cursor between pages | Use layout position to determine page; skip if not visible |
| Line-wrap affinity inaccuracy for remote cursors | Default to `'backward'`; minor visual offset acceptable |
| Rapid cursor movement causes presence spam | Throttle `updateCursorPos()` at ~100 ms |
| Long usernames overflow | Truncate at 120 px with ellipsis |
| Timer leaks on rapid movement | Clear previous timer before starting a new one |

### 11. Testing Strategy

**Unit:**

- Coordinate calculation: verify `DocPosition` → pixel mapping for
  various block/offset combinations, including line wraps and
  pagination boundaries.
- Label visibility state: verify timer-based show/hide, hover trigger,
  peer disconnect cleanup.
- Label rendering: verify text truncation, edge-case clamping
  (top/right boundary), multi-peer stacking.

**Type / lint:** `pnpm verify:fast` catches the `UserPresence`
prop-rename ripple through every Sheets call site.

**Integration:** verify presence update flow — cursor move →
`updateCursorPos()` → presence change event → peer cursor rendered;
avatar click → peer caret scrolled into view.

**Manual verification (avatar jump):**

1. Two browsers open the same document. Peer scrolls to a far page
   and types — the local user sees the peer avatar in the SiteHeader.
2. Hovering the avatar shows `Click to jump to {username}`.
3. Clicking the avatar smooth-scrolls so the peer caret sits roughly
   one-third from the top of the viewport, and the peer label is
   visible for ~4 seconds afterwards.
4. Before the peer has clicked or typed, the avatar tooltip shows
   only the username and the avatar is non-clickable.
5. Clicking your own avatar does nothing.
6. Sheets regression: peer-jump in a multi-tab document still
   switches tabs and selects the peer's cell.
7. Mobile zoom-to-fit: peer-jump scrolls to the correct Y.

### 12. Files

| File | Role |
|------|------|
| `packages/frontend/src/types/users.ts` | `DocsPresence` type |
| `packages/docs/src/view/doc-canvas.ts` | Render `PeerCursor[]` carets + labels |
| `packages/docs/src/view/peer-cursor.ts` | `resolvePositionPixel` helper |
| `packages/docs/src/view/cursor.ts` | Shared coordinate calculation utility |
| `packages/docs/src/view/editor.ts` | `scrollToPosition(pos)` on `EditorAPI` |
| `packages/frontend/src/components/user-presence.tsx` | Domain-agnostic `onSelectPeer` / `getJumpHint` |
| `packages/frontend/src/app/docs/yorkie-doc-store.ts` | `updateCursorPos()`, `getPresences()` |
| `packages/frontend/src/app/docs/docs-view.tsx` | Presence subscription, label state, hover, `jumpToPeer` |
| `packages/frontend/src/app/docs/docs-detail.tsx` | `handleSelectPeer`, `getJumpHint`, wires `<UserPresence>` and `<DocsView>` |
| `packages/frontend/src/app/documents/document-detail.tsx` | Sheets `UserPresence` migration |
| `packages/frontend/src/app/shared/shared-document.tsx` | Sheets `UserPresence` migration |

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| Label overlaps document text | Transient display (4 s) + hover-only |
| Invalid `blockId` from stale presence | Guard: skip rendering if block not found in layout; `scrollToPosition` silently no-ops |
| Rapid cursor movement causes presence spam | Throttle `updateCursorPos()` at ~100 ms |
| Performance with many peers | Only compute/render for visible viewport; peer count typically small |
| Long usernames overflow | Truncate at 120 px with ellipsis |
| Timer leaks on rapid movement | Clear previous timer before starting new one |
| Pagination edge: cursor between pages | Use layout position to determine page; skip if not visible |
| Line-wrap affinity inaccuracy for remote cursors | Default to `'backward'`; minor visual offset acceptable for peer display |
| Sheets peer-jump regression from `UserPresence` prop rename | Migration is a pure rename + one extra `find` call. Type-checked rename across all call sites; manual Sheets regression check |
| `getJumpHint` looking up presence on every render | Peer count is small; `find` over a short list is cheap. Memoize with `useCallback` so identity is stable |
| Mobile zoom-to-fit miscalculation | Reuse the same `* scaleFactor` pattern as the find-bar jump |
| Smooth scroll feeling slow on long jumps | Browser native; honors `prefers-reduced-motion`. Revisit only on user feedback |
| `onJumpHandleReady` pattern becomes a junk drawer | Scoped to the jump operation only; if more imperative ops appear, refactor into a single editor-host context then |
