# Revision History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Google-Docs-style Version history panel — list, name, preview and non-destructively restore past versions — on wafflebase's five CRDT document types.

**Architecture:** Yorkie `0.7.18` already stores the revisions (one automatic revision per server snapshot, plus ones we create) and `@yorkie-js/react` already exposes `useRevisions()`. So wafflebase adds no persistence and no backend endpoints: a shared frontend module owns the panel, the metadata contract, and a per-type read-only preview hydrated from the revision's YSON snapshot into each engine's existing in-memory store. Authorization is enforced by the existing Yorkie auth webhook once upstream gates the revision RPCs.

**Tech Stack:** React 19 + Vite + Tailwind + Radix (frontend), `@yorkie-js/react` / `@yorkie-js/sdk` `0.7.18`, Vitest + Testing Library (frontend tests), Jest (backend tests), NestJS (auth webhook).

**Spec:** [`docs/design/revision-history.md`](../../design/revision-history.md)

**Task tracking:** [`20260902-revision-history-todo.md`](./20260902-revision-history-todo.md) · lessons: [`20260902-revision-history-lessons.md`](./20260902-revision-history-lessons.md)

## Global Constraints

- **Do not enable the feature flag on any deployment running `YORKIE_AUTH_WEBHOOK_ENFORCE=false`.** Shadow mode logs the denial it *would* make and allows the request anyway, so the gate does not exist until enforcement is on.
- **Ship behind `VITE_WB_REVISION_HISTORY`** until upstream ask 1 (auth-webhook gating of the revision RPCs) has landed and is registered on the project. Until then a read-only client can list, read and restore.
- Yorkie SDK floor: `@yorkie-js/sdk` and `@yorkie-js/react` at `0.7.18` (already pinned in `packages/frontend/package.json`). `useRevisions()` does not exist below it.
- Revision `description` payload is exactly `{"v":1,"by":<userId>,"kind":"named"|"safety"}` — version field first, `by` is the numeric `User.id`.
- Automatic revisions carry no author. Render them with a time only; **never** synthesize or infer one.
- `YSON.parse` cannot parse a docs snapshot (Tree nesting ≥ 4). Docs preview is out of scope for this plan; Task 12 records the follow-up.
- Every commit must pass `pnpm verify:fast` (the pre-commit hook runs it; allow ~4 minutes).
- All repo artifacts — commits, comments, docs — in English.

---

## Phase A — panel: list, name, restore

### Task 1: Revision metadata contract

**Files:**
- Create: `packages/frontend/src/components/history/revision-meta.ts`
- Test: `packages/frontend/src/components/history/__tests__/revision-meta.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `type RevisionKind = 'named' | 'safety' | 'automatic'`
  - `type RevisionMeta = { kind: RevisionKind; by?: number }`
  - `function writeRevisionMeta(kind: 'named' | 'safety', by: number): string`
  - `function readRevisionMeta(revision: { label: string; description?: string }): RevisionMeta`
  - `const AUTOMATIC_LABEL_PREFIX = 'snapshot-'`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  readRevisionMeta,
  writeRevisionMeta,
} from '../revision-meta';

describe('writeRevisionMeta', () => {
  it('serializes the versioned payload', () => {
    expect(writeRevisionMeta('named', 42)).toBe('{"v":1,"by":42,"kind":"named"}');
  });
});

describe('readRevisionMeta', () => {
  it('reads a named revision we wrote', () => {
    expect(
      readRevisionMeta({ label: 'Before the rewrite', description: writeRevisionMeta('named', 42) }),
    ).toEqual({ kind: 'named', by: 42 });
  });

  it('reads a safety revision we wrote', () => {
    expect(
      readRevisionMeta({ label: 'Before restore', description: writeRevisionMeta('safety', 7) }),
    ).toEqual({ kind: 'safety', by: 7 });
  });

  it("treats Yorkie's own snapshot revisions as automatic", () => {
    expect(readRevisionMeta({ label: 'snapshot-503', description: '' })).toEqual({
      kind: 'automatic',
    });
  });

  // A user may name a version "snapshot-503". The description is authoritative;
  // the label prefix is only a fallback for revisions we did not write.
  it('prefers the description over a colliding label', () => {
    expect(
      readRevisionMeta({ label: 'snapshot-503', description: writeRevisionMeta('named', 42) }),
    ).toEqual({ kind: 'named', by: 42 });
  });

  it('falls back to automatic on a malformed description', () => {
    expect(readRevisionMeta({ label: 'snapshot-9', description: 'not json' })).toEqual({
      kind: 'automatic',
    });
  });

  // Forward compatibility: a payload from a future version is not ours to read.
  it('falls back to automatic on an unknown payload version', () => {
    expect(
      readRevisionMeta({ label: 'x', description: '{"v":2,"by":1,"kind":"named"}' }),
    ).toEqual({ kind: 'automatic' });
  });

  it('drops a non-numeric author rather than trusting it', () => {
    expect(
      readRevisionMeta({ label: 'x', description: '{"v":1,"by":"42","kind":"named"}' }),
    ).toEqual({ kind: 'named' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- revision-meta`
Expected: FAIL — cannot resolve `../revision-meta`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * The `description` payload we write onto revisions we create.
 *
 * Yorkie's `RevisionSummary` has no author and no kind — only
 * `{id, label, description, snapshot, createdAt}` — so this is where
 * wafflebase records what a revision is and who made it. Revisions Yorkie
 * creates on its own (one per server snapshot) carry an empty description
 * and a `snapshot-<serverSeq>` label.
 */
export const AUTOMATIC_LABEL_PREFIX = 'snapshot-';

/** Payload schema version. Bump only on a breaking shape change. */
const META_VERSION = 1;

export type RevisionKind = 'named' | 'safety' | 'automatic';

export type RevisionMeta = {
  kind: RevisionKind;
  /** `User.id` of whoever created it. Absent on automatic revisions. */
  by?: number;
};

export function writeRevisionMeta(kind: 'named' | 'safety', by: number): string {
  return JSON.stringify({ v: META_VERSION, by, kind });
}

