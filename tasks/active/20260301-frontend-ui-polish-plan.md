# Frontend UI Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve visual consistency and completeness across login and internal pages (excluding the spreadsheet editor).

**Architecture:** Incremental changes to existing page components — unify layout padding, replace hardcoded colors with theme tokens, improve loading/error/empty states, and fix copy issues. No new shared components; uses existing Skeleton UI primitive.

**Tech Stack:** React 19, Tailwind CSS 4.1, Radix UI, Lucide icons

---

### Task 1: Fix login page description text

**Files:**
- Modify: `packages/frontend/src/components/login-form.tsx:17`

**Step 1: Fix the copy**

Change the incomplete sentence:
```tsx
// Before
<p className="text-balance text-sm text-muted-foreground">
  Wafflebase with your GitHub account.
</p>

// After
<p className="text-balance text-sm text-muted-foreground">
  Sign in with your GitHub account to get started.
</p>
```

**Step 2: Verify visually**

Run: `pnpm frontend dev` and check `/login` page in browser.

**Step 3: Commit**

```bash
git add packages/frontend/src/components/login-form.tsx
git commit -m "Fix incomplete login page description text"
```

---

### Task 2: Replace hardcoded colors with theme tokens

Replace all hardcoded gray/red colors in page components with semantic
theme tokens. This does NOT touch components inside `spreadsheet/`
(excluded from scope).

**Files:**
- Modify: `packages/frontend/src/app/documents/page.tsx`
- Modify: `packages/frontend/src/app/documents/document-list.tsx`
- Modify: `packages/frontend/src/app/datasources/page.tsx`
- Modify: `packages/frontend/src/app/datasources/datasource-list.tsx`
- Modify: `packages/frontend/src/app/settings/page.tsx`
- Modify: `packages/frontend/src/app/workspaces/workspace-documents.tsx`
- Modify: `packages/frontend/src/app/workspaces/workspace-datasources.tsx`
- Modify: `packages/frontend/src/app/workspaces/workspace-settings.tsx`
- Modify: `packages/frontend/src/app/workspaces/workspace-redirect.tsx`
- Modify: `packages/frontend/src/app/workspaces/invite-accept.tsx`

**Step 1: Apply color replacements**

Mapping (apply across all files listed above):

| Before | After |
|--------|-------|
| `text-gray-500` | `text-muted-foreground` |
| `text-gray-400` | `text-muted-foreground` |
| `text-red-500` (in loading/error text) | `text-destructive` |
| `text-red-500 hover:text-red-600` (on action buttons) | `text-destructive hover:text-destructive` |
| `text-red-500 focus:text-red-500` (on dropdown items) | `text-destructive focus:text-destructive` |
| `text-red-600` (Danger Zone heading) | `text-destructive` |
| `border-red-300` (Danger Zone border) | `border-destructive/30` |
| `text-green-500` (datasource status) | keep as-is (semantic success color, no theme token available) |

Note: `text-red-500` inside `datasource-list.tsx` for the XCircle
status icon should become `text-destructive`.

**Step 2: Run lint**

Run: `pnpm frontend lint`
Expected: PASS (no lint errors)

**Step 3: Commit**

```bash
git add packages/frontend/src/app/ packages/frontend/src/components/
git commit -m "Replace hardcoded colors with theme tokens

Swap text-gray-* and text-red-* for text-muted-foreground and
text-destructive so all page colors respond to theme changes."
```

---

### Task 3: Unify page layout padding

**Files:**
- Modify: `packages/frontend/src/app/documents/page.tsx:42` — `p-4` → `p-4 lg:p-6`
- Modify: `packages/frontend/src/app/datasources/page.tsx:42` — `p-4` → `p-4 lg:p-6`
- Modify: `packages/frontend/src/app/settings/page.tsx:16` — `max-w-2xl mx-auto p-6` → `p-4 lg:p-6 max-w-2xl space-y-8`
- Modify: `packages/frontend/src/app/workspaces/workspace-documents.tsx:46` — `p-4` → `p-4 lg:p-6`
- Modify: `packages/frontend/src/app/workspaces/workspace-datasources.tsx:46` — `p-4` → `p-4 lg:p-6`
- Modify: `packages/frontend/src/app/workspaces/workspace-settings.tsx:169` — `p-4 max-w-2xl space-y-8` → `p-4 lg:p-6 max-w-2xl space-y-8`

**Step 1: Apply padding changes**

For each file, update the outermost container `<div>` className:

```tsx
// Table pages (documents, datasources):
<div className="p-4 lg:p-6">

// Form/settings pages:
<div className="p-4 lg:p-6 max-w-2xl space-y-8">
```

**Step 2: Run lint**

Run: `pnpm frontend lint`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/frontend/src/app/
git commit -m "Unify page layout padding across all pages

Standardize on p-4 lg:p-6 for all pages. Settings pages keep
max-w-2xl left-aligned."
```

---

### Task 4: Improve loading states with Skeleton

Replace plain text "Loading..." messages with Skeleton-based loading
indicators.

**Files:**
- Modify: `packages/frontend/src/app/documents/page.tsx`
- Modify: `packages/frontend/src/app/datasources/page.tsx`
- Modify: `packages/frontend/src/app/workspaces/workspace-documents.tsx`
- Modify: `packages/frontend/src/app/workspaces/workspace-datasources.tsx`
- Modify: `packages/frontend/src/app/workspaces/workspace-settings.tsx`
- Modify: `packages/frontend/src/app/workspaces/workspace-redirect.tsx`

**Step 1: Update table page loading states**

For Documents and DataSources pages (both global and workspace-scoped),
replace the loading block with a table skeleton:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

// Replace loading block:
if (isLoading) {
  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="rounded-md border">
        <div className="p-4 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Update settings page loading state**

For WorkspaceSettings:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

if (isLoading) {
  return (
    <div className="p-4 lg:p-6 max-w-2xl space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
```

