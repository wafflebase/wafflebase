# Slides UI Chrome + Toolbar Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Match the slides app's chrome and toolbar to the docs
look-and-feel so the three document types (sheet / doc / slides)
feel like one product. After this:

- `SlidesDetail` is wrapped in `SidebarProvider + AppSidebar +
  SiteHeader + ShareDialog + UserPresence` exactly like `DocsDetail`,
  giving slides workspace navigation, document title + rename,
  share dialog, and the user-presence chip.
- A new `SlidesFormattingToolbar.tsx` React component (built on the
  same shadcn `Toolbar` / `Toggle` / `Tooltip` primitives + tabler
  icons that `DocsFormattingToolbar` uses) replaces the raw DOM
  buttons currently built inside `SlidesView`.
- `SlidesView` shrinks to mount the canvas, overlay, thumbnail
  panel, and notes panel only — no chrome, no toolbar.

**Architecture:**
- Slides editor exposes a `getInsertMode()` getter and an
  `onInsertModeChange(cb)` subscription so the toolbar can reflect
  the editor's actual insert state. Today the editor flips insert
  mode back to `null` after a single placement (see
  `editor.ts:startInsert`), so any toolbar that drives state
  one-way (button click → setInsertMode) gets stuck showing the
  button as active forever. The new subscription closes that loop.
- `SlidesFormattingToolbar` takes `editor: SlidesEditor | null` as
  a prop. When the editor mounts, the toolbar subscribes to insert
  mode + selection changes and rerenders. Click handlers call
  `editor.setInsertMode(kind | null)` (toggle).
- The new layout in `SlidesDetail` is the same vertical stack as
  docs:
  ```
  SidebarProvider
    AppSidebar
    SidebarInset
      SiteHeader (title, share, user presence)
      SlidesFormattingToolbar (insert buttons)
      SlidesView (thumbs | canvas+overlay | notes)
  ```
  `SlidesView`'s internal grid (`220px 1fr`) is preserved — the
  vertical stack lives above it inside `SidebarInset`.
- Image / Present / Export PDF buttons (Phase 5b-1 / 5b-2 / 5b-3)
  slot into the new toolbar component, not into `SlidesView`. The
  Phase 5b-1 plan referenced `slides-view.tsx` for the "+ Image"
  button — after this refactor that line moves into
  `SlidesFormattingToolbar` instead, but the rest of the 5b-1 plan
  is unaffected.

**Spec:** No design-doc change. This is pure UI alignment with the
existing docs chrome described in
[`docs/design/frontend.md`](../../design/frontend.md). The slides
spec already says "two-pane layout" — chrome wrapping was implicit.

**Tech Stack:** React 19, shadcn (`@/components/ui/*`), tabler
icons (`@tabler/icons-react`), Vitest + jsdom (for the
`onInsertModeChange` editor unit test). Frontend tests run via the
existing `packages/frontend/vitest.config.ts`.

**Refactor done when:** Slides documents render with the same
sidebar + header chrome as docs, the slides toolbar renders as a
React component using the shadcn primitives, the raw-DOM toolbar
inside `slides-view.tsx` is gone, every existing interaction
(insert shape, insert text, undo via toolbar — wait, slides has no
toolbar undo today; just the insert buttons) keeps working, and
`pnpm verify:fast` is green.

---

## Task 1: Editor exposes `getInsertMode` + `onInsertModeChange`

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts`
- Test: `packages/slides/src/view/editor/editor.test.ts`

The toolbar needs to reflect actual editor state — both the
`setInsertMode` call from the toolbar and the editor's internal
reset to `null` after a placement (`startInsert` calls
`setInsertMode(null)` once the user clicks). One-way data flow
gets the toolbar stuck.

- [ ] **Step 1: Failing test**

Append to `editor.test.ts`:

```ts
  it('notifies onInsertModeChange when setInsertMode is called', () => {
    const { editor } = makeFixture();
    const seen: (string | null)[] = [];
    const unsub = editor.onInsertModeChange(() => {
      seen.push(editor.getInsertMode());
    });

    editor.setInsertMode('rect');
    editor.setInsertMode('text');
    editor.setInsertMode(null);
    unsub();
    editor.setInsertMode('rect');  // post-unsub, should not fire

    expect(seen).toEqual(['rect', 'text', null]);
  });