/**
 * Classify a revision. The description is authoritative — a user is free to
 * name a version `snapshot-503`, and the label prefix is only a fallback for
 * revisions wafflebase did not write.
 */
export function readRevisionMeta(revision: {
  label: string;
  description?: string;
}): RevisionMeta {
  const parsed = parseDescription(revision.description);
  if (parsed) return parsed;
  return { kind: 'automatic' };
}

function parseDescription(description?: string): RevisionMeta | null {
  if (!description) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(description);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { v, kind, by } = raw as Record<string, unknown>;
  if (v !== META_VERSION) return null;
  if (kind !== 'named' && kind !== 'safety') return null;
  return typeof by === 'number' ? { kind, by } : { kind };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- revision-meta`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/history/revision-meta.ts \
        packages/frontend/src/components/history/__tests__/revision-meta.test.ts
git commit -m "Add the revision description metadata contract"
```

---

### Task 2: Grouping revisions into a timeline

**Files:**
- Create: `packages/frontend/src/components/history/group-revisions.ts`
- Test: `packages/frontend/src/components/history/__tests__/group-revisions.test.ts`

**Interfaces:**
- Consumes: `readRevisionMeta`, `RevisionMeta` (Task 1).
- Produces:
  - `type TimelineEntry = { id: string; label: string; createdAt: Date; meta: RevisionMeta }`
  - `type TimelineDay = { dayKey: string; entries: TimelineEntry[] }`
  - `function groupRevisions(revisions: ReadonlyArray<RevisionSummary>): TimelineDay[]`

`dayKey` is a local-time `YYYY-MM-DD` string; formatting for display belongs to the component, not here, so the function stays timezone-testable.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { groupRevisions } from '../group-revisions';
import { writeRevisionMeta } from '../revision-meta';

const rev = (id: string, label: string, iso: string, description = '') => ({
  id,
  label,
  description,
  snapshot: '',
  createdAt: new Date(iso),
});

describe('groupRevisions', () => {
  it('groups by local day, newest day first and newest entry first', () => {
    const days = groupRevisions([
      rev('c', 'snapshot-9', '2026-09-02T10:00:00Z'),
      rev('b', 'snapshot-8', '2026-09-01T18:00:00Z'),
      rev('a', 'snapshot-7', '2026-09-01T09:00:00Z'),
    ]);
    expect(days.map((d) => d.dayKey)).toEqual(['2026-09-02', '2026-09-01']);
    expect(days[1].entries.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('classifies each entry', () => {
    const [day] = groupRevisions([
      rev('n', 'Launch copy', '2026-09-02T10:00:00Z', writeRevisionMeta('named', 42)),
      rev('s', 'snapshot-3', '2026-09-02T09:00:00Z'),
    ]);
    expect(day.entries.map((e) => e.meta.kind)).toEqual(['named', 'automatic']);
    expect(day.entries[0].meta.by).toBe(42);
  });

  it('returns no days for no revisions', () => {
    expect(groupRevisions([])).toEqual([]);
  });

  // listRevisions defaults to newest-first, but the panel must not depend on
  // the server's ordering to render a correct timeline.
  it('sorts input it was handed out of order', () => {
    const days = groupRevisions([
      rev('old', 'snapshot-1', '2026-09-01T09:00:00Z'),
      rev('new', 'snapshot-2', '2026-09-02T10:00:00Z'),
    ]);
    expect(days.map((d) => d.dayKey)).toEqual(['2026-09-02', '2026-09-01']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- group-revisions`
Expected: FAIL — cannot resolve `../group-revisions`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { RevisionSummary } from '@yorkie-js/react';
import { readRevisionMeta, type RevisionMeta } from './revision-meta';

export type TimelineEntry = {
  id: string;
  label: string;
  createdAt: Date;
  meta: RevisionMeta;
};

export type TimelineDay = {
  /** Local-time `YYYY-MM-DD`. Display formatting belongs to the component. */
  dayKey: string;
  entries: TimelineEntry[];
};

/**
 * Turn a flat revision list into the day-grouped timeline the panel renders.
 *
 * Sorts defensively: `listRevisions` defaults to newest-first, but the
 * timeline's correctness should not depend on the server's ordering.
 */
export function groupRevisions(
  revisions: ReadonlyArray<RevisionSummary>,
): TimelineDay[] {
  const entries = revisions
    .map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt,
      meta: readRevisionMeta(r),
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const days: TimelineDay[] = [];
  for (const entry of entries) {
    const dayKey = toLocalDayKey(entry.createdAt);
    const last = days[days.length - 1];
    if (last?.dayKey === dayKey) last.entries.push(entry);
    else days.push({ dayKey, entries: [entry] });
  }
  return days;
}

function toLocalDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- group-revisions`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/history/group-revisions.ts \
        packages/frontend/src/components/history/__tests__/group-revisions.test.ts
git commit -m "Group revisions into a day-keyed timeline"
```

---

### Task 3: The `use-revision-history` hook

**Files:**
- Create: `packages/frontend/src/components/history/use-revision-history.ts`
- Test: `packages/frontend/src/components/history/__tests__/use-revision-history.test.ts`

**Interfaces:**
- Consumes: `groupRevisions`, `TimelineDay` (Task 2); `writeRevisionMeta` (Task 1); `useRevisions()` from `@yorkie-js/react`.
- Produces:
  - `function useRevisionHistory(opts: { enabled: boolean; userId: number }): { days: TimelineDay[]; isLoading: boolean; error: Error | null; refresh: () => Promise<void>; nameCurrentVersion: (label: string) => Promise<void>; restore: (revisionId: string) => Promise<void> }`

**Do not port CodePair's `useYorkieRevisions`.** It hand-rolls the client calls because it pins SDK `0.7.12`; `@yorkie-js/react@0.7.18` exports `useRevisions()` bound to the ambient `DocumentProvider`, which is what this hook wraps.

`restore()` creates the safety revision *first* — that is what makes restore non-destructive, and it is the behavior the test pins.

- [ ] **Step 1: Write the failing test**

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRevisionHistory } from '../use-revision-history';

const listRevisions = vi.fn();
const createRevision = vi.fn();
const restoreRevision = vi.fn();
const getRevision = vi.fn();

vi.mock('@yorkie-js/react', () => ({
  useRevisions: () => ({ listRevisions, createRevision, getRevision, restoreRevision }),
}));

const rev = (id: string, label: string, iso: string, description = '') => ({
  id, label, description, snapshot: '', createdAt: new Date(iso),
});

beforeEach(() => {
  vi.clearAllMocks();
  listRevisions.mockResolvedValue([rev('a', 'snapshot-1', '2026-09-02T10:00:00Z')]);
  createRevision.mockResolvedValue(rev('new', 'x', '2026-09-02T11:00:00Z'));
  restoreRevision.mockResolvedValue(undefined);
});

describe('useRevisionHistory', () => {
  it('loads and groups revisions when enabled', async () => {
    const { result } = renderHook(() => useRevisionHistory({ enabled: true, userId: 42 }));
    await waitFor(() => expect(result.current.days).toHaveLength(1));
    expect(result.current.days[0].entries[0].meta.kind).toBe('automatic');
  });

  it('fetches nothing while disabled', async () => {
    renderHook(() => useRevisionHistory({ enabled: false, userId: 42 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(listRevisions).not.toHaveBeenCalled();
  });

  it('names the current version with our metadata, then refreshes', async () => {
    const { result } = renderHook(() => useRevisionHistory({ enabled: true, userId: 42 }));
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
    await act(() => result.current.nameCurrentVersion('Launch copy'));
    expect(createRevision).toHaveBeenCalledWith(
      'Launch copy',
      '{"v":1,"by":42,"kind":"named"}',
    );
    expect(listRevisions).toHaveBeenCalledTimes(2);
  });

  // The safety revision is what makes restore non-destructive. It must exist
  // before the restore runs, not after.
  it('creates a safety revision before restoring', async () => {
    const order: string[] = [];
    createRevision.mockImplementation(async () => {
      order.push('create');
      return rev('safety', 'Before restore', '2026-09-02T11:00:00Z');
    });
    restoreRevision.mockImplementation(async () => { order.push('restore'); });

    const { result } = renderHook(() => useRevisionHistory({ enabled: true, userId: 42 }));
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
    await act(() => result.current.restore('a'));

    expect(order).toEqual(['create', 'restore']);
    expect(createRevision).toHaveBeenCalledWith(
      'Before restore',
      '{"v":1,"by":42,"kind":"safety"}',
    );
  });

  it('does not restore when the safety revision fails', async () => {
    createRevision.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useRevisionHistory({ enabled: true, userId: 42 }));
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
    await act(async () => {
      await expect(result.current.restore('a')).rejects.toThrow('offline');
    });
    expect(restoreRevision).not.toHaveBeenCalled();
  });

  it('surfaces a load failure instead of rendering an empty timeline', async () => {
    listRevisions.mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => useRevisionHistory({ enabled: true, userId: 42 }));
    await waitFor(() => expect(result.current.error?.message).toBe('denied'));
    expect(result.current.days).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- use-revision-history`
Expected: FAIL — cannot resolve `../use-revision-history`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { useCallback, useEffect, useState } from 'react';
import { useRevisions } from '@yorkie-js/react';
import { groupRevisions, type TimelineDay } from './group-revisions';
import { writeRevisionMeta } from './revision-meta';

/** How many revisions the panel lists. Revision storage is unbounded upstream. */
const PAGE_SIZE = 50;

const SAFETY_LABEL = 'Before restore';

export function useRevisionHistory({
  enabled,
  userId,
}: {
  enabled: boolean;
  userId: number;
}) {
  const { listRevisions, createRevision, restoreRevision } = useRevisions();
  const [days, setDays] = useState<TimelineDay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const revisions = await listRevisions({ pageSize: PAGE_SIZE });
      setDays(groupRevisions(revisions));
      setError(null);
    } catch (err) {
      // Leave `days` untouched: an empty timeline and a failed load are
      // different things and must not look the same.
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [listRevisions]);

  const nameCurrentVersion = useCallback(
    async (label: string) => {
      await createRevision(label, writeRevisionMeta('named', userId));
      await refresh();
    },
    [createRevision, refresh, userId],
  );

  const restore = useCallback(
    async (revisionId: string) => {
      // Safety first, and deliberately un-caught: if the current state cannot
      // be preserved, the restore must not happen.
      await createRevision(SAFETY_LABEL, writeRevisionMeta('safety', userId));
      await restoreRevision(revisionId);
      await refresh();
    },
    [createRevision, refresh, restoreRevision, userId],
  );

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return { days, isLoading, error, refresh, nameCurrentVersion, restore };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- use-revision-history`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/history/use-revision-history.ts \
        packages/frontend/src/components/history/__tests__/use-revision-history.test.ts
git commit -m "Add the revision history hook over Yorkie's useRevisions"
```

---

### Task 4: The history panel component

**Files:**
- Create: `packages/frontend/src/components/history/history-panel.tsx`
- Test: `packages/frontend/src/components/history/__tests__/history-panel.test.tsx`
- Read first (for the panel's markup conventions): `packages/frontend/src/components/comments/` and an existing right-slot panel in `packages/frontend/src/app/slides/`

**Interfaces:**
- Consumes: `useRevisionHistory` (Task 3), `TimelineDay`/`TimelineEntry` (Task 2).
- Produces:
  - `function HistoryPanel(props: { userId: number; onClose: () => void; onPreview: (revisionId: string) => void }): JSX.Element`

Rules the tests pin, because they are the ones easy to get wrong:
- an automatic entry renders a time and **no author**;
- restore is behind a confirmation that names the comment consequence;
- a load error renders as an error, never as "No versions yet".

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from '../history-panel';

const restore = vi.fn();
const nameCurrentVersion = vi.fn();
let hookState: Record<string, unknown>;

vi.mock('../use-revision-history', () => ({
  useRevisionHistory: () => hookState,
}));

const baseState = {
  isLoading: false,
  error: null,
  refresh: vi.fn(),
  nameCurrentVersion,
  restore,
  days: [
    {
      dayKey: '2026-09-02',
      entries: [
        {
          id: 'n1',
          label: 'Launch copy',
          createdAt: new Date('2026-09-02T10:00:00Z'),
          meta: { kind: 'named', by: 42 },
        },
        {
          id: 'a1',
          label: 'snapshot-503',
          createdAt: new Date('2026-09-02T09:00:00Z'),
          meta: { kind: 'automatic' },
        },
      ],
    },
  ],
};

const renderPanel = () =>
  render(<HistoryPanel userId={42} onClose={vi.fn()} onPreview={vi.fn()} />);

describe('HistoryPanel', () => {
  it('shows a named version by its name', () => {
    hookState = { ...baseState };
    renderPanel();
    expect(screen.getByText('Launch copy')).toBeInTheDocument();
  });

  // Yorkie's automatic revisions have no author and a machine label. Showing
  // either would be inventing information.
  it('shows an automatic version without its raw label or an author', () => {
    hookState = { ...baseState };
    renderPanel();
    expect(screen.queryByText('snapshot-503')).not.toBeInTheDocument();
    expect(screen.getByText(/Automatic/i)).toBeInTheDocument();
  });

  it('asks for confirmation before restoring and says comments ride along', async () => {
    hookState = { ...baseState };
    renderPanel();
    await userEvent.click(screen.getAllByRole('button', { name: /restore/i })[0]);
    expect(screen.getByText(/comments/i)).toBeInTheDocument();
    expect(restore).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^restore this version$/i }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith('n1'));
  });

  it('renders a load failure as an error, not as an empty timeline', () => {
    hookState = { ...baseState, days: [], error: new Error('denied') };
    renderPanel();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/no versions yet/i)).not.toBeInTheDocument();
  });

  it('shows the empty state only when the load succeeded with nothing', () => {
    hookState = { ...baseState, days: [], error: null };
    renderPanel();
    expect(screen.getByText(/no versions yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- history-panel`
Expected: FAIL — cannot resolve `../history-panel`.

- [ ] **Step 3: Write the component**

Build it from the repo's existing primitives in `packages/frontend/src/components/ui/` (Button, ScrollArea, AlertDialog) and match the comments side panel's container markup. Requirements the tests encode:

- header with a title and a close button calling `onClose`;
- a "Name current version" control that calls `nameCurrentVersion(label)`;
- one section per `TimelineDay`, its heading formatted from `dayKey`;
- per entry: `meta.kind === 'automatic'` renders the localized time plus the word "Automatic" and never `entry.label`; otherwise renders `entry.label`;
- per entry: Preview → `onPreview(entry.id)`, Restore → an `AlertDialog` whose body states that comments in the document are part of the restored version, whose confirm button is labelled exactly "Restore this version" and calls `restore(entry.id)`;
- `error` renders an element with `role="alert"`; the empty state renders only when `error` is null and `days` is empty; `isLoading` renders the shared `Loader`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- history-panel`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/history/history-panel.tsx \
        packages/frontend/src/components/history/__tests__/history-panel.test.tsx
git commit -m "Add the version history panel"
```

---

### Task 5: Undo-stack reset on restore

**Files:**
- Modify: `packages/frontend/src/components/history/use-revision-history.ts`
- Test: `packages/frontend/src/components/history/__tests__/use-revision-history.test.ts`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: `useRevisionHistory` gains an `onRestored?: () => void` option, invoked after a successful restore and before the refresh.

A restore replaces the whole root. Docs delegate undo to Yorkie `doc.history` and slides to their native undo stack; both then describe reverse operations against a root that no longer exists. Each editor passes `onRestored` to clear its undo stack, selection and caret.

- [ ] **Step 1: Write the failing test**

```ts
it('notifies the editor after a restore so it can drop its undo stack', async () => {
  const onRestored = vi.fn();
  const { result } = renderHook(() =>
    useRevisionHistory({ enabled: true, userId: 42, onRestored }),
  );
  await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
  await act(() => result.current.restore('a'));
  expect(onRestored).toHaveBeenCalledTimes(1);
});

it('does not notify when the restore failed', async () => {
  const onRestored = vi.fn();
  restoreRevision.mockRejectedValue(new Error('denied'));
  const { result } = renderHook(() =>
    useRevisionHistory({ enabled: true, userId: 42, onRestored }),
  );
  await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
  await act(async () => {
    await expect(result.current.restore('a')).rejects.toThrow('denied');
  });
  expect(onRestored).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- use-revision-history`
Expected: FAIL — `onRestored` never called.

- [ ] **Step 3: Implement**

```ts
export function useRevisionHistory({
  enabled,
  userId,
  onRestored,
}: {
  enabled: boolean;
  userId: number;
  /**
   * Called after a successful restore. A restore replaces the whole root, so
   * the editor must drop its undo stack, selection and caret: they describe a
   * document that no longer exists.
   */
  onRestored?: () => void;
}) {
  // ...
  const restore = useCallback(
    async (revisionId: string) => {
      await createRevision(SAFETY_LABEL, writeRevisionMeta('safety', userId));
      await restoreRevision(revisionId);
      onRestored?.();
      await refresh();
    },
    [createRevision, onRestored, refresh, restoreRevision, userId],
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- use-revision-history`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/history/use-revision-history.ts \
        packages/frontend/src/components/history/__tests__/use-revision-history.test.ts
git commit -m "Reset editor state after a revision restore"
```

---

### Task 6: Auth-webhook verbs for the revision RPCs

**Files:**
- Modify: `packages/backend/src/document/yorkie-auth.controller.spec.ts`
- Modify (only if the tests below fail): `packages/backend/src/document/yorkie-auth.controller.ts`
- Modify: `packages/backend/README.md` (the `yorkie project update` block in the auth-webhook section)

**Interfaces:**
- Consumes: `YorkieAuthController.decide()` as it exists.
- Produces: no new exports — this task pins behavior and documents operator steps.

`decide()` already falls unknown methods through to `checkAttribute`, so this is expected to pass without production changes. Pin it anyway: the whole feature's authorization rests on that fall-through, and a future refactor that adds a method allow-list would silently open it.

- [ ] **Step 1: Write the failing test**

Add to the existing spec, following its established harness for building a controller and tokens:

```ts
describe('revision methods', () => {
  it.each([
    ['ListRevisions', 'r'],
    ['GetRevision', 'r'],
    ['CreateRevision', 'rw'],
    ['RestoreRevision', 'rw'],
  ])('allows a workspace member on %s (%s)', async (method, verb) => {
    const decision = await controller.decide({
      token: memberToken,
      method,
      attributes: [{ key: `doc-${documentId}`, verb: verb as 'r' | 'rw' }],
    });
    expect(decision.allowed).toBe(true);
  });

  // The regression this whole feature exists behind: a viewer share link must
  // never be able to roll a document back or read its history.
  it.each(['CreateRevision', 'RestoreRevision'])(
    'denies a viewer share link on %s',
    async (method) => {
      const decision = await controller.decide({
        token: viewerShareToken,
        method,
        attributes: [{ key: `doc-${documentId}`, verb: 'rw' }],
      });
      expect(decision).toMatchObject({ allowed: false, status: 403 });
    },
  );

  it('denies an unknown document key on ListRevisions', async () => {
    const decision = await controller.decide({
      token: memberToken,
      method: 'ListRevisions',
      attributes: [{ key: 'not-a-doc-key', verb: 'r' }],
    });
    expect(decision.allowed).toBe(false);
  });

  it('denies a revision method carrying no document attributes', async () => {
    const decision = await controller.decide({
      token: memberToken,
      method: 'RestoreRevision',
      attributes: [],
    });
    expect(decision).toMatchObject({ allowed: false, status: 403 });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @wafflebase/backend test -- yorkie-auth`
Expected: PASS without production changes. If any case fails, fix `yorkie-auth.controller.ts` so it passes — do not weaken the test.

- [ ] **Step 3: Document the operator step**

In `packages/backend/README.md`, extend the `yorkie project update` example with the four methods and add a sentence that a deployment registering them while `YORKIE_AUTH_WEBHOOK_ENFORCE=false` is still unprotected, because shadow mode allows every request:

```bash
  --auth-webhook-method-add ListRevisions \
  --auth-webhook-method-add GetRevision \
  --auth-webhook-method-add CreateRevision \
  --auth-webhook-method-add RestoreRevision \
```

- [ ] **Step 4: Verify the docs gates**

Run: `pnpm verify:doc-links && pnpm verify:doc-index`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/document/yorkie-auth.controller.spec.ts \
        packages/backend/README.md
git commit -m "Pin auth-webhook verbs for the Yorkie revision RPCs"
```

---

### Task 7: Wire the panel into the five editors behind a flag

**Files:**
- Modify: `packages/frontend/src/app/documents/document-detail.tsx` (sheet)
- Modify: `packages/frontend/src/app/docs/docs-detail.tsx`
- Modify: `packages/frontend/src/app/slides/slides-detail.tsx`
- Modify: `packages/frontend/src/app/notes/notes-detail.tsx`
- Modify: `packages/frontend/src/app/board/board-detail.tsx`
- Create: `packages/frontend/src/components/history/history-enabled.ts`
- Test: `packages/frontend/src/components/history/__tests__/history-enabled.test.ts`

**Interfaces:**
- Consumes: `HistoryPanel` (Task 4).
- Produces: `function isHistoryEnabled(env: { VITE_WB_REVISION_HISTORY?: string }, role: 'viewer' | 'editor' | 'member'): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { isHistoryEnabled } from '../history-enabled';

describe('isHistoryEnabled', () => {
  it('is off without the flag', () => {
    expect(isHistoryEnabled({}, 'member')).toBe(false);
  });

  it('is on for a member with the flag', () => {
    expect(isHistoryEnabled({ VITE_WB_REVISION_HISTORY: 'true' }, 'member')).toBe(true);
  });

  it('is on for a share-link editor with the flag', () => {
    expect(isHistoryEnabled({ VITE_WB_REVISION_HISTORY: 'true' }, 'editor')).toBe(true);
  });

  // Google Docs does not show version history to viewers, and until upstream
  // gates the RPCs, showing it would hand them a restore button.
  it('is off for a viewer even with the flag', () => {
    expect(isHistoryEnabled({ VITE_WB_REVISION_HISTORY: 'true' }, 'viewer')).toBe(false);
  });

  it('treats any value other than "true" as off', () => {
    expect(isHistoryEnabled({ VITE_WB_REVISION_HISTORY: '1' }, 'member')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- history-enabled`
Expected: FAIL — cannot resolve `../history-enabled`.

- [ ] **Step 3: Implement and wire**

```ts
/**
 * Whether to offer version history. Off by default: until Yorkie gates the
 * revision RPCs behind the auth webhook, any attached client can restore, so
 * the feature ships dark. Viewers never see it — Google Docs does not show
 * version history to viewers either.
 */
export function isHistoryEnabled(
  env: { VITE_WB_REVISION_HISTORY?: string },
  role: 'viewer' | 'editor' | 'member',
): boolean {
  if (env.VITE_WB_REVISION_HISTORY !== 'true') return false;
  return role !== 'viewer';
}
```

Then in each of the five detail components: add a `Version history` item to the document header menu, gated on `isHistoryEnabled(import.meta.env, role)`; hold `historyOpen` state; render `<HistoryPanel …/>` in the same right slot the existing panels use; pass `onRestored` to that editor's store to clear its undo stack, selection and caret.

- [ ] **Step 4: Run the frontend suite**

Run: `pnpm --filter @wafflebase/frontend test`
Expected: PASS, including the pre-existing detail-component tests.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src
git commit -m "Offer version history from every CRDT editor behind a flag"
```

---

### Task 8: Yorkie-attached integration coverage

**Files:**
- Create: `packages/backend/test/revision-history.e2e-spec.ts`

**Interfaces:**
- Consumes: the same `RUN_YORKIE_INTEGRATION_TESTS` gate and attach helpers as `packages/backend/test/docs-tree-attached.e2e-spec.ts`.
- Produces: no exports.

These are the assertions that cannot be mocked: that a restore actually converges for a second attached client, and that a read-only client is refused. **The read-only test is expected to FAIL until upstream ask 1 lands** — write it, watch it fail, and mark it `it.skip` with a comment naming the upstream issue. That skip is the tracking mechanism; unskipping it is how we learn the fix arrived.

- [ ] **Step 1: Write the round-trip test**

```ts
it('round-trips create → list → get → restore', async () => {
  const doc = await attach(`sheet-${documentId}`);
  doc.update((root) => { root.marker = 'first'; });
  await client.sync();

  const created = await client.createRevision(doc, 'v1', '{"v":1,"by":1,"kind":"named"}');
  doc.update((root) => { root.marker = 'second'; });
  await client.sync();

  const listed = await client.listRevisions(doc, { pageSize: 10 });
  expect(listed.map((r) => r.id)).toContain(created.id);
  // listRevisions omits snapshot bodies; only getRevision carries them.
  expect(listed.find((r) => r.id === created.id)?.snapshot ?? '').toBe('');

  const full = await client.getRevision(doc, created.id);
  expect(full.snapshot).toContain('first');

  await client.restoreRevision(doc, created.id);
  await client.sync();
  expect(doc.getRoot().marker).toBe('first');
});
```

- [ ] **Step 2: Write the convergence test**

```ts
it('converges a second attached client onto the restored state', async () => {
  const docA = await attach(`sheet-${documentId}`, clientA);
  const docB = await attach(`sheet-${documentId}`, clientB);

  docA.update((root) => { root.marker = 'first'; });
  await clientA.sync();
  const rev = await clientA.createRevision(docA, 'v1', '');

  docA.update((root) => { root.marker = 'second'; });
  await clientA.sync();
  await clientB.sync();
  expect(docB.getRoot().marker).toBe('second');

  await clientA.restoreRevision(docA, rev.id);
  await clientA.sync();
  await clientB.sync();
  expect(docB.getRoot().marker).toBe('first');
});
```

- [ ] **Step 3: Write the read-only refusal test, watch it fail, then skip it**

```ts
// Expected to fail until yorkie gates the revision RPCs behind the auth
// webhook: a readOnly attachment can currently list, read and restore.
// Unskip when that lands — this failing is the signal that it has not.
it.skip('refuses a read-only client', async () => {
  const doc = await attach(`sheet-${documentId}`, viewerClient, { readOnly: true });
  await expect(client.restoreRevision(doc, someRevisionId)).rejects.toThrow();
});
```

- [ ] **Step 4: Run the gated suite**

Run:
```bash
docker compose up -d
RUN_DB_INTEGRATION_TESTS=true RUN_YORKIE_INTEGRATION_TESTS=true \
  pnpm --filter @wafflebase/backend test:e2e -- revision-history
```
Expected: 2 passing, 1 skipped. If the local `.env` breaks the attach with "project not found", override `YORKIE_PUBLIC_KEY` to empty to use the docker default.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/test/revision-history.e2e-spec.ts
git commit -m "Cover revision restore convergence against a live Yorkie"
```

---

## Phase B — preview (sheets, slides, board, notes)

Docs is excluded: `YSON.parse` cannot read its snapshots (Global Constraints). Phase B is independent of Phase A's tasks 6–8 and can proceed in parallel with the upstream work.

### Task 9: Snapshot adapters

**Files:**
- Create: `packages/frontend/src/components/history/snapshot-adapters.ts`
- Test: `packages/frontend/src/components/history/__tests__/snapshot-adapters.test.ts`
- Create fixtures: `packages/frontend/src/components/history/__tests__/fixtures/{sheet,slides,note}.yson.txt`

**Interfaces:**
- Consumes: `YSON` from `@yorkie-js/sdk`.
- Produces:
  - `function parseSheetSnapshot(snapshot: string): SpreadsheetDocument`
  - `function parseSlidesSnapshot(snapshot: string): SlidesDocument`
  - `function parseBoardSnapshot(snapshot: string): SlidesDocument`
  - `function parseNoteSnapshot(snapshot: string): string`

A parsed snapshot is already plain JSON for sheets, slides and board — the backend's `read*Root` helpers exist to unwrap *live* Yorkie proxies and are not needed here. Notes need `YSON.textToString`.

Capture the fixtures from the real local server rather than hand-writing them, so the tests pin the actual wire format:

```bash
# with docker compose up, against a document of each type
node scratch/capture-fixture.mjs sheet-<id> > .../fixtures/sheet.yson.txt
```

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseNoteSnapshot,
  parseSheetSnapshot,
  parseSlidesSnapshot,
} from '../snapshot-adapters';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', `${name}.yson.txt`), 'utf8');

describe('parseSheetSnapshot', () => {
  // SpreadsheetDocument is { tabs, tabOrder, sheets } — see
  // packages/sheets/src/model/workbook/worksheet-document.ts.
  it('reads tabs and their worksheets out of a captured snapshot', () => {
    const doc = parseSheetSnapshot(fixture('sheet'));
    expect(doc.tabOrder.length).toBeGreaterThan(0);
    expect(Object.keys(doc.sheets[doc.tabOrder[0]].cells).length).toBeGreaterThan(0);
  });
});

describe('parseSlidesSnapshot', () => {
  it('reads slides out of a captured snapshot', () => {
    expect(parseSlidesSnapshot(fixture('slides')).slides.length).toBeGreaterThan(0);
  });
});

describe('parseNoteSnapshot', () => {
  it('flattens the Text CRDT back to markdown', () => {
    expect(parseNoteSnapshot('{"content":Text([{"val":"# hello"}])}')).toBe('# hello');
  });

  it('returns empty for a note whose content was never written', () => {
    expect(parseNoteSnapshot('{}')).toBe('');
  });
});

// The parser is regex-based upstream and silently loses whole document types.
// This test is the tripwire that tells us which types are still readable.
describe('YSON parse limits', () => {
  it('cannot yet read a docs tree, and says so loudly when that changes', () => {
    const docsSnapshot =
      '{"content":Tree({"type":"doc","children":[{"type":"block","children":' +
      '[{"type":"inline","children":[{"type":"text","value":"a"}]}]}]})}';
    expect(() => parseSheetSnapshot(docsSnapshot)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- snapshot-adapters`
Expected: FAIL — cannot resolve `../snapshot-adapters`.

- [ ] **Step 3: Implement**

```ts
import { YSON } from '@yorkie-js/sdk';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import type { SlidesDocument } from '@wafflebase/slides';

/**
 * A revision snapshot is YSON: JSON plus constructor-wrapped CRDT values
 * (`Text([...])`, `Tree({...})`). For sheets, slides and board the root is
 * plain JSON, so parsing is the whole conversion — the backend's `read*Root`
 * helpers exist to unwrap *live* Yorkie proxies and have no job here.
 *
 * `YSON.parse` throws on any document whose tree nests deeper than three
 * levels, which is every docs document. Callers must handle that.
 */
export function parseSheetSnapshot(snapshot: string): SpreadsheetDocument {
  return YSON.parse<SpreadsheetDocument>(snapshot);
}

export function parseSlidesSnapshot(snapshot: string): SlidesDocument {
  return YSON.parse<SlidesDocument>(snapshot);
}

/** A board is one synthetic slide, so it shares the slides shape. */
export const parseBoardSnapshot = parseSlidesSnapshot;

export function parseNoteSnapshot(snapshot: string): string {
  const root = YSON.parse<{ content?: YSON.Text }>(snapshot);
  return root.content ? YSON.textToString(root.content) : '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- snapshot-adapters`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/history/snapshot-adapters.ts \
        packages/frontend/src/components/history/__tests__
git commit -m "Parse revision snapshots into engine document models"
```

---

### Task 10: Bulk-load a sheet model into `MemStore`

**Files:**
- Modify: `packages/sheets/src/store/memory.ts`
- Test: `packages/sheets/src/store/__tests__/memory-load.test.ts` (follow the directory convention already used in `packages/sheets/src`)

**Interfaces:**
- Consumes: `getWorksheetEntries` from `packages/sheets/src/model/workbook/worksheet-grid.ts`.
- Produces: `MemStore.load(ws: Worksheet): void` — replaces grid, dimensions, styles, merges, conditional formats, validations, freeze and filter state in one call.

Two shape facts to hold on to (`packages/sheets/src/model/workbook/worksheet-document.ts`):

- A `Worksheet` stores `cells` keyed by **axis id**, with `rowOrder` / `colOrder` giving the id→index mapping — while `MemStore`'s grid is `Map<Sref, Cell>`, keyed by A1 reference. `getWorksheetEntries(ws)` performs exactly that resolution; do not re-derive it.
- `rowHeights` / `colWidths` / `rowStyles` / `colStyles` are objects keyed by axis id, and `MemStore` holds them as `Map<number, …>` keyed by index — so they need the same resolution, not a straight copy.

`MemStore`'s constructor takes only a `Grid`; everything else is private with no bulk setter, so a preview built through the async `Store` API would be both slow and incomplete. `packages/frontend/src/app/harness/visual/sheet-scenarios.tsx` is the existing pattern for standing up a read-only sheet and shows what a preview needs.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { MemStore } from '../memory';
import type { Worksheet } from '../../model/workbook/worksheet-document';

/** A minimal Worksheet: two rows, two columns, one cell at B2. */
const worksheet = (over: Partial<Worksheet> = {}): Worksheet => ({
  cells: { 'r2:c2': { v: 'fresh' } },
  rowOrder: ['r1', 'r2'],
  colOrder: ['c1', 'c2'],
  nextRowId: 3,
  nextColId: 3,
  rowHeights: {},
  colWidths: {},
  rowStyles: {},
  colStyles: {},
  frozenRows: 0,
  frozenCols: 0,
  ...over,
});

describe('MemStore.load', () => {
  it('resolves axis-id cells to A1 refs and replaces the grid wholesale', async () => {
    const store = new MemStore(new Map([['A1', { v: 'stale' }]]));
    store.load(worksheet());
    expect(await store.get({ r: 2, c: 2 })).toEqual({ v: 'fresh' });
    expect(await store.has({ r: 1, c: 1 })).toBe(false);
  });

  it('resolves dimensions by axis id and loads the freeze pane', async () => {
    const store = new MemStore();
    store.load(worksheet({ rowHeights: { r2: 40 }, colWidths: { c2: 120 }, frozenRows: 1, frozenCols: 2 }));
    expect(await store.getRowHeight(2)).toBe(40);
    expect(await store.getColWidth(2)).toBe(120);
    expect(await store.getFreezePane()).toEqual({ frozenRows: 1, frozenCols: 2 });
  });

  // A load is a replace, not a merge: previewing version B after version A
  // must not leave A's freeze pane behind.
  it('clears state the incoming worksheet does not carry', async () => {
    const store = new MemStore();
    store.load(worksheet({ frozenRows: 3 }));
    store.load(worksheet());
    expect(await store.getFreezePane()).toEqual({ frozenRows: 0, frozenCols: 0 });
  });
});
```

Confirm the axis-id key format used by `cells` against `getWorksheetEntries` before running; the fixture above assumes `<rowId>:<colId>`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/sheets test -- memory-load`
Expected: FAIL — `store.load is not a function`.

- [ ] **Step 3: Implement `load`**

```ts
/**
 * Replace every piece of worksheet state in one call.
 *
 * Exists for revision preview: a snapshot arrives as a whole `Worksheet`,
 * and driving the async `Store` API cell by cell would be both slow and
 * unable to reach the private style/merge/freeze state at all.
 *
 * A replace, not a merge — anything absent from `ws` is cleared, so
 * previewing one version after another cannot leak the first one's state.
 */
load(ws: Worksheet): void {
  this.grid = new Map(getWorksheetEntries(ws));
  this.rowHeights = resolveByAxis(ws.rowHeights, ws.rowOrder);
  this.colWidths = resolveByAxis(ws.colWidths, ws.colOrder);
  this.rowStyles = resolveByAxis(ws.rowStyles, ws.rowOrder);
  this.colStyles = resolveByAxis(ws.colStyles, ws.colOrder);
  this.sheetStyle = ws.sheetStyle;
  this.rangeStyles = ws.rangeStyles ?? [];
  this.conditionalFormats = ws.conditionalFormats ?? [];
  this.dataValidations = ws.dataValidations ?? [];
  this.merges = new Map(Object.entries(ws.merges ?? {}));
  this.filterState = ws.filter;
  this.frozenRows = ws.frozenRows;
  this.frozenCols = ws.frozenCols;
  this.threads = new Map(Object.entries(ws.comments ?? {}));
  this.rebuildIndex();
}
```

Add the private helper next to it, mapping an axis-id-keyed record onto 1-based indices:

```ts
function resolveByAxis<T>(record: { [id: string]: T }, order: string[]): Map<number, T> {
  const out = new Map<number, T>();
  for (const [id, value] of Object.entries(record)) {
    const index = order.indexOf(id);
    if (index >= 0) out.set(index + 1, value);
  }
  return out;
}
```

Set `hiddenState` from `ws.hiddenRows` / `ws.hiddenColumns` in whatever shape the existing private field uses — read its declaration rather than assuming.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @wafflebase/sheets test`
Expected: PASS, including the existing 1626 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/sheets/src/store/memory.ts packages/sheets/src/store/__tests__/memory-load.test.ts
git commit -m "Let MemStore load a whole worksheet at once"
```

---

### Task 11: The preview surface

**Files:**
- Create: `packages/frontend/src/components/history/revision-preview.tsx`
- Test: `packages/frontend/src/components/history/__tests__/revision-preview.test.tsx`
- Modify: the five detail components from Task 7 to render the preview and pass `onPreview`

**Interfaces:**
- Consumes: `parseSheetSnapshot` / `parseSlidesSnapshot` / `parseBoardSnapshot` / `parseNoteSnapshot` (Task 9); `MemStore.load` (Task 10); `useRevisions().getRevision`.
- Produces: `function RevisionPreview(props: { revisionId: string; type: 'sheet' | 'slides' | 'board' | 'note'; onRestore: () => void; onBack: () => void }): JSX.Element`

A banner over the document's own viewer, not a modal — four of five engines are canvas and a canvas in a dialog loses the scroll, zoom and pan the viewer already implements.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RevisionPreview } from '../revision-preview';

const getRevision = vi.fn();
vi.mock('@yorkie-js/react', () => ({ useRevisions: () => ({ getRevision }) }));

describe('RevisionPreview', () => {
  it('announces that this is a past version, with its time', async () => {
    getRevision.mockResolvedValue({
      id: 'r1', label: 'v1', description: '', createdAt: new Date('2026-09-02T10:00:00Z'),
      snapshot: '{"worksheets":{}}',
    });
    render(
      <RevisionPreview revisionId="r1" type="sheet" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
  });

  // A snapshot this build cannot parse must say so. Rendering an empty
  // document would read as "this version was blank".
  it('reports an unreadable snapshot instead of rendering an empty document', async () => {
    getRevision.mockResolvedValue({
      id: 'r2', label: 'v2', description: '', createdAt: new Date(),
      snapshot: '{"content":Tree({"type":"doc","children":[{"type":"block","children":[{"type":"inline","children":[{"type":"text","value":"a"}]}]}]})}',
    });
    render(
      <RevisionPreview revisionId="r2" type="sheet" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- revision-preview`
Expected: FAIL — cannot resolve `../revision-preview`.

- [ ] **Step 3: Implement**

Fetch with `getRevision(revisionId)`, parse with the Task 9 adapter for `type`, hydrate the matching in-memory store (`MemStore.load` for sheet, `MemSlidesStore` for slides and board, the note string straight into the read-only CodeMirror view), and mount the engine's existing viewer read-only. Render a `role="status"` banner carrying the version's time and the Back / Restore buttons; render `role="alert"` when the adapter throws.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @wafflebase/frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src
git commit -m "Preview a revision in the document's own viewer"
```

---

### Task 12: Record what shipped and what did not

**Files:**
- Modify: `docs/tasks/active/20260902-revision-history-todo.md`
- Modify: `docs/tasks/active/20260902-revision-history-lessons.md`
- Modify: `docs/design/revision-history.md` if the implementation diverged from it

- [ ] **Step 1:** Tick every completed box in the todo; leave the upstream boxes unticked and add issue links once filed.
- [ ] **Step 2:** Fill in the todo's Review section: what shipped, that docs preview did not and why, and the flag's state per environment.
- [ ] **Step 3:** Append to the lessons file anything the implementation taught that the plan got wrong.
- [ ] **Step 4:** Run `pnpm verify:fast` and `pnpm tasks:index`.
- [ ] **Step 5:** Commit.

```bash
git add docs/
git commit -m "Record revision history results and open follow-ups"
```

---

## Out of scope for this plan

Tracked in the todo file, not here:

- **Upstream Yorkie work** — auth-webhook gating (blocks production), the `YSON.parse` tokenizer (blocks docs preview), recording a revision's actor, and revision retention plus a delete RPC. Different repository.
- **Docs preview** — blocked on the tokenizer. When it lands: extract `treeNodeToBlock` from `packages/backend/src/yorkie/docs-tree.ts` into `@wafflebase/docs` (its own header already proposes this), add a `parseDocsSnapshot`, and extend Task 11's `type` union.
- **Retention** — measure real growth with `getDocSize()` before enabling broadly. One full snapshot per 500 changes, no delete RPC, sheets at ~7 MB.
- **Change highlighting and "make a copy of a version"** — Non-Goals in the design.
