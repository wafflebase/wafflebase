# Document Detail Sidebar Unification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the document detail page sidebar display identically to workspace pages (workspace selector, workspace-scoped nav items, Settings in main nav).

**Architecture:** Add `workspaceId` to the frontend `Document` type (backend already returns it), then fetch workspaces inside `DocumentLayout` and pass the same props to `AppSidebar` as `Layout.tsx` does.

**Tech Stack:** React, React Query, react-router-dom

---

### Task 1: Add `workspaceId` to frontend Document type

**Files:**
- Modify: `packages/frontend/src/types/documents.ts`

**Step 1: Update the type**

```typescript
export type Document = {
  id: number;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
};
```

**Step 2: Verify no type errors**

Run: `pnpm frontend build 2>&1 | head -30`
Expected: No new errors (workspaceId is already returned by the backend, just not typed)

---

### Task 2: Wire workspace data into DocumentLayout sidebar

**Files:**
- Modify: `packages/frontend/src/app/documents/document-detail.tsx`

**Step 1: Remove the hardcoded `items` constant (lines 57-77)**

Delete the module-level `const items = { ... }` block entirely.

**Step 2: Add imports**

Add to existing import from `react-router-dom`:
```typescript
import { DocumentProvider, useDocument } from "@yorkie-js/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
```

Add workspace API import:
```typescript
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
```

Add `useMemo` to the existing React import:
```typescript
import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  lazy,
  Suspense,
} from "react";
```

**Step 3: Add workspace fetching and sidebar items inside DocumentLayout**

After the existing `const { data: documentData }` query (line 135-138), add:

```typescript
const navigate = useNavigate();

const { data: workspaces = [] } = useQuery<Workspace[]>({
  queryKey: ["workspaces"],
  queryFn: fetchWorkspaces,
});

const currentWorkspace = workspaces.find(
  (w) => w.id === documentData?.workspaceId,
);
const workspaceSlug = currentWorkspace?.slug;

const items = useMemo(() => {
  if (workspaceSlug) {
    return {
      main: [
        {
          title: "Documents",
          url: `/w/${workspaceSlug}`,
          icon: IconFolder,
        },
        {
          title: "Data Sources",
          url: `/w/${workspaceSlug}/datasources`,
          icon: IconDatabase,
        },
        {
          title: "Settings",
          url: `/w/${workspaceSlug}/settings`,
          icon: IconSettings,
        },
      ],
      secondary: [],
    };
  }

  return {
    main: [
      { title: "Documents", url: "/documents", icon: IconFolder },
      { title: "Data Sources", url: "/datasources", icon: IconDatabase },
      { title: "Settings", url: "/settings", icon: IconSettings },
    ],
    secondary: [],
  };
}, [workspaceSlug]);

const handleWorkspaceChange = useCallback(
  (slug: string) => {
    navigate(`/w/${slug}`);
  },
  [navigate],
);
```

**Step 4: Update AppSidebar usage in the JSX**

Replace:
```tsx
<AppSidebar variant="inset" items={items} />
```

With:
```tsx
<AppSidebar
  variant="inset"
  items={items}
  workspaces={workspaces}
  currentWorkspace={currentWorkspace}
  onWorkspaceChange={handleWorkspaceChange}
/>
```

**Step 5: Verify build succeeds**

Run: `pnpm frontend build`
Expected: Build succeeds with no errors

---

### Task 3: Run verification and commit

**Step 1: Run lint + tests**

Run: `pnpm verify:fast`
Expected: All checks pass

**Step 2: Commit**

```bash
git add packages/frontend/src/types/documents.ts \
       packages/frontend/src/app/documents/document-detail.tsx
git commit -m "Unify document detail sidebar with workspace sidebar

The document detail page rendered its own sidebar without workspace
context (no workspace selector, global nav URLs, Settings in
secondary section). Now it fetches workspace data using the
document's workspaceId and passes the same props to AppSidebar
as the workspace Layout does."
```