```

- [ ] **Step 2: Run, expect FAIL on missing methods**

```bash
pnpm --filter @wafflebase/slides test src/view/editor/editor.test.ts -t onInsertModeChange
```

- [ ] **Step 3: Add to interface + impl**

In `editor.ts`, in the `SlidesEditor` interface near
`setInsertMode`:

```ts
  /** Current insert mode, or `null` if no insert mode is active. */
  getInsertMode(): InsertKind | null;
  /**
   * Subscribe to insert-mode changes. Fires whenever
   * `setInsertMode` is called, including the editor's own internal
   * reset to `null` after a placement. Returns an unsubscribe fn.
   */
  onInsertModeChange(cb: () => void): () => void;
```

In `SlidesEditorImpl`, add a listener set + getter + subscribe
method, and wrap the existing `setInsertMode` to fire the callback:

```ts
  private insertModeListeners = new Set<() => void>();

  getInsertMode(): InsertKind | null {
    return this.insertKind;
  }

  setInsertMode(kind: InsertKind | null): void {
    if (this.insertKind === kind) return;
    this.insertKind = kind;
    for (const cb of this.insertModeListeners) cb();
  }

  onInsertModeChange(cb: () => void): () => void {
    this.insertModeListeners.add(cb);
    return () => {
      this.insertModeListeners.delete(cb);
    };
  }
```

(Delete the older `setInsertMode` body that just assigned the
field — the new wrapper above replaces it.)

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @wafflebase/slides test src/view/editor/editor.test.ts
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/src/view/editor/editor.test.ts
git commit -m "Add SlidesEditor.onInsertModeChange + getInsertMode"
```

---

## Task 2: `SlidesFormattingToolbar` React component

**Files:**
- Create: `packages/frontend/src/app/slides/slides-formatting-toolbar.tsx`

Mirrors `DocsFormattingToolbar`'s shape: takes `editor:
SlidesEditor | null`, subscribes to insert-mode changes, renders
shadcn `Toolbar` with `Toggle` for each insert kind. Tabler icons
match docs' visual vocabulary: `IconSquare`, `IconCircle`,
`IconLine`, `IconArrowRight`, `IconLetterT`. Each `Toggle`'s
pressed state reads from `editor.getInsertMode()`; `onPressedChange`
calls `editor.setInsertMode(pressed ? kind : null)`.

Image / Present / Export PDF buttons are NOT added here — those
arrive with Phase 5b-1 / 5b-2 / 5b-3. This task only ports the
existing five buttons.

- [ ] **Step 1: Implement the component**

```tsx
// packages/frontend/src/app/slides/slides-formatting-toolbar.tsx
import { useEffect, useState } from "react";
import type { InsertKind, SlidesEditor } from "@wafflebase/slides";
import { Toggle } from "@/components/ui/toggle";
import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  IconSquare,
  IconCircle,
  IconLine,
  IconArrowRight,
  IconLetterT,
} from "@tabler/icons-react";

interface SlidesFormattingToolbarProps {
  editor: SlidesEditor | null;
}

interface InsertButton {
  kind: InsertKind;
  label: string;
  icon: React.ReactNode;
}

const INSERT_BUTTONS: InsertButton[] = [
  { kind: "rect",    label: "Rectangle", icon: <IconSquare size={16} /> },
  { kind: "ellipse", label: "Ellipse",   icon: <IconCircle size={16} /> },
  { kind: "line",    label: "Line",      icon: <IconLine size={16} /> },
  { kind: "arrow",   label: "Arrow",     icon: <IconArrowRight size={16} /> },
  { kind: "text",    label: "Text box",  icon: <IconLetterT size={16} /> },
];

/**
 * Slides equivalent of `DocsFormattingToolbar`. Renders the insert
 * toolbar above the slide canvas; reflects the editor's actual
 * insert mode (the editor resets it to null after a placement, so a
 * one-way controlled toolbar would get stuck "pressed").
 */