**Step 3: Update WorkspaceRedirect loading**

```tsx
import { Skeleton } from "@/components/ui/skeleton";

return (
  <div className="flex items-center justify-center h-64">
    <Skeleton className="h-5 w-32" />
  </div>
);
```

**Step 4: Run lint**

Run: `pnpm frontend lint`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/frontend/src/app/
git commit -m "Replace text loading indicators with Skeleton components

Table pages show skeleton filter bar + table rows. Settings pages
show skeleton section blocks."
```

---

### Task 5: Improve error states

**Files:**
- Modify: `packages/frontend/src/app/documents/page.tsx`
- Modify: `packages/frontend/src/app/datasources/page.tsx`
- Modify: `packages/frontend/src/app/workspaces/workspace-documents.tsx`
- Modify: `packages/frontend/src/app/workspaces/workspace-datasources.tsx`
- Modify: `packages/frontend/src/app/workspaces/workspace-settings.tsx`
- Modify: `packages/frontend/src/app/workspaces/invite-accept.tsx`

**Step 1: Update error blocks**

For all page-level error states, use consistent theme colors
(already done in Task 2) and improve the copy:

```tsx
if (isError) {
  if (isAuthExpiredError(error)) {
    return null;
  }
  return (
    <div className="flex flex-col items-center justify-center h-64">
      <p className="text-destructive text-lg">Failed to load documents.</p>
      <p className="text-sm text-muted-foreground">Please try again later.</p>
    </div>
  );
}
```

Note: the color changes happen in Task 2. This task ensures the
`text-lg`/`text-sm` sizing is consistent across all error states
(some had `text-lg` for the secondary line).

For invite-accept error:
```tsx
if (error) {
  return (
    <div className="p-8 text-center text-destructive">{error}</div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/app/
git commit -m "Standardize error state text sizing across pages"
```

---

### Task 6: Add contextual empty states

**Files:**
- Modify: `packages/frontend/src/app/documents/document-list.tsx:250-258`
- Modify: `packages/frontend/src/app/datasources/datasource-list.tsx:291-299`

**Step 1: Update DocumentList empty state**

Replace the bare "No results." with a contextual empty state:

```tsx
import { FileText } from "lucide-react";

// In the empty TableRow:
<TableRow>
  <TableCell
    colSpan={columns.length}
    className="h-48"
  >
    <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <FileText className="h-10 w-10 stroke-1" />
      <p className="text-sm font-medium">No documents yet</p>
      <Button
        size="sm"
        onClick={() =>
          createDocumentMutation.mutate({ title: "New Document" })
        }
      >
        <Plus className="w-4 h-4 mr-1" />
        New Document
      </Button>
    </div>
  </TableCell>
</TableRow>
```

**Step 2: Update DataSourceList empty state**

Replace the existing empty state with a matching pattern:

```tsx
import { Database } from "lucide-react";

// In the empty TableRow:
<TableRow>
  <TableCell
    colSpan={columns.length}
    className="h-48"
  >
    <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <Database className="h-10 w-10 stroke-1" />
      <p className="text-sm font-medium">No data sources yet</p>
      <Button
        size="sm"
        onClick={() => setShowCreate(true)}
      >
        <Plus className="w-4 h-4 mr-1" />
        New DataSource
      </Button>
    </div>
  </TableCell>
</TableRow>
```

**Step 3: Run lint**

Run: `pnpm frontend lint`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/frontend/src/app/documents/document-list.tsx \
       packages/frontend/src/app/datasources/datasource-list.tsx
git commit -m "Add contextual empty states with icons and CTA buttons

Show relevant icon, message, and create button when document or
data source lists are empty."
```

---

### Task 7: Restructure Settings page

**Files:**
- Modify: `packages/frontend/src/app/settings/page.tsx`

**Step 1: Add section structure**

```tsx
import { useContext } from "react";
import { ThemeProviderContext } from "@/components/theme-provider";
import { Switch } from "@/components/ui/switch";

export default function Settings() {
  const { theme, setTheme } = useContext(ThemeProviderContext);

  const handleThemeToggle = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <div className="p-4 lg:p-6 max-w-2xl space-y-8">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <div className="flex items-center justify-between rounded-md border p-4">
          <div>
            <label htmlFor="theme-switch" className="text-sm font-medium">
              Dark mode
            </label>
            <p className="text-xs text-muted-foreground">
              Toggle between light and dark themes.
            </p>
          </div>
          <Switch
            id="theme-switch"
            checked={theme === "dark"}
            onCheckedChange={handleThemeToggle}
          />
        </div>
      </section>
    </div>
  );
}
```

Key changes:
- Outer div uses unified `p-4 lg:p-6 max-w-2xl space-y-8`
- Added "Appearance" section heading (`h2`)
- Added `rounded-md border` card around the toggle row
- Renamed label from "Theme" to "Dark mode" (more specific)
- Removed unnecessary wrapper divs around Switch

**Step 2: Run lint**

Run: `pnpm frontend lint`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/frontend/src/app/settings/page.tsx
git commit -m "Restructure Settings page with section headings

Add Appearance section heading and border card to match workspace
settings pattern."
```

---

### Task 8: Run verification

**Step 1: Run fast verification**

Run: `pnpm verify:fast`
Expected: PASS — lint + unit tests all green

**Step 2: Run build**

Run: `pnpm frontend build`
Expected: PASS — no TypeScript or build errors

**Step 3: Update task files**

Mark all items complete in the todo file, add lessons learned.
