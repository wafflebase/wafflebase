# Docs Peer Jump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make a peer's avatar in the docs SiteHeader clickable so the editor smooth-scrolls to that collaborator's caret position.

**Architecture:** Generalise the shared `UserPresence` component to emit a domain-agnostic `onSelectPeer(clientID)` event. Add a domain-agnostic `scrollToPosition(pos: DocPosition)` to the docs `EditorAPI`. Glue them together in `DocsLayout`/`DocsView` by reading the peer's `activeCursorPos` from Yorkie presence. Sheets call sites get a pure refactor — no behavioural change.

**Tech Stack:** TypeScript, React 19, NestJS-adjacent monorepo (pnpm), Vitest, Yorkie CRDT, custom Canvas docs editor (`@wafflebase/docs`).

**Spec:** `docs/design/docs/docs-peer-jump.md`

**Why bite-sized tasks here, not TDD?** The whole stack is DOM/canvas-bound — `container.scrollTo`, `getBoundingClientRect`, peer presence over WebSocket — and the frontend package has no React Testing Library setup. Each task instead leans on `pnpm verify:fast` (TypeScript + ESLint + unit tests) for regressions and finishes with a manual two-browser smoke check at the end.

---

## File Map

| File | Role in this plan |
|------|-------------------|
| `packages/docs/src/view/editor.ts` | Add `scrollToPosition(pos)` to `EditorAPI` interface and implement it |
| `packages/frontend/src/components/user-presence.tsx` | Replace `onSelectActiveCell` with `onSelectPeer` + `getJumpHint`. Domain-agnostic |
| `packages/frontend/src/app/documents/document-detail.tsx` | Migrate Sheets call site to new API (pure refactor) |
| `packages/frontend/src/app/shared/shared-document.tsx` | Migrate Sheets call site in `SharedDocumentLayout` (pure refactor). `SharedDocsLayout` already passes no props — leave it |
| `packages/frontend/src/app/docs/docs-view.tsx` | Add `JumpHandle` type, `jumpToPeer` callback, `onJumpHandleReady` prop |
| `packages/frontend/src/app/docs/docs-detail.tsx` | Wire `useDocument`, `jumpHandle` state, `handleSelectPeer`, `getJumpHint` to `<UserPresence>` and `<DocsView>` |

---

## Task 1: Add `scrollToPosition` to EditorAPI

**Files:**
- Modify: `packages/docs/src/view/editor.ts`

This task is independent — it ships a new editor capability with no consumers yet. After this commit, both `paint()` continues to work and a new method exists for callers.

- [x] **Step 1: Extend the `EditorAPI` interface**

In `packages/docs/src/view/editor.ts`, find the `setPeerCursors` declaration in the `EditorAPI` interface (currently around line 56) and add the new method **directly after it**:

```ts
  /** Update peer cursor data and re-render */
  setPeerCursors(cursors: PeerCursor[]): void;
  /**
   * Smooth-scroll the viewport so the given document position sits
   * roughly one-third from the top of the visible area. Silent no-op
   * when the position cannot be resolved (e.g. stale blockId) or
   * before the first paint() has run.
   */
  scrollToPosition(pos: DocPosition): void;
```

- [x] **Step 2: Cache `canvasHeight` and `logicalCanvasWidth` in closure scope**

`paint()` computes these per-render but keeps them as locals. `scrollToPosition` needs them outside the render pipeline. Promote them to closure-scoped state.

In `initialize()`, near the other `let` declarations (currently around line 476 where `let scaleFactor = 1;` lives), add:

```ts
  let scaleFactor = 1;
  let lastCanvasHeight = 0;
  let lastLogicalCanvasWidth = 0;
```

Then in `paint()`, find the existing `const canvasHeight = height - rulerSize;` (around line 684) and the `const logicalCanvasWidth = ...` (around line 690). Right after each, add an assignment to the closure-cached copy:

```ts
    const canvasHeight = height - rulerSize;
    lastCanvasHeight = canvasHeight;
    docCanvas.resize(canvasWidth, canvasHeight);
```