export function SlidesFormattingToolbar({ editor }: SlidesFormattingToolbarProps) {
  const [insertMode, setInsertMode] = useState<InsertKind | null>(null);

  useEffect(() => {
    if (!editor) return;
    setInsertMode(editor.getInsertMode());
    return editor.onInsertModeChange(() => setInsertMode(editor.getInsertMode()));
  }, [editor]);

  return (
    <Toolbar className="flex h-10 items-center gap-1 border-b px-2">
      {INSERT_BUTTONS.map((b, i) => (
        <Tooltip key={b.kind}>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={insertMode === b.kind}
              onPressedChange={(pressed) => {
                editor?.setInsertMode(pressed ? b.kind : null);
              }}
              aria-label={b.label}
              disabled={!editor}
            >
              {b.icon}
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>{b.label}</TooltipContent>
          {i < INSERT_BUTTONS.length - 1 ? null : null}
        </Tooltip>
      ))}
      <ToolbarSeparator className="mx-1" />
      {/* Phase 5b-1 will add an "+ Image" button here.
          Phase 5b-2 will add a "Present" button here.
          Phase 5b-3 will add an "Export PDF" button here. */}
    </Toolbar>
  );
}
```

- [ ] **Step 2: Verify imports resolve + commit**

```bash
pnpm --filter @wafflebase/frontend tsc --noEmit
git add packages/frontend/src/app/slides/slides-formatting-toolbar.tsx
git commit -m "Add SlidesFormattingToolbar React component"
```

---

## Task 3: Slim `SlidesView` — drop the raw-DOM toolbar

**Files:**
- Modify: `packages/frontend/src/app/slides/slides-view.tsx`

`SlidesView` no longer builds toolbar DOM. The container becomes:

```
canvasWrap (relative)
  canvas
  overlay
notesHost
```

Plus the existing `thumbsHost` on the left. The grid stays
`220px 1fr`. Pass `editor` up via `onEditorReady` so the parent
(layout in `SlidesDetail`) can render the toolbar.

- [ ] **Step 1: Delete the toolbar block**

In `slides-view.tsx`, remove everything from the
`// Toolbar — vanilla DOM buttons …` comment through
`right.appendChild(toolbar);` (~50 lines). Also drop the `InsertKind`
import alias if it's now unused. Keep `editor.setInsertMode` exports
intact — the toolbar component re-exports them through the editor.

- [ ] **Step 2: Verify the slides-view tests / imports still typecheck**

```bash
pnpm --filter @wafflebase/frontend tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/slides/slides-view.tsx
git commit -m "Remove raw-DOM toolbar from SlidesView (moved to React)"
```

---

## Task 4: `SlidesDetail` chrome — mirror `DocsDetail`

**Files:**
- Modify: `packages/frontend/src/app/slides/slides-detail.tsx`

Wrap with `SidebarProvider + AppSidebar + SiteHeader (with
ShareDialog + UserPresence) + SlidesFormattingToolbar + SlidesView`.
This is mostly a paste-and-adapt from `DocsDetail`.

- [ ] **Step 1: Replace the body of `SlidesDetail`**

```tsx
// packages/frontend/src/app/slides/slides-detail.tsx
import { DocumentProvider } from "@yorkie-js/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMe } from "@/api/auth";
import { fetchDocument, renameDocument } from "@/api/documents";
import { toast } from "sonner";
import { Loader } from "@/components/loader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { ShareDialog } from "@/components/share-dialog";
import { UserPresence } from "@/components/user-presence";
import { usePresenceUpdater } from "@/hooks/use-presence-updater";
import { IconFolder, IconSettings, IconDatabase } from "@tabler/icons-react";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import { SlidesView, type SlidesEditor } from "./slides-view";
import { SlidesFormattingToolbar } from "./slides-formatting-toolbar";

function initialSlidesRoot(): Partial<YorkieSlidesRoot> {
  return {};
}

/**
 * SlidesLayout — sidebar + header chrome around the slides editor.
 * Mirrors `DocsLayout` so the three document types share a single
 * visual language.
 */
function SlidesLayout({ documentId }: { documentId: string }) {
  usePresenceUpdater();
  const [editor, setEditor] = useState<SlidesEditor | null>(null);

  // Clean up stale pointer-events left by Radix Sheet (matches docs).
  useEffect(() => {
    document.body.style.removeProperty("pointer-events");
    return () => {
      document.body.style.removeProperty("pointer-events");
    };
  }, []);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: documentData, isError: isDocumentError } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    retry: false,
  });

  useEffect(() => {
    document.title = documentData?.title
      ? `${documentData.title} — Wafflebase`
      : "Wafflebase";
  }, [documentData?.title]);

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  const currentWorkspace = workspaces.find(
    (w) => w.id === documentData?.workspaceId,
  );
  const workspaceSlug = currentWorkspace?.slug;
  const fallbackSlug = workspaceSlug ?? workspaces[0]?.slug;

  useEffect(() => {
    if (isDocumentError) {
      toast.error("Document not found");
      navigate(fallbackSlug ? `/w/${fallbackSlug}` : "/documents", {
        replace: true,
      });
    }
  }, [isDocumentError, navigate, fallbackSlug]);

  const items = useMemo(() => {
    const wsRoot = workspaceSlug ? `/w/${workspaceSlug}` : "/documents";
    const dsRoot = workspaceSlug
      ? `/w/${workspaceSlug}/datasources`
      : "/datasources";
    const stRoot = workspaceSlug
      ? `/w/${workspaceSlug}/settings`
      : "/settings";
    return {
      main: [
        { title: "Documents", url: wsRoot, icon: IconFolder },
        { title: "Data Sources", url: dsRoot, icon: IconDatabase },
        { title: "Settings", url: stRoot, icon: IconSettings },
      ],
      secondary: [],
    };
  }, [workspaceSlug]);

  const handleWorkspaceChange = useCallback(
    (slug: string) => navigate(`/w/${slug}`),
    [navigate],
  );

  const handleRenameDocument = useCallback(
    async (newTitle: string) => {
      await renameDocument(documentId, newTitle);
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    [documentId, queryClient],
  );

  return (
    <SidebarProvider>
      <AppSidebar
        variant="inset"
        items={items}
        workspaces={workspaces}
        currentWorkspace={currentWorkspace}
        onWorkspaceChange={handleWorkspaceChange}
      />
      <SidebarInset>
        <SiteHeader
          title={documentData?.title ?? "Loading..."}
          editable
          onRename={handleRenameDocument}
        >
          <div className="flex items-center gap-2">
            <ShareDialog documentId={documentId} />
            <UserPresence />
          </div>
        </SiteHeader>
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <SlidesFormattingToolbar editor={editor} />
          <SlidesView onEditorReady={setEditor} documentId={documentId} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function SlidesDetail() {
  const { id } = useParams();

  const {
    data: currentUser,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Loader />;
  if (isError || !currentUser) return <Navigate to="/login" replace />;
  if (!currentUser.username || !currentUser.email) return <Loader />;

  return (
    <DocumentProvider
      docKey={`slides-${id}`}
      initialRoot={initialSlidesRoot()}
      initialPresence={{
        username: encodeURIComponent(currentUser.username),
        email: currentUser.email,
        photo: currentUser.photo || "",
      }}
      enableDevtools={import.meta.env.DEV}
    >
      <SlidesLayout documentId={id!} />
    </DocumentProvider>
  );
}

export default SlidesDetail;
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/app/slides/slides-detail.tsx
git commit -m "Wrap SlidesDetail with sidebar + header chrome (matches docs)"
```

---

## Task 5: Verify gate + manual smoke

- [ ] **Step 1: Run pre-commit gate**

```bash
pnpm verify:fast
```

If lint complains about unused `InsertKind` / unused `labels` map
imports inside `slides-view.tsx`, drop them.

- [ ] **Step 2: Manual smoke**

```bash
docker compose up -d
pnpm dev
```

In a slides document:
1. Sidebar (workspace nav) and SiteHeader (title, share, user
   chip) match the docs route exactly.
2. The toolbar above the canvas shows 5 icon buttons (rect /
   ellipse / line / arrow / text). Hover shows tooltips.
3. Click "+ Rect" → button is pressed; click on canvas → rect is
   placed AND the toolbar button un-presses (tests
   `onInsertModeChange` reset).
4. Click "+ Text" → click on canvas → empty text-box appears,
   toolbar un-presses.
5. Existing thumbs panel + notes panel still render and are
   interactive.

- [ ] **Step 3: Commit + push (if any cleanup commits remain)**

```bash
git push
```

---

## Phase 5b-1 plan amendment

After this refactor lands, the Task 4 step in
`20260507-slides-phase5b-1-image-plan.md` ("Wire toolbar +
drag/paste in `slides-view.tsx`") needs to be split:

- The "+ Image" button moves into
  `SlidesFormattingToolbar` (alongside the existing 5 insert
  buttons), driven by props that expose `onPickFile(file)`
  bubbling up to `SlidesLayout`.
- The drag-drop + paste wiring (`setupSlidesImagePaths`) stays
  inside `SlidesView` because it needs the `canvasWrap` ref.

The amendment is small enough that the Phase 5b-1 plan should be
edited inline (not republished) once this refactor merges.

---

## Out of scope for this refactor

- Slide thumbnail panel as a React component. Stays vanilla DOM —
  it's mounted from the `@wafflebase/slides` package which is
  intentionally framework-agnostic. A React wrapper is a v1.1
  cleanup, not a chrome / toolbar concern.
- Notes panel React-ification. Same reason.
- Responsive canvas sizing (it's still 960×540 fixed). Follow-up
  if the inset sidebar makes the content area too narrow on
  small viewports.
- `SlidesView` rename or directory restructuring. The component
  surface stays the same so `slides-detail.tsx` import paths
  don't churn.