```ts
    // Logical canvas width in unscaled document coordinates
    const logicalCanvasWidth = scaleFactor < 1 ? canvasWidth / scaleFactor : canvasWidth;
    lastLogicalCanvasWidth = logicalCanvasWidth;
```

- [x] **Step 3: Implement `scrollToPosition` in the returned API object**

Find the returned object literal of `initialize()` and the `setPeerCursors` implementation in it (currently around line 1661). Add `scrollToPosition` directly after it:

```ts
    setPeerCursors: (cursors: PeerCursor[]) => {
      // ... existing impl ...
    },
    scrollToPosition: (pos: DocPosition) => {
      if (lastLogicalCanvasWidth === 0 || lastCanvasHeight === 0) return;
      const pixel = resolvePositionPixel(
        pos,
        'backward',
        paginatedLayout,
        layout,
        measurer,
        lastLogicalCanvasWidth,
      );
      if (!pixel) return;

      const targetTop = pixel.y * scaleFactor - lastCanvasHeight / 3;
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });
    },
    getPeerCursorPixels: () => lastPeerPixels,
```

`resolvePositionPixel` and `DocPosition` are already imported at the top of the file (lines 14 and 18). No new imports needed.

- [x] **Step 4: Run verify**

```bash
pnpm verify:fast
```

Expected: PASS. (Lint + typecheck + unit tests in sheets/docs packages.)

If lint/typecheck fails, the most likely cause is a missing comma in the API object literal or a stray `let` placement. Read the failure and fix.

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/view/editor.ts
git commit -m "$(cat <<'EOF'
Add scrollToPosition to docs EditorAPI

Domain-agnostic helper that smooth-scrolls the viewport so a given
DocPosition appears roughly one-third from the top. Reuses the
existing resolvePositionPixel helper that backs peer cursor rendering
and Cmd+F result jumps. Silent no-op before the first paint or when
the blockId is stale.

Caches canvasHeight and logicalCanvasWidth in initialize() closure
scope so the new method can read them outside the render pipeline.

EOF
)"
```

---

## Task 2: Refactor UserPresence + migrate Sheets call sites

**Files:**
- Modify: `packages/frontend/src/components/user-presence.tsx`
- Modify: `packages/frontend/src/app/documents/document-detail.tsx`
- Modify: `packages/frontend/src/app/shared/shared-document.tsx`

This task **must** ship as a single commit because the prop rename ripples through all three files and `pnpm verify:fast` runs the TypeScript checker repo-wide.

- [x] **Step 1: Rewrite `user-presence.tsx` with the new prop signature**

Replace the entire file `packages/frontend/src/components/user-presence.tsx` with:

```tsx
import { useDocument, usePresences } from "@yorkie-js/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getPeerCursorColor } from "@wafflebase/sheets";
import { useTheme } from "@/components/theme-provider";

interface UserPresenceProps {
  className?: string;
  /**
   * Invoked when a peer avatar is clicked. Avatars are non-clickable
   * when this callback is omitted.
   */
  onSelectPeer?: (clientID: string) => void;
  /**
   * Returns a hint string describing where the click will jump to,
   * or undefined if the peer is not jumpable. Used both to gate the
   * click affordance and to populate the tooltip text.
   */
  getJumpHint?: (clientID: string) => string | undefined;
}

/**
 * Renders the UserPresence component.
 */
export function UserPresence({
  className,
  onSelectPeer,
  getJumpHint,
}: UserPresenceProps) {
  const { doc } = useDocument<Record<string, unknown>, Record<string, unknown>>();
  const presences = usePresences<Record<string, unknown>>();
  const { resolvedTheme } = useTheme();
  const otherClientIDs = new Set(
    doc?.getOthersPresences().map((presence) => presence.clientID) || [],
  );
  const currentClientID = presences.find(
    (presence) => !otherClientIDs.has(presence.clientID),
  )?.clientID;
  const users = presences
    .map((presenceData) => {
      const username = ((presenceData.presence?.username as string) || "").trim();
      const photo = presenceData.presence?.photo as string | undefined;
      const isCurrentUser = presenceData.clientID === currentClientID;

      return {
        clientID: presenceData.clientID,
        username: username || "Anonymous",
        photo,
        isCurrentUser,
      };
    })
    .filter((user) => user.username.length > 0);

  const visibleCount = 4;
  const visibleUsers = users.slice(0, visibleCount);
  const hiddenUsers = users.slice(visibleCount);
  const totalUsers = users.length;

  const renderAvatar = (user: (typeof users)[number]) => {
    const hint = !user.isCurrentUser && getJumpHint
      ? getJumpHint(user.clientID)
      : undefined;
    const canJump = !!onSelectPeer && hint !== undefined && !user.isCurrentUser;

    return (
      <Tooltip key={user.clientID}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="relative cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
            onClick={() => {
              if (!canJump) return;
              onSelectPeer!(user.clientID);
            }}
            disabled={!canJump}
          >
            <Avatar
              className="h-8 w-8 border-2 bg-background"
              style={{
                borderColor: user.isCurrentUser
                  ? undefined
                  : getPeerCursorColor(resolvedTheme, user.clientID),
              }}
            >
              {user.photo && <AvatarImage src={user.photo} alt={user.username} />}
              <AvatarFallback className="text-xs">
                {user.username.slice(0, 2).toUpperCase() || "??"}
              </AvatarFallback>
            </Avatar>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {user.username}
            {user.isCurrentUser ? " (You)" : ""}
          </p>
          {canJump && hint && <p>Click to jump to {hint}</p>}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className={`flex items-center gap-2 min-h-[2.5rem] ${className}`}>
      {totalUsers > 0 ? (
        <>
          <div className="flex items-center -space-x-2">
            {visibleUsers.map(renderAvatar)}

            {hiddenUsers.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium"
                    aria-label={`${hiddenUsers.length} more users`}
                  >
                    +{hiddenUsers.length}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>More users</DropdownMenuLabel>
                  {hiddenUsers.map((user) => {
                    const hint = !user.isCurrentUser && getJumpHint
                      ? getJumpHint(user.clientID)
                      : undefined;
                    const canJump =
                      !!onSelectPeer && hint !== undefined && !user.isCurrentUser;
                    return (
                      <DropdownMenuItem
                        key={user.clientID}
                        className={canJump ? "cursor-pointer" : undefined}
                        onSelect={() => {
                          if (!canJump) return;
                          onSelectPeer!(user.clientID);
                        }}
                      >
                        <Avatar
                          className="h-6 w-6 border-2"
                          style={{
                            borderColor: user.isCurrentUser
                              ? undefined
                              : getPeerCursorColor(resolvedTheme, user.clientID),
                          }}
                        >
                          {user.photo && (
                            <AvatarImage src={user.photo} alt={user.username} />
                          )}
                          <AvatarFallback className="text-[10px]">
                            {user.username.slice(0, 2).toUpperCase() || "??"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate">
                            {user.username}
                            {user.isCurrentUser ? " (You)" : ""}
                          </p>
                          {hint && (
                            <p className="truncate text-xs text-muted-foreground">
                              {canJump ? `Jump: ${hint}` : hint}
                            </p>
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </>
      ) : (
        <div className="w-32 opacity-0" />
      )}
    </div>
  );
}
```

Notes:
- The component no longer imports `UserPresence as UserPresenceType` from `@/types/users`. It is now domain-agnostic.
- The `useDocument` and `usePresences` generics are unbound (`Record<string, unknown>`) because the component only accesses `username` / `photo`, and the host page is responsible for any presence-shape-specific work via `getJumpHint`.

- [x] **Step 2: Migrate `document-detail.tsx`**

In `packages/frontend/src/app/documents/document-detail.tsx`, find `handleSelectPresenceCell` (currently at line 449) and replace it with a `handleSelectPeer(clientID)` that does the same work after a presence lookup:

```ts
  const handleSelectPeer = useCallback(
    (clientID: string) => {
      if (!doc) return;
      const peer = doc
        .getOthersPresences()
        .find((p) => p.clientID === clientID);
      const activeCell = peer?.presence?.activeCell as
        | NonNullable<UserPresenceType["activeCell"]>
        | undefined;
      const peerActiveTabId = peer?.presence?.activeTabId as
        | UserPresenceType["activeTabId"]
        | undefined;
      if (!activeCell) return;

      const root = doc.getRoot();
      const activeTab = peerActiveTabId ? root.tabs[peerActiveTabId] : undefined;
      let targetTabId: string | undefined;
      if (activeTab?.type === "sheet") {
        targetTabId = peerActiveTabId;
      } else {
        const currentTab = activeTabId ? root.tabs[activeTabId] : undefined;
        if (currentTab?.type === "sheet") {
          targetTabId = activeTabId;
        } else {
          targetTabId = root.tabOrder.find(
            (id: string) => root.tabs[id]?.type === "sheet",
          );
        }
      }
      if (!targetTabId) return;

      if (targetTabId !== activeTabId) {
        setActiveTabId(targetTabId);
      }
      jumpRequestSeq.current += 1;
      setPeerJumpTarget({
        activeCell,
        targetTabId,
        requestId: jumpRequestSeq.current,
      });
    },
    [doc, activeTabId],
  );

  const getJumpHint = useCallback(
    (clientID: string) => {
      const peer = doc
        ?.getOthersPresences()
        .find((p) => p.clientID === clientID);
      const activeCell = peer?.presence?.activeCell as string | undefined;
      return activeCell;
    },
    [doc],
  );
```

Then update the JSX (currently around line 513):

```tsx
            <UserPresence onSelectPeer={handleSelectPeer} getJumpHint={getJumpHint} />
```

The `import type { UserPresence as UserPresenceType } from "@/types/users";` import should remain — it's still used for `PeerJumpTarget` typing further up the file.

- [x] **Step 3: Migrate `shared-document.tsx`**

In `packages/frontend/src/app/shared/shared-document.tsx`, find `handleSelectPresenceCell` in `SharedDocumentLayout` (currently at line 54) and replace it with the same migration pattern:

```ts
  const handleSelectPeer = useCallback(
    (clientID: string) => {
      if (!doc) return;
      const peer = doc
        .getOthersPresences()
        .find((p) => p.clientID === clientID);
      const activeCell = peer?.presence?.activeCell as
        | NonNullable<UserPresenceType["activeCell"]>
        | undefined;
      const peerActiveTabId = peer?.presence?.activeTabId as
        | UserPresenceType["activeTabId"]
        | undefined;
      if (!activeCell) return;

      if (peerActiveTabId && peerActiveTabId !== activeTabId) {
        setActiveTabId(peerActiveTabId);
      }

      jumpRequestSeq.current += 1;
      setPeerJumpTarget({
        activeCell,
        targetTabId: peerActiveTabId,
        requestId: jumpRequestSeq.current,
      });
    },
    [doc, activeTabId],
  );

  const getJumpHint = useCallback(
    (clientID: string) => {
      const peer = doc
        ?.getOthersPresences()
        .find((p) => p.clientID === clientID);
      const activeCell = peer?.presence?.activeCell as string | undefined;
      return activeCell;
    },
    [doc],
  );
```

Update the JSX (currently around line 107):

```tsx
        <UserPresence onSelectPeer={handleSelectPeer} getJumpHint={getJumpHint} />
```

`SharedDocsLayout` (line 144) uses `<UserPresence />` with no props — leave it alone. Both new props are optional, so it remains valid.

- [x] **Step 4: Run verify**

```bash
pnpm verify:fast
```

Expected: PASS. The TypeScript check exercises every call site of `UserPresence` and the renamed handlers. If you see "Property 'onSelectActiveCell' does not exist", you missed a call site — search the repo for `onSelectActiveCell` and migrate.

- [x] **Step 5: Manual smoke test (Sheets regression)**

Start the dev environment:

```bash
docker compose up -d
pnpm dev
```

Open `http://localhost:5173` in two browser windows (e.g. Chrome + Chrome incognito). Sign in with two different accounts, open the same multi-tab spreadsheet, and:

1. In window A, select cell B5 in tab "Sheet 2".
2. In window B (currently in tab "Sheet 1"), hover the peer avatar in the top right. Tooltip should show "Click to jump to B5".
3. Click the avatar in window B. Expected: tab switches to "Sheet 2" and B5 becomes the active cell.
4. Click the same peer in the `+N` overflow menu (open four browsers if needed to force overflow). Same result.

If anything regresses, **stop and diagnose** — do not proceed.

- [x] **Step 6: Commit**

```bash
git add packages/frontend/src/components/user-presence.tsx \
        packages/frontend/src/app/documents/document-detail.tsx \
        packages/frontend/src/app/shared/shared-document.tsx
git commit -m "$(cat <<'EOF'
Generalise UserPresence to onSelectPeer + getJumpHint

UserPresence no longer knows about Sheets-specific activeCell. The
component now emits a domain-agnostic onSelectPeer(clientID) event
and asks the host for a tooltip hint via getJumpHint(clientID). This
is the precondition for wiring docs peer-jump in a follow-up commit.

Sheets call sites in document-detail.tsx and shared-document.tsx are
migrated to the new API. Each picks up the click, looks up the peer
in Yorkie presence, and runs the same tab-resolution + peer-jump-
target logic as before. Pure refactor — no behavioural change.

EOF
)"
```

---

## Task 3: Add `JumpHandle` to DocsView

**Files:**
- Modify: `packages/frontend/src/app/docs/docs-view.tsx`

This task lands the imperative jump entrypoint inside DocsView (where peer-label state already lives) and exposes it via a new `onJumpHandleReady` prop. No external consumer wires it up yet — that's Task 4.

- [x] **Step 1: Export the `JumpHandle` interface**

In `packages/frontend/src/app/docs/docs-view.tsx`, near the top of the file (under the existing `import` block, before the helpers), add:

```ts
export interface JumpHandle {
  jumpToPeer: (clientID: string) => void;
}
```

- [x] **Step 2: Extend `DocsViewProps`**

Find `interface DocsViewProps` (currently around line 70) and add an optional `onJumpHandleReady` prop:

```ts
interface DocsViewProps {
  onEditorReady?: (editor: EditorAPI | null) => void;
  /**
   * Optional handle exposing imperative actions (peer-jump, scroll).
   * The DocsView calls this with a handle on mount and `null` on unmount.
   */
  onJumpHandleReady?: (handle: JumpHandle | null) => void;
  readOnly?: boolean;
  documentId?: string;
}
```

Update the destructured props in the function signature to add `onJumpHandleReady`:

```ts
export function DocsView({
  onEditorReady,
  onJumpHandleReady,
  readOnly,
  documentId,
}: DocsViewProps) {
```

- [x] **Step 3: Add the `jumpToPeer` callback**

Find the existing `buildPeerCursors` definition in `DocsView` (around line 120) and add `jumpToPeer` immediately after it. It uses the same refs (`storeRef`, `editorRef`, `peerLabelTimers`, `visiblePeerLabels`) that `handlePresenceChange` already touches:

```ts
  const jumpToPeer = useCallback((clientID: string) => {
    const store = storeRef.current;
    const editor = editorRef.current;
    if (!store || !editor) return;

    const peer = store.getPresences().find((p) => p.clientID === clientID);
    const pos = peer?.presence.activeCursorPos;
    if (!pos) return;

    editor.scrollToPosition(pos);

    // Reset and restart the label visibility timer so the user can
    // confirm whose position they landed at.
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

- [x] **Step 4: Expose the handle via the prop**

Add a `useEffect` after `jumpToPeer` that publishes the handle:

```ts
  useEffect(() => {
    if (!onJumpHandleReady) return;
    onJumpHandleReady({ jumpToPeer });
    return () => {
      onJumpHandleReady(null);
    };
  }, [onJumpHandleReady, jumpToPeer]);
```

- [x] **Step 5: Run verify**

```bash
pnpm verify:fast
```

Expected: PASS. Common pitfalls:
- `scrollToPosition` not on `EditorAPI` → Task 1 didn't ship; rebase or fix.
- `peer.presence.activeCursorPos` typed as `unknown` → confirm the existing presence-typed read above (line 161 in current code) still works; the YorkieDocStore's `getPresences()` returns the typed shape.

- [x] **Step 6: Commit**

```bash
git add packages/frontend/src/app/docs/docs-view.tsx
git commit -m "$(cat <<'EOF'
Expose JumpHandle from DocsView for peer-jump

DocsView gains a jumpToPeer(clientID) callback that resolves the
peer's activeCursorPos from Yorkie presence and asks the editor to
scrollToPosition there. Also resets the 4-second peer-label timer so
the username briefly re-appears at the landing position.

The handle is published via a new optional onJumpHandleReady prop;
no consumer wires it up in this commit.

EOF
)"
```

---

## Task 4: Wire DocsLayout to consume the handle

**Files:**
- Modify: `packages/frontend/src/app/docs/docs-detail.tsx`

This task connects everything: DocsLayout reads the doc, builds `getJumpHint`, holds the `JumpHandle`, and forwards clicks from `<UserPresence>` to `editor.scrollToPosition`.

- [x] **Step 1: Add new imports**

At the top of `packages/frontend/src/app/docs/docs-detail.tsx`, extend the imports. Replace the existing `useDocument`-free top section so the imports include:

```ts
import { DocumentProvider, useDocument } from "@yorkie-js/react";
```

(Currently the import is `import { DocumentProvider } from "@yorkie-js/react";` — extend it.)

Add at the top with the other type imports:

```ts
import type { DocsPresence } from "@/types/users";
import { DocsView, type EditorAPI, type JumpHandle } from "./docs-view";
```

(Replace the existing `import { DocsView, type EditorAPI } from "./docs-view";` with the version that also imports `JumpHandle`.)

- [x] **Step 2: Add state, jump handler, and hint helper inside `DocsLayout`**

In `DocsLayout` (currently starts at line 36), under the existing hooks (`usePresenceUpdater()`, the `editor` state, the `editContext` state), add:

```ts
  const { doc } = useDocument<YorkieDocsRoot, DocsPresence>();
  const [jumpHandle, setJumpHandle] = useState<JumpHandle | null>(null);

  const handleSelectPeer = useCallback(
    (clientID: string) => {
      jumpHandle?.jumpToPeer(clientID);
    },
    [jumpHandle],
  );

  const getJumpHint = useCallback(
    (clientID: string) => {
      const peer = doc
        ?.getOthersPresences()
        .find((p) => p.clientID === clientID);
      if (!peer?.presence?.activeCursorPos) return undefined;
      const username = peer.presence.username;
      if (typeof username !== "string" || !username) return "cursor";
      try {
        return decodeURIComponent(username);
      } catch {
        return username;
      }
    },
    [doc],
  );
```

- [x] **Step 3: Pass new props to `<UserPresence>` and `<DocsView>`**

Find the JSX (currently around line 162) and update both:

```tsx
            <ShareDialog documentId={documentId} />
            <UserPresence
              onSelectPeer={handleSelectPeer}
              getJumpHint={getJumpHint}
            />
```

```tsx
          <DocsView
            onEditorReady={setEditor}
            onJumpHandleReady={setJumpHandle}
            documentId={documentId}
          />
```

- [x] **Step 4: Run verify**

```bash
pnpm verify:fast
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/docs/docs-detail.tsx
git commit -m "$(cat <<'EOF'
Wire docs peer-jump in DocsLayout

DocsLayout now holds a JumpHandle from DocsView and forwards peer
avatar clicks through it. getJumpHint reads the peer's username from
DocsPresence and gates the click affordance on activeCursorPos being
present. Only the viewport scrolls — the local caret is unaffected.

EOF
)"
```

---

## Task 5: Manual verification + close out

**Files:**
- Create: `docs/tasks/active/20260505-docs-peer-jump-lessons.md`

This task is the verification gate before marking the work complete. The CLAUDE.md workflow requires `pnpm verify:fast` plus manual evidence for UI features.

- [x] **Step 1: End-to-end manual verification**

With `pnpm dev` running and two browsers (window A and window B) signed in as different users on the same docs document:

1. **Hover hint.** In window A, click into page 5 of a long document and type a character. In window B, hover the peer avatar in the SiteHeader. Tooltip reads `Click to jump to {username-of-A}`.
2. **Click jumps.** Click the avatar. Window B smoothly scrolls so window A's caret sits roughly one-third from the top of the viewport. The peer label is visible for ~4 seconds at the landing position.
3. **No caret hijack.** Window B's local caret stays where it was (e.g. page 1) — confirm by typing immediately after the scroll completes.
4. **Disabled before broadcast.** Reload window A and immediately switch to window B before A clicks anything. The avatar should be non-clickable; the tooltip should show only the username (no `Click to jump to ...` line).
5. **Self-click disabled.** Hover your own avatar in window B — non-clickable.
6. **Sheets regression.** Open a multi-tab spreadsheet in two windows, peer in tab "Sheet 2" / cell B5. Click avatar in the other window — tab switches and B5 selects.
7. **Mobile zoom-to-fit.** Open Chrome devtools, switch to a narrow mobile viewport so docs zoom-to-fit kicks in. Repeat step 2 — landing Y should still be roughly correct.

If any step fails, file a fresh task or fix in-place — do **not** mark this plan complete.

- [x] **Step 2: Write the lessons file**

Create `docs/tasks/active/20260505-docs-peer-jump-lessons.md` capturing anything that was non-obvious during execution. Skeleton:

```markdown
# Docs Peer Jump — Lessons

## What surprised me

(One bullet per surprise. Examples: closure-cached canvas dimensions
needed because paint() locals weren't accessible; presence shape
mismatch on first try; etc. Leave empty if nothing notable.)

## Manual verification results

- [x] Hover hint shows username
- [x] Click smooth-scrolls to peer caret at top-1/3
- [x] Local caret unaffected
- [x] Disabled before peer broadcasts position
- [x] Self-click disabled
- [x] Sheets peer-jump regression: PASS
- [x] Mobile zoom-to-fit: PASS

## Follow-ups (out of scope for this PR)

- Consider wiring peer-jump for the read-only shared docs view
  (`SharedDocsLayout` in `shared-document.tsx`).
- If a third caller for "scroll to DocPosition top-1/3" appears,
  extract a shared helper used by both Cmd+F find and this jump.
```

- [x] **Step 3: Run final verify**

```bash
pnpm verify:fast
```

Expected: PASS.

- [x] **Step 4: Archive the task and rebuild the index**

```bash
pnpm tasks:archive
pnpm tasks:index
```

This moves both the todo file and the lessons file to `docs/tasks/archive/` and refreshes `docs/tasks/README.md`.

- [x] **Step 5: Final commit**

```bash
git add docs/tasks/
git commit -m "$(cat <<'EOF'
Archive docs-peer-jump task

Manual verification passed. See lessons for details.

EOF
)"
```

---

## Self-Review Notes

Confirmed coverage of every spec section:

- §1 Architecture overview → Tasks 3–4 wire the call chain.
- §2 UserPresence API change → Task 2 step 1.
- §3 Sheets migration → Task 2 steps 2–3 + manual regression in step 5.
- §4 `scrollToPosition` impl → Task 1 (closure caching addresses the spec's `canvasHeight` / `logicalCanvasWidth` references that turned out to be render-locals, not closure-scoped).
- §5 DocsView wiring → Task 3.
- §6 DocsLayout glue → Task 4.
- §7 Edge cases → Tested in Task 5 step 1 (cases 1, 4, 5, 6, 7).
- §8 Testing strategy → Task 5 covers the manual checklist; type/lint via `pnpm verify:fast` in every task.
- §9 Files changed → Matches the file map at the top of this plan.

Type consistency: `JumpHandle.jumpToPeer(clientID: string)`, `EditorAPI.scrollToPosition(pos: DocPosition)`, `getJumpHint(clientID: string) => string | undefined`, `onSelectPeer(clientID: string) => void` — names line up across Tasks 1–4.

No placeholders. Every code step shows the actual code; every command shows the exact text and expected outcome.
