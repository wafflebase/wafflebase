# Sheet Cell Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Sheets-style threaded cell comments (phase B) — multi-thread per cell, resolve/reopen, side panel, anchored to stable axis IDs.

**Architecture:** Data model in `packages/sheets/src/comment/` (no Yorkie dep). Yorkie schema extends `Worksheet.comments?` field. Frontend owns the Yorkie boundary, canvas marker rendering, and React UI. `CommentAnchor` is a discriminated union from day one for future Docs/Slides extraction.

**Tech Stack:** TypeScript, Vitest (sheets tests), Node test runner (frontend tests), Yorkie array CRDT, Canvas 2D, React.

**Spec:** `docs/design/sheets/comments.md`

---

### Task 1: Comment data model & pure helpers (sheets package)

Create the core types and pure thread-mutation helpers, all non-Yorkie. TDD-driven.

**Files:**
- Create: `packages/sheets/src/comment/types.ts`
- Create: `packages/sheets/src/comment/thread.ts`
- Create: `packages/sheets/src/comment/__tests__/thread.test.ts`
- Create: `packages/sheets/src/comment/index.ts`

- [ ] **Step 1: Write the failing tests for thread helpers**

Create `packages/sheets/src/comment/__tests__/thread.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  createThread,
  addReply,
  editComment,
  deleteComment,
  setThreadResolved,
} from '../thread';
import type { CommentAnchor, CommentAuthor } from '../types';

const author1: CommentAuthor = { userId: 'u1', username: 'alice' };
const author2: CommentAuthor = { userId: 'u2', username: 'bob' };
const anchor: CommentAnchor = {
  kind: 'sheet-cell',
  tabId: 't1',
  rowId: 'r1',
  colId: 'c1',
};

describe('createThread', () => {
  it('creates a thread with one root comment', () => {
    const t = createThread(anchor, 'hello', author1, () => 'tid', () => 'cid', () => 1000);
    expect(t.id).toBe('tid');
    expect(t.anchor).toEqual(anchor);
    expect(t.resolved).toBe(false);
    expect(t.createdAt).toBe(1000);
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0]).toEqual({
      id: 'cid',
      author: author1,
      body: 'hello',
      createdAt: 1000,
    });
  });

  it('rejects empty body after trim', () => {
    expect(() =>
      createThread(anchor, '   \n  ', author1, () => 'tid', () => 'cid', () => 1000),
    ).toThrow(/empty/i);
  });

  it('preserves newlines in body', () => {
    const t = createThread(anchor, 'a\nb', author1, () => 'tid', () => 'cid', () => 1000);
    expect(t.comments[0].body).toBe('a\nb');
  });
});

describe('addReply', () => {
  it('appends a reply comment', () => {
    let t = createThread(anchor, 'root', author1, () => 'tid', () => 'c0', () => 1000);
    t = addReply(t, 'reply', author2, () => 'c1', () => 2000);
    expect(t.comments).toHaveLength(2);
    expect(t.comments[1]).toEqual({
      id: 'c1',
      author: author2,
      body: 'reply',
      createdAt: 2000,
    });
  });

  it('rejects empty body', () => {
    const t = createThread(anchor, 'root', author1, () => 'tid', () => 'c0', () => 1000);
    expect(() => addReply(t, '  ', author2, () => 'c1', () => 2000)).toThrow(/empty/i);
  });
});

describe('editComment', () => {
  it('updates body and stamps editedAt', () => {
    let t = createThread(anchor, 'old', author1, () => 'tid', () => 'c0', () => 1000);
    t = editComment(t, 'c0', 'new', () => 5000);
    expect(t.comments[0].body).toBe('new');
    expect(t.comments[0].editedAt).toBe(5000);
  });

  it('throws for unknown commentId', () => {
    const t = createThread(anchor, 'x', author1, () => 'tid', () => 'c0', () => 1000);
    expect(() => editComment(t, 'missing', 'new', () => 2000)).toThrow(/not found/i);
  });
});

describe('deleteComment', () => {
  it('returns null when root deleted (signals thread delete)', () => {
    const t = createThread(anchor, 'root', author1, () => 'tid', () => 'c0', () => 1000);
    expect(deleteComment(t, 'c0')).toBeNull();
  });

  it('removes a reply but keeps the thread', () => {
    let t = createThread(anchor, 'root', author1, () => 'tid', () => 'c0', () => 1000);
    t = addReply(t, 'reply', author2, () => 'c1', () => 2000);
    const result = deleteComment(t, 'c1');
    expect(result).not.toBeNull();
    expect(result!.comments).toHaveLength(1);
    expect(result!.comments[0].id).toBe('c0');
  });
});

describe('setThreadResolved', () => {
  it('marks resolved with author and timestamp', () => {
    let t = createThread(anchor, 'x', author1, () => 'tid', () => 'c0', () => 1000);
    t = setThreadResolved(t, true, author2, () => 5000);
    expect(t.resolved).toBe(true);
    expect(t.resolvedAt).toBe(5000);
    expect(t.resolvedBy).toEqual(author2);
  });

  it('clears resolution on reopen', () => {
    let t = createThread(anchor, 'x', author1, () => 'tid', () => 'c0', () => 1000);
    t = setThreadResolved(t, true, author2, () => 5000);
    t = setThreadResolved(t, false, author1, () => 6000);
    expect(t.resolved).toBe(false);
    expect(t.resolvedAt).toBeUndefined();
    expect(t.resolvedBy).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail with module-not-found**

```bash
pnpm sheets test src/comment/__tests__/thread.test.ts
```

Expected: FAIL — `Cannot find module '../thread'`

- [ ] **Step 3: Create types.ts**

`packages/sheets/src/comment/types.ts`:

```typescript
export type CommentAuthor = {
  userId: string;
  username: string;
  photo?: string;
};

export type CommentAnchor =
  | { kind: 'sheet-cell'; tabId: string; rowId: string; colId: string };

export type Comment = {
  id: string;
  author: CommentAuthor;
  body: string;
  createdAt: number;
  editedAt?: number;
};

export type Thread = {
  id: string;
  anchor: CommentAnchor;
  comments: Comment[];
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: CommentAuthor;
  createdAt: number;
};
```

- [ ] **Step 4: Create thread.ts with the helpers**

`packages/sheets/src/comment/thread.ts`:

```typescript
import type { Comment, CommentAnchor, CommentAuthor, Thread } from './types';

function assertNonEmpty(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new Error('Comment body cannot be empty');
  }
  return body; // preserve newlines / leading-trailing spaces inside non-empty content
}

export function createThread(
  anchor: CommentAnchor,
  body: string,
  author: CommentAuthor,
  newThreadId: () => string,
  newCommentId: () => string,
  now: () => number,
): Thread {
  const text = assertNonEmpty(body);
  const ts = now();
  return {
    id: newThreadId(),
    anchor,
    resolved: false,
    createdAt: ts,
    comments: [{ id: newCommentId(), author, body: text, createdAt: ts }],
  };
}

export function addReply(
  thread: Thread,
  body: string,
  author: CommentAuthor,
  newCommentId: () => string,
  now: () => number,
): Thread {
  const text = assertNonEmpty(body);
  const reply: Comment = { id: newCommentId(), author, body: text, createdAt: now() };
  return { ...thread, comments: [...thread.comments, reply] };
}

export function editComment(
  thread: Thread,
  commentId: string,
  body: string,
  now: () => number,
): Thread {
  const text = assertNonEmpty(body);
  const idx = thread.comments.findIndex((c) => c.id === commentId);
  if (idx < 0) throw new Error(`Comment not found: ${commentId}`);
  const next = [...thread.comments];
  next[idx] = { ...next[idx], body: text, editedAt: now() };
  return { ...thread, comments: next };
}

/**
 * Returns null when the root comment is deleted — caller should delete the
 * thread entry. Otherwise returns the thread with the reply removed.
 */
export function deleteComment(thread: Thread, commentId: string): Thread | null {
  const idx = thread.comments.findIndex((c) => c.id === commentId);
  if (idx < 0) throw new Error(`Comment not found: ${commentId}`);
  if (idx === 0) return null;
  return { ...thread, comments: thread.comments.filter((c) => c.id !== commentId) };
}

export function setThreadResolved(
  thread: Thread,
  resolved: boolean,
  by: CommentAuthor,
  now: () => number,
): Thread {
  if (resolved) {
    return { ...thread, resolved: true, resolvedAt: now(), resolvedBy: by };
  }
  const { resolvedAt: _a, resolvedBy: _b, ...rest } = thread;
  return { ...rest, resolved: false };
}
```

- [ ] **Step 5: Create index.ts barrel**

`packages/sheets/src/comment/index.ts`:

```typescript
export type { Comment, CommentAnchor, CommentAuthor, Thread } from './types';
export {
  createThread,
  addReply,
  editComment,
  deleteComment,
  setThreadResolved,
} from './thread';
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
pnpm sheets test src/comment/__tests__/thread.test.ts
pnpm sheets typecheck
```

Expected: PASS, typecheck PASS

- [ ] **Step 7: Commit**

```bash
git add packages/sheets/src/comment
git commit -m "Add Comment/Thread data model and pure helpers"
```

---

### Task 2: Anchor ↔ Sref conversion helpers

Map `CellAnchor` (rowId/colId) to/from `Sref` (e.g. "B3") given an axis order.

**Files:**
- Create: `packages/sheets/src/comment/anchor.ts`
- Create: `packages/sheets/src/comment/__tests__/anchor.test.ts`
- Modify: `packages/sheets/src/comment/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/sheets/src/comment/__tests__/anchor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { cellAnchorToSref, isAnchorAlive } from '../anchor';

describe('cellAnchorToSref', () => {
  it('returns the visual Sref for a live anchor', () => {
    const order = { rowOrder: ['r1', 'r2', 'r3'], colOrder: ['cA', 'cB', 'cC'] };
    expect(cellAnchorToSref({ rowId: 'r2', colId: 'cB' }, order)).toBe('B2');
  });

  it('returns null for a deleted rowId', () => {
    const order = { rowOrder: ['r1', 'r2'], colOrder: ['cA'] };
    expect(cellAnchorToSref({ rowId: 'rGone', colId: 'cA' }, order)).toBeNull();
  });

  it('returns null for a deleted colId', () => {
    const order = { rowOrder: ['r1'], colOrder: ['cA', 'cB'] };
    expect(cellAnchorToSref({ rowId: 'r1', colId: 'cGone' }, order)).toBeNull();
  });
});

describe('isAnchorAlive', () => {
  it('true when both axis ids are present', () => {
    const order = { rowOrder: ['r1'], colOrder: ['cA'] };
    expect(isAnchorAlive({ rowId: 'r1', colId: 'cA' }, order)).toBe(true);
  });

  it('false when row is missing', () => {
    const order = { rowOrder: [], colOrder: ['cA'] };
    expect(isAnchorAlive({ rowId: 'r1', colId: 'cA' }, order)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm sheets test src/comment/__tests__/anchor.test.ts
```

Expected: FAIL — `Cannot find module '../anchor'`

- [ ] **Step 3: Implement anchor.ts**

`packages/sheets/src/comment/anchor.ts`:

```typescript
import { toSref } from '../model/core/coordinates';

export type AxisOrder = {
  rowOrder: readonly string[];
  colOrder: readonly string[];
};

export type CellAnchorIds = { rowId: string; colId: string };

export function isAnchorAlive(anchor: CellAnchorIds, order: AxisOrder): boolean {
  return order.rowOrder.includes(anchor.rowId) && order.colOrder.includes(anchor.colId);
}

export function cellAnchorToSref(
  anchor: CellAnchorIds,
  order: AxisOrder,
): string | null {
  const r = order.rowOrder.indexOf(anchor.rowId);
  const c = order.colOrder.indexOf(anchor.colId);
  if (r < 0 || c < 0) return null;
  return toSref({ r: r + 1, c: c + 1 });
}
```

> If `toSref` signature differs in the actual codebase, adapt this function to call the existing `Ref` → `Sref` helper.

- [ ] **Step 4: Add to index.ts barrel**

Append to `packages/sheets/src/comment/index.ts`:

```typescript
export { cellAnchorToSref, isAnchorAlive } from './anchor';
export type { AxisOrder, CellAnchorIds } from './anchor';
```

- [ ] **Step 5: Run tests**

```bash
pnpm sheets test src/comment/__tests__/anchor.test.ts
pnpm sheets typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/sheets/src/comment
git commit -m "Add CellAnchor to Sref conversion helpers"
```

---

### Task 3: Extend Store interface with comment methods

Add the 6 comment methods to the `Store` interface, implement in `MemStore`, and stub in `ReadonlyStore`.

**Files:**
- Modify: `packages/sheets/src/store/store.ts`
- Modify: `packages/sheets/src/store/memory.ts`
- Modify: `packages/sheets/src/store/readonly.ts`
- Create: `packages/sheets/src/store/__tests__/memory-comments.test.ts`

- [ ] **Step 1: Write the failing test against MemStore**

`packages/sheets/src/store/__tests__/memory-comments.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MemStore } from '../memory';
import type { CommentAnchor, CommentAuthor } from '../../comment/types';

const author: CommentAuthor = { userId: 'u1', username: 'alice' };
const anchor: CommentAnchor = {
  kind: 'sheet-cell',
  tabId: 't1',
  rowId: 'r1',
  colId: 'c1',
};

describe('MemStore comments', () => {
  it('creates a thread and lists it back', async () => {
    const store = new MemStore();
    const t = await store.addThread(anchor, 'hi', author);
    const all = await store.listThreads();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(t.id);
    expect(all[0].comments[0].body).toBe('hi');
  });

  it('appends a reply', async () => {
    const store = new MemStore();
    const t = await store.addThread(anchor, 'root', author);
    await store.addReply(t.id, 'reply', author);
    const [thread] = await store.listThreads();
    expect(thread.comments.map((c) => c.body)).toEqual(['root', 'reply']);
  });

  it('deletes thread when root comment is deleted', async () => {
    const store = new MemStore();
    const t = await store.addThread(anchor, 'root', author);
    await store.deleteComment(t.id, t.comments[0].id);
    expect(await store.listThreads()).toEqual([]);
  });

  it('filters by resolved state', async () => {
    const store = new MemStore();
    const t1 = await store.addThread(anchor, 'one', author);
    const t2 = await store.addThread(anchor, 'two', author);
    await store.setThreadResolved(t1.id, true, author);
    expect((await store.listThreads({ resolved: false }))[0].id).toBe(t2.id);
    expect((await store.listThreads({ resolved: true }))[0].id).toBe(t1.id);
  });

  it('filters by cellAnchor', async () => {
    const store = new MemStore();
    const a1 = { ...anchor, rowId: 'r1', colId: 'c1' };
    const a2 = { ...anchor, rowId: 'r2', colId: 'c2' };
    await store.addThread(a1, 'on r1', author);
    await store.addThread(a2, 'on r2', author);
    const onR1 = await store.listThreads({ cellAnchor: { rowId: 'r1', colId: 'c1' } });
    expect(onR1).toHaveLength(1);
    expect(onR1[0].comments[0].body).toBe('on r1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm sheets test src/store/__tests__/memory-comments.test.ts
```

Expected: FAIL — methods do not exist on MemStore.

- [ ] **Step 3: Add the 6 methods to the Store interface**

In `packages/sheets/src/store/store.ts`, add these imports near the top:

```typescript
import type { Comment, CommentAnchor, CommentAuthor, Thread } from '../comment/types';
```

Append to the `Store` interface (before the closing `}`):

```typescript
  /** Create a new thread with a root comment at the anchor. */
  addThread(
    anchor: CommentAnchor,
    body: string,
    author: CommentAuthor,
  ): Promise<Thread>;

  /** Append a reply to an existing thread. */
  addReply(
    threadId: string,
    body: string,
    author: CommentAuthor,
  ): Promise<Comment>;

  /** Edit a comment body. Caller is responsible for author check. */
  editComment(threadId: string, commentId: string, body: string): Promise<void>;

  /** Delete a comment. Deleting comments[0] deletes the whole thread. */
  deleteComment(threadId: string, commentId: string): Promise<void>;

  /** Resolve or reopen a thread. */
  setThreadResolved(
    threadId: string,
    resolved: boolean,
    by: CommentAuthor,
  ): Promise<void>;

  /** Read threads filtered by tab, anchor, or resolved state. */
  listThreads(opts?: {
    tabId?: string;
    cellAnchor?: { rowId: string; colId: string };
    resolved?: boolean;
  }): Promise<Thread[]>;
```

- [ ] **Step 4: Implement in MemStore**

In `packages/sheets/src/store/memory.ts`, add imports:

```typescript
import {
  createThread as createThreadHelper,
  addReply as addReplyHelper,
  editComment as editCommentHelper,
  deleteComment as deleteCommentHelper,
  setThreadResolved as setThreadResolvedHelper,
} from '../comment/thread';
import type { Comment, CommentAnchor, CommentAuthor, Thread } from '../comment/types';
```

Add a private threads field and methods to the class:

```typescript
  private threads: Map<string, Thread> = new Map();
  private threadCounter = 0;
  private commentCounter = 0;

  private newThreadId(): string {
    return `t_${++this.threadCounter}`;
  }
  private newCommentId(): string {
    return `c_${++this.commentCounter}`;
  }

  async addThread(
    anchor: CommentAnchor,
    body: string,
    author: CommentAuthor,
  ): Promise<Thread> {
    const thread = createThreadHelper(
      anchor,
      body,
      author,
      () => this.newThreadId(),
      () => this.newCommentId(),
      () => Date.now(),
    );
    this.threads.set(thread.id, thread);
    return thread;
  }

  async addReply(
    threadId: string,
    body: string,
    author: CommentAuthor,
  ): Promise<Comment> {
    const t = this.threads.get(threadId);
    if (!t) throw new Error(`Thread not found: ${threadId}`);
    const next = addReplyHelper(t, body, author, () => this.newCommentId(), () => Date.now());
    this.threads.set(threadId, next);
    return next.comments[next.comments.length - 1];
  }

  async editComment(threadId: string, commentId: string, body: string): Promise<void> {
    const t = this.threads.get(threadId);
    if (!t) throw new Error(`Thread not found: ${threadId}`);
    this.threads.set(threadId, editCommentHelper(t, commentId, body, () => Date.now()));
  }

  async deleteComment(threadId: string, commentId: string): Promise<void> {
    const t = this.threads.get(threadId);
    if (!t) throw new Error(`Thread not found: ${threadId}`);
    const next = deleteCommentHelper(t, commentId);
    if (next === null) this.threads.delete(threadId);
    else this.threads.set(threadId, next);
  }

  async setThreadResolved(
    threadId: string,
    resolved: boolean,
    by: CommentAuthor,
  ): Promise<void> {
    const t = this.threads.get(threadId);
    if (!t) throw new Error(`Thread not found: ${threadId}`);
    this.threads.set(threadId, setThreadResolvedHelper(t, resolved, by, () => Date.now()));
  }

  async listThreads(opts?: {
    tabId?: string;
    cellAnchor?: { rowId: string; colId: string };
    resolved?: boolean;
  }): Promise<Thread[]> {
    let result = Array.from(this.threads.values());
    if (opts?.tabId !== undefined) {
      result = result.filter(
        (t) => t.anchor.kind === 'sheet-cell' && t.anchor.tabId === opts.tabId,
      );
    }
    if (opts?.cellAnchor) {
      result = result.filter(
        (t) =>
          t.anchor.kind === 'sheet-cell' &&
          t.anchor.rowId === opts.cellAnchor!.rowId &&
          t.anchor.colId === opts.cellAnchor!.colId,
      );
    }
    if (opts?.resolved !== undefined) {
      result = result.filter((t) => t.resolved === opts.resolved);
    }
    return result;
  }
```

- [ ] **Step 5: Stub the methods in ReadonlyStore**

In `packages/sheets/src/store/readonly.ts`, add the same imports and stub methods that throw `'Read-only store'` for mutators and return `[]` for `listThreads`:

```typescript
async addThread(): Promise<Thread> {
  throw new Error('Read-only store: addThread not allowed');
}
async addReply(): Promise<Comment> {
  throw new Error('Read-only store: addReply not allowed');
}
async editComment(): Promise<void> {
  throw new Error('Read-only store: editComment not allowed');
}
async deleteComment(): Promise<void> {
  throw new Error('Read-only store: deleteComment not allowed');
}
async setThreadResolved(): Promise<void> {
  throw new Error('Read-only store: setThreadResolved not allowed');
}
async listThreads(): Promise<Thread[]> {
  return [];
}
```

- [ ] **Step 6: Run tests**

```bash
pnpm sheets test src/store/__tests__/memory-comments.test.ts
pnpm sheets typecheck
pnpm sheets test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sheets/src/store packages/sheets/src/comment/index.ts
git commit -m "Add Store comment methods with MemStore implementation"
```

---

### Task 4: Extend Yorkie Worksheet schema

Add the optional `comments` field to the canonical `Worksheet` shape used by the Yorkie integration.

**Files:**
- Modify: `packages/backend/src/yorkie/yorkie.types.ts` (or wherever `Worksheet` is declared on the frontend — see search below)

- [ ] **Step 1: Locate the Worksheet type used by yorkie-store.ts**

```bash
grep -rn "type Worksheet" packages/frontend/src packages/backend/src packages/sheets/src 2>&1 | head -5
```

Likely candidates: `packages/backend/src/yorkie/yorkie.types.ts`, `packages/frontend/src/app/spreadsheet/types.ts`. Add the field at the canonical declaration.

- [ ] **Step 2: Add `comments?` field**

Append to the `Worksheet` type:

```typescript
import type { Thread } from '@wafflebase/sheets';

export type Worksheet = {
  // ... existing fields ...
  comments?: { [threadId: string]: Thread };
};
```

If `Thread` is not yet exported from `@wafflebase/sheets`, add `export type { Thread } from './comment'` to `packages/sheets/src/index.ts`.

- [ ] **Step 3: Typecheck both packages**

```bash
pnpm sheets typecheck
pnpm frontend lint
```

Expected: PASS — `comments` is optional, so nothing else changes.

- [ ] **Step 4: Commit**

```bash
git add packages/sheets/src/index.ts packages/backend/src/yorkie/yorkie.types.ts
# adjust paths if Worksheet lives elsewhere
git commit -m "Add optional comments field to Worksheet schema"
```

---

### Task 5: Yorkie comment mutations

Implement Yorkie-local mutations in a dedicated module, following the `yorkie-worksheet-axis.ts` pattern.

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/yorkie-worksheet-comments.ts`
- Create: `packages/frontend/tests/app/spreadsheet/yorkie-worksheet-comments.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/frontend/tests/app/spreadsheet/yorkie-worksheet-comments.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAddThread,
  applyAddReply,
  applyEditComment,
  applyDeleteComment,
  applyResolveThread,
} from '../../../src/app/spreadsheet/yorkie-worksheet-comments';
import type { Thread } from '@wafflebase/sheets';

function fixture(): { comments?: Record<string, Thread> } {
  return {};
}

describe('yorkie-worksheet-comments', () => {
  it('addThread initializes comments map and inserts entry', () => {
    const ws = fixture();
    const t: Thread = {
      id: 't1',
      anchor: { kind: 'sheet-cell', tabId: 'tab1', rowId: 'r1', colId: 'c1' },
      comments: [{ id: 'c1', author: { userId: 'u1', username: 'a' }, body: 'hi', createdAt: 0 }],
      resolved: false,
      createdAt: 0,
    };
    applyAddThread(ws as Required<typeof ws>, t);
    assert.equal(ws.comments?.t1.id, 't1');
  });

  it('addReply pushes onto the thread comments array', () => {
    const ws = fixture();
    const t: Thread = {
      id: 't1',
      anchor: { kind: 'sheet-cell', tabId: 'tab1', rowId: 'r1', colId: 'c1' },
      comments: [{ id: 'c1', author: { userId: 'u1', username: 'a' }, body: 'root', createdAt: 0 }],
      resolved: false,
      createdAt: 0,
    };
    applyAddThread(ws as Required<typeof ws>, t);
    applyAddReply(ws as Required<typeof ws>, 't1', {
      id: 'c2',
      author: { userId: 'u2', username: 'b' },
      body: 'reply',
      createdAt: 1,
    });
    assert.equal(ws.comments!.t1.comments.length, 2);
    assert.equal(ws.comments!.t1.comments[1].id, 'c2');
  });

  it('deleteComment of root removes the thread entry entirely', () => {
    const ws = fixture();
    const t: Thread = {
      id: 't1',
      anchor: { kind: 'sheet-cell', tabId: 'tab1', rowId: 'r1', colId: 'c1' },
      comments: [{ id: 'c1', author: { userId: 'u1', username: 'a' }, body: 'root', createdAt: 0 }],
      resolved: false,
      createdAt: 0,
    };
    applyAddThread(ws as Required<typeof ws>, t);
    applyDeleteComment(ws as Required<typeof ws>, 't1', 'c1');
    assert.equal(ws.comments!.t1, undefined);
  });

  it('resolveThread sets resolved/resolvedAt/resolvedBy', () => {
    const ws = fixture();
    const t: Thread = {
      id: 't1',
      anchor: { kind: 'sheet-cell', tabId: 'tab1', rowId: 'r1', colId: 'c1' },
      comments: [{ id: 'c1', author: { userId: 'u1', username: 'a' }, body: 'x', createdAt: 0 }],
      resolved: false,
      createdAt: 0,
    };
    applyAddThread(ws as Required<typeof ws>, t);
    applyResolveThread(ws as Required<typeof ws>, 't1', true, { userId: 'u2', username: 'b' }, 999);
    assert.equal(ws.comments!.t1.resolved, true);
    assert.equal(ws.comments!.t1.resolvedAt, 999);
  });

  it('editComment updates body and editedAt', () => {
    const ws = fixture();
    const t: Thread = {
      id: 't1',
      anchor: { kind: 'sheet-cell', tabId: 'tab1', rowId: 'r1', colId: 'c1' },
      comments: [{ id: 'c1', author: { userId: 'u1', username: 'a' }, body: 'old', createdAt: 0 }],
      resolved: false,
      createdAt: 0,
    };
    applyAddThread(ws as Required<typeof ws>, t);
    applyEditComment(ws as Required<typeof ws>, 't1', 'c1', 'new', 555);
    assert.equal(ws.comments!.t1.comments[0].body, 'new');
    assert.equal(ws.comments!.t1.comments[0].editedAt, 555);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/yorkie-worksheet-comments.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the module**

`packages/frontend/src/app/spreadsheet/yorkie-worksheet-comments.ts`:

```typescript
import type { Comment, CommentAuthor, Thread } from '@wafflebase/sheets';

type WorksheetWithComments = {
  comments?: { [threadId: string]: Thread };
};

function ensureComments(ws: WorksheetWithComments): { [threadId: string]: Thread } {
  if (!ws.comments) ws.comments = {};
  return ws.comments;
}

export function applyAddThread(ws: WorksheetWithComments, thread: Thread): void {
  ensureComments(ws)[thread.id] = thread;
}

export function applyAddReply(
  ws: WorksheetWithComments,
  threadId: string,
  reply: Comment,
): void {
  const t = ws.comments?.[threadId];
  if (!t) throw new Error(`Thread not found: ${threadId}`);
  t.comments.push(reply);
}

export function applyEditComment(
  ws: WorksheetWithComments,
  threadId: string,
  commentId: string,
  body: string,
  editedAt: number,
): void {
  const t = ws.comments?.[threadId];
  if (!t) throw new Error(`Thread not found: ${threadId}`);
  const c = t.comments.find((x) => x.id === commentId);
  if (!c) throw new Error(`Comment not found: ${commentId}`);
  c.body = body;
  c.editedAt = editedAt;
}

/**
 * Removes the comment. If it was the root, the thread entry is removed
 * from the worksheet map.
 */
export function applyDeleteComment(
  ws: WorksheetWithComments,
  threadId: string,
  commentId: string,
): void {
  const t = ws.comments?.[threadId];
  if (!t) return;
  const idx = t.comments.findIndex((c) => c.id === commentId);
  if (idx < 0) return;
  if (idx === 0) {
    delete ws.comments![threadId];
    return;
  }
  t.comments.splice(idx, 1);
}

export function applyResolveThread(
  ws: WorksheetWithComments,
  threadId: string,
  resolved: boolean,
  by: CommentAuthor,
  ts: number,
): void {
  const t = ws.comments?.[threadId];
  if (!t) throw new Error(`Thread not found: ${threadId}`);
  t.resolved = resolved;
  if (resolved) {
    t.resolvedAt = ts;
    t.resolvedBy = by;
  } else {
    delete t.resolvedAt;
    delete t.resolvedBy;
  }
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/yorkie-worksheet-comments.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/yorkie-worksheet-comments.ts \
        packages/frontend/tests/app/spreadsheet/yorkie-worksheet-comments.test.ts
git commit -m "Add Yorkie-local mutations for cell comments"
```

---

### Task 6: Wire YorkieStore to the comment mutations

Implement the 6 `Store` methods on the existing `YorkieStore` by delegating to `yorkie-worksheet-comments` inside `doc.update()`.

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/yorkie-store.ts`

- [ ] **Step 1: Read current YorkieStore structure**

```bash
grep -n "^\s*async\s" packages/frontend/src/app/spreadsheet/yorkie-store.ts | head -20
```

Note the existing patterns: `doc.update((root) => { ... })`, where `root` is the SpreadsheetDocument and current tab worksheet is `root.sheets[tabId]`.

- [ ] **Step 2: Add the 6 methods**

In `packages/frontend/src/app/spreadsheet/yorkie-store.ts`, add imports:

```typescript
import { uuid } from '../../utils/uuid'; // or whatever existing UUID utility is used
import {
  applyAddThread,
  applyAddReply,
  applyEditComment,
  applyDeleteComment,
  applyResolveThread,
} from './yorkie-worksheet-comments';
import {
  createThread as createThreadHelper,
  addReply as addReplyHelper,
} from '@wafflebase/sheets';
import type { Comment, CommentAnchor, CommentAuthor, Thread } from '@wafflebase/sheets';
```

Inside the `YorkieStore` class:

```typescript
  async addThread(
    anchor: CommentAnchor,
    body: string,
    author: CommentAuthor,
  ): Promise<Thread> {
    const thread = createThreadHelper(
      anchor,
      body,
      author,
      () => uuid(),
      () => uuid(),
      () => Date.now(),
    );
    this.doc.update((root) => {
      const ws = root.sheets[this.tabId];
      applyAddThread(ws, thread);
    });
    return thread;
  }

  async addReply(
    threadId: string,
    body: string,
    author: CommentAuthor,
  ): Promise<Comment> {
    let reply!: Comment;
    this.doc.update((root) => {
      const ws = root.sheets[this.tabId];
      const existing = ws.comments?.[threadId];
      if (!existing) throw new Error(`Thread not found: ${threadId}`);
      // Use sheets pure helper to validate and build the reply
      const next = addReplyHelper(
        existing,
        body,
        author,
        () => uuid(),
        () => Date.now(),
      );
      reply = next.comments[next.comments.length - 1];
      applyAddReply(ws, threadId, reply);
    });
    return reply;
  }

  async editComment(threadId: string, commentId: string, body: string): Promise<void> {
    if (body.trim().length === 0) throw new Error('Comment body cannot be empty');
    this.doc.update((root) => {
      applyEditComment(root.sheets[this.tabId], threadId, commentId, body, Date.now());
    });
  }

  async deleteComment(threadId: string, commentId: string): Promise<void> {
    this.doc.update((root) => {
      applyDeleteComment(root.sheets[this.tabId], threadId, commentId);
    });
  }

  async setThreadResolved(
    threadId: string,
    resolved: boolean,
    by: CommentAuthor,
  ): Promise<void> {
    this.doc.update((root) => {
      applyResolveThread(root.sheets[this.tabId], threadId, resolved, by, Date.now());
    });
  }

  async listThreads(opts?: {
    tabId?: string;
    cellAnchor?: { rowId: string; colId: string };
    resolved?: boolean;
  }): Promise<Thread[]> {
    const root = this.doc.getRoot();
    const tabId = opts?.tabId ?? this.tabId;
    const ws = root.sheets[tabId];
    let threads = Object.values(ws.comments ?? {}) as Thread[];
    if (opts?.cellAnchor) {
      threads = threads.filter(
        (t) =>
          t.anchor.kind === 'sheet-cell' &&
          t.anchor.rowId === opts.cellAnchor!.rowId &&
          t.anchor.colId === opts.cellAnchor!.colId,
      );
    }
    if (opts?.resolved !== undefined) {
      threads = threads.filter((t) => t.resolved === opts.resolved);
    }
    return threads;
  }
```

> Adjust `this.doc`, `this.tabId`, `root.sheets` to match the actual property names in `YorkieStore`.

- [ ] **Step 3: Typecheck and run frontend tests**

```bash
pnpm frontend lint
pnpm --filter @wafflebase/frontend test 2>&1 | tail -10
```

Expected: PASS for new tests; pre-existing slides regression remains.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/yorkie-store.ts
git commit -m "Wire YorkieStore to comment mutations"
```

---

### Task 7: Orphan cleanup on row/column delete

Auto-delete threads anchored to a removed row or column inside the same Yorkie transaction.

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/yorkie-worksheet-structure.ts`
- Create: `packages/frontend/tests/app/spreadsheet/yorkie-comments-orphan.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/frontend/tests/app/spreadsheet/yorkie-comments-orphan.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deleteThreadsForAxis } from '../../../src/app/spreadsheet/yorkie-worksheet-structure';
import type { Thread } from '@wafflebase/sheets';

function thread(id: string, rowId: string, colId: string): Thread {
  return {
    id,
    anchor: { kind: 'sheet-cell', tabId: 't', rowId, colId },
    comments: [{ id: 'c', author: { userId: 'u', username: 'a' }, body: 'x', createdAt: 0 }],
    resolved: false,
    createdAt: 0,
  };
}

describe('deleteThreadsForAxis', () => {
  it('removes threads whose rowId is in the deleted set', () => {
    const ws = {
      comments: {
        t1: thread('t1', 'r1', 'c1'),
        t2: thread('t2', 'r2', 'c1'),
      },
    };
    deleteThreadsForAxis(ws, 'row', new Set(['r1']));
    assert.equal(ws.comments.t1, undefined);
    assert.equal(ws.comments.t2.id, 't2');
  });

  it('removes threads whose colId is in the deleted set', () => {
    const ws = {
      comments: {
        t1: thread('t1', 'r1', 'cA'),
        t2: thread('t2', 'r1', 'cB'),
      },
    };
    deleteThreadsForAxis(ws, 'col', new Set(['cA']));
    assert.equal(ws.comments.t1, undefined);
    assert.equal(ws.comments.t2.id, 't2');
  });

  it('is a no-op when comments map is missing', () => {
    const ws: { comments?: Record<string, Thread> } = {};
    deleteThreadsForAxis(ws, 'row', new Set(['r1']));
    assert.equal(ws.comments, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/yorkie-comments-orphan.test.ts
```

Expected: FAIL — `deleteThreadsForAxis` not exported.

- [ ] **Step 3: Add the helper and wire into shift/move**

In `packages/frontend/src/app/spreadsheet/yorkie-worksheet-structure.ts`, add at the top of the file:

```typescript
import type { Thread } from '@wafflebase/sheets';

type WorksheetCommentsView = {
  comments?: { [threadId: string]: Thread };
};

export function deleteThreadsForAxis(
  ws: WorksheetCommentsView,
  axis: 'row' | 'col',
  deletedAxisIds: Set<string>,
): void {
  const comments = ws.comments;
  if (!comments) return;
  for (const [threadId, thread] of Object.entries(comments)) {
    if (thread.anchor.kind !== 'sheet-cell') continue;
    const id = axis === 'row' ? thread.anchor.rowId : thread.anchor.colId;
    if (deletedAxisIds.has(id)) delete comments[threadId];
  }
}
```

Find the function(s) that handle `shiftCells` deletion and `moveCells` (the existing post-axis structure rewrite). After the cell map is rewritten and the `deletedRowIds` / `deletedColIds` set is computed, add a call:

```typescript
deleteThreadsForAxis(ws, axis, deletedAxisIds);
```

> The exact call site depends on the existing function shape. Locate it by searching for where cells with deleted rowIds/colIds are removed.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/yorkie-comments-orphan.test.ts
pnpm frontend lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/yorkie-worksheet-structure.ts \
        packages/frontend/tests/app/spreadsheet/yorkie-comments-orphan.test.ts
git commit -m "Auto-delete orphan threads when rows/columns are removed"
```

---

### Task 8: Canvas marker rendering

Draw a 7×7 yellow triangle in the top-right corner of any cell with at least one open thread on the active tab.

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/canvas/render-comments.ts`
- Modify: the canvas grid render entry point that draws per-cell decorations (search below)

- [ ] **Step 1: Locate the per-cell render entry**

```bash
grep -rn "fillRect\|strokeRect" packages/frontend/src/app/spreadsheet/canvas 2>&1 | head -5
grep -rn "renderCell\|drawCell" packages/frontend/src/app/spreadsheet/canvas 2>&1 | head -5
```

Identify the function called per visible cell during the grid render pass.

- [ ] **Step 2: Implement the marker function**

`packages/frontend/src/app/spreadsheet/canvas/render-comments.ts`:

```typescript
const MARKER_SIZE = 7;
const MARKER_COLOR = '#fbbc04';

export function drawCommentMarker(
  ctx: CanvasRenderingContext2D,
  cellRight: number,
  cellTop: number,
): void {
  ctx.fillStyle = MARKER_COLOR;
  ctx.beginPath();
  ctx.moveTo(cellRight, cellTop);
  ctx.lineTo(cellRight, cellTop + MARKER_SIZE);
  ctx.lineTo(cellRight - MARKER_SIZE, cellTop);
  ctx.closePath();
  ctx.fill();
}

/**
 * Build a per-cell key set (`${rowId}|${colId}`) from the open threads of the
 * current tab so the renderer can do an O(1) check per cell.
 */
export function buildOpenThreadKeySet(
  threads: ReadonlyArray<{
    anchor: { kind: string; rowId?: string; colId?: string };
    resolved: boolean;
  }>,
): Set<string> {
  const keys = new Set<string>();
  for (const t of threads) {
    if (t.resolved) continue;
    if (t.anchor.kind !== 'sheet-cell') continue;
    keys.add(`${t.anchor.rowId}|${t.anchor.colId}`);
  }
  return keys;
}
```

- [ ] **Step 3: Wire into the per-cell render pass**

At the call site identified in Step 1, after the cell background and content have been drawn:

```typescript
import { drawCommentMarker, buildOpenThreadKeySet } from './render-comments';

// Once per render frame, before the loop:
const commentKeys = buildOpenThreadKeySet(
  Object.values(worksheet.comments ?? {}),
);

// Inside the per-cell loop, where rowId, colId, x, y, width are known:
if (commentKeys.has(`${rowId}|${colId}`)) {
  drawCommentMarker(ctx, x + width, y);
}
```

- [ ] **Step 4: Add a unit test for the key set helper**

`packages/frontend/tests/app/spreadsheet/canvas/render-comments.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenThreadKeySet } from '../../../../src/app/spreadsheet/canvas/render-comments';

describe('buildOpenThreadKeySet', () => {
  it('includes only unresolved sheet-cell threads', () => {
    const set = buildOpenThreadKeySet([
      { anchor: { kind: 'sheet-cell', rowId: 'r1', colId: 'c1' }, resolved: false },
      { anchor: { kind: 'sheet-cell', rowId: 'r1', colId: 'c2' }, resolved: true },
      { anchor: { kind: 'sheet-cell', rowId: 'r2', colId: 'c1' }, resolved: false },
    ]);
    assert.equal(set.has('r1|c1'), true);
    assert.equal(set.has('r1|c2'), false);
    assert.equal(set.has('r2|c1'), true);
    assert.equal(set.size, 2);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/canvas/render-comments.test.ts
pnpm frontend lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/canvas/render-comments.ts \
        packages/frontend/tests/app/spreadsheet/canvas/render-comments.test.ts \
        packages/frontend/src/app/spreadsheet/canvas/<modified-render-entry>
git commit -m "Render yellow comment marker in cells with open threads"
```

---

### Task 9: CommentComposer component

Plain-text input with submit / cancel, used both for new threads and replies.

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/components/comments/CommentComposer.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import { useState, KeyboardEvent } from 'react';

type Props = {
  initialBody?: string;
  submitLabel: string;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function CommentComposer({
  initialBody = '',
  submitLabel,
  onSubmit,
  onCancel,
  disabled,
  autoFocus,
}: Props) {
  const [body, setBody] = useState(initialBody);
  const trimmed = body.trim();

  const submit = () => {
    if (!trimmed) return;
    onSubmit(body);
    setBody('');
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="comment-composer">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKey}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={3}
        placeholder={disabled ? 'Sign in to leave a comment.' : 'Add a comment...'}
        aria-label="Comment body"
      />
      <div className="comment-composer__actions">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={disabled}>
            Cancel
          </button>
        )}
        <button type="button" onClick={submit} disabled={disabled || !trimmed}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint**

```bash
pnpm frontend lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/components/comments/CommentComposer.tsx
git commit -m "Add CommentComposer component"
```

---

### Task 10: CommentPopover component + cell click wiring

Show a popover anchored to the active cell with all open threads on it.

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/components/comments/CommentPopover.tsx`
- Modify: spreadsheet page or grid container to render the popover when active cell has threads

- [ ] **Step 1: Implement CommentPopover**

```tsx
import { CommentComposer } from './CommentComposer';
import type { Thread, CommentAuthor } from '@wafflebase/sheets';
import { useState } from 'react';

type Props = {
  threads: Thread[];                   // open threads for the active cell
  currentUser: CommentAuthor | null;   // null = unauthenticated
  onAddThread: (body: string) => Promise<void>;
  onReply: (threadId: string, body: string) => Promise<void>;
  onResolve: (threadId: string) => Promise<void>;
  onEditComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onDeleteComment: (threadId: string, commentId: string) => Promise<void>;
  onClose: () => void;
};

export function CommentPopover({
  threads,
  currentUser,
  onAddThread,
  onReply,
  onResolve,
  onEditComment,
  onDeleteComment,
  onClose,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null); // commentId being edited
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const isReadOnly = currentUser === null;

  return (
    <div className="comment-popover" role="dialog" aria-label="Comments">
      <button className="comment-popover__close" onClick={onClose} aria-label="Close">×</button>

      {threads.map((thread) => (
        <article key={thread.id} className="comment-thread">
          {thread.comments.map((c) => (
            <div key={c.id} className="comment">
              <header>
                <strong>{c.author.username}</strong>
                <time>{new Date(c.createdAt).toLocaleString()}</time>
                {c.editedAt && <span> (edited)</span>}
              </header>
              {editing === c.id ? (
                <CommentComposer
                  initialBody={c.body}
                  submitLabel="Save"
                  onSubmit={async (body) => {
                    await onEditComment(thread.id, c.id, body);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                  autoFocus
                />
              ) : (
                <p className="comment__body">{c.body}</p>
              )}
              {!isReadOnly && currentUser?.userId === c.author.userId && editing !== c.id && (
                <div className="comment__actions">
                  <button onClick={() => setEditing(c.id)}>Edit</button>
                  <button onClick={() => onDeleteComment(thread.id, c.id)}>Delete</button>
                </div>
              )}
            </div>
          ))}

          {!isReadOnly && (
            <div className="comment-thread__footer">
              {replyingTo === thread.id ? (
                <CommentComposer
                  submitLabel="Reply"
                  onSubmit={async (body) => {
                    await onReply(thread.id, body);
                    setReplyingTo(null);
                  }}
                  onCancel={() => setReplyingTo(null)}
                  autoFocus
                />
              ) : (
                <button onClick={() => setReplyingTo(thread.id)}>Reply</button>
              )}
              <button onClick={() => onResolve(thread.id)}>Resolve</button>
            </div>
          )}
        </article>
      ))}

      {threads.length === 0 && !isReadOnly && (
        <CommentComposer
          submitLabel="Comment"
          onSubmit={(body) => onAddThread(body)}
          autoFocus
        />
      )}

      {isReadOnly && (
        <p className="comment-popover__signin">Sign in to leave a comment.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount the popover at the spreadsheet page level**

In the spreadsheet page component (search `Spreadsheet` or grid container):

- Track `activeCellAnchor: { rowId, colId } | null` and `popoverOpen: boolean` state.
- On grid click, look up `worksheet.comments` filtered by anchor + `!resolved`. If any thread exists OR user explicitly invoked "Insert comment", set `popoverOpen=true`.
- Render `<CommentPopover threads={...} ... />` when open, positioned near the cell rect.

- [ ] **Step 3: Lint**

```bash
pnpm frontend lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/components/comments/CommentPopover.tsx \
        packages/frontend/src/app/spreadsheet/<spreadsheet-page>
git commit -m "Add CommentPopover and wire to grid click"
```

---

### Task 11: CommentSidePanel + jump-to-cell

Right-side panel with "Open" / "Resolved" tabs and click-to-navigate behavior.

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/components/comments/CommentSidePanel.tsx`
- Modify: spreadsheet page to add a toolbar toggle

- [ ] **Step 1: Implement the panel**

```tsx
import { useState } from 'react';
import type { Thread } from '@wafflebase/sheets';

type Props = {
  threads: Thread[];                  // all threads across all tabs
  onJumpTo: (anchor: Thread['anchor']) => void;
};

export function CommentSidePanel({ threads, onJumpTo }: Props) {
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const visible = threads.filter((t) => t.resolved === (tab === 'resolved'));

  return (
    <aside className="comment-side-panel" aria-label="Comments">
      <header>
        <button
          aria-pressed={tab === 'open'}
          onClick={() => setTab('open')}
        >
          Open ({threads.filter((t) => !t.resolved).length})
        </button>
        <button
          aria-pressed={tab === 'resolved'}
          onClick={() => setTab('resolved')}
        >
          Resolved ({threads.filter((t) => t.resolved).length})
        </button>
      </header>

      <ul className="comment-side-panel__list">
        {visible.map((t) => {
          const root = t.comments[0];
          return (
            <li key={t.id}>
              <button onClick={() => onJumpTo(t.anchor)} className="comment-side-panel__row">
                <strong>{root.author.username}</strong>
                <span className="comment-side-panel__preview">
                  {root.body.split('\n')[0].slice(0, 80)}
                </span>
                <span className="comment-side-panel__count">
                  {t.comments.length > 1 && `${t.comments.length} comments`}
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="comment-side-panel__empty">
            No {tab === 'open' ? 'open' : 'resolved'} comments.
          </li>
        )}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2: Wire into spreadsheet page**

In the spreadsheet page:

- Add a `commentsPanelOpen` state.
- Add a toolbar button (search the existing toolbar component) labeled "Comments" / icon, toggling the state.
- When open, aggregate threads across `Object.values(spreadsheetDoc.sheets)`:

```typescript
const allThreads: Thread[] = Object.values(spreadsheetDoc.sheets).flatMap((ws) =>
  Object.values(ws.comments ?? {}),
);
```

- Pass `onJumpTo` that:
  1. Switches to `anchor.tabId` if it differs from active.
  2. Resolves `rowId/colId` against current `rowOrder/colOrder` to a visual cell.
  3. Calls existing scroll-to-cell + selection logic.

- [ ] **Step 3: Lint**

```bash
pnpm frontend lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/components/comments/CommentSidePanel.tsx \
        packages/frontend/src/app/spreadsheet/<page>
git commit -m "Add CommentSidePanel with jump-to-cell"
```

---

### Task 12: Entry points — context menu, shortcut, toolbar

Three ways to start a new comment from the active cell, plus a side-panel toggle shortcut.

**Files:**
- Modify: existing context menu definitions for spreadsheet cells
- Modify: existing keyboard handler in the spreadsheet page
- Modify: existing toolbar component for the spreadsheet

- [ ] **Step 1: Find existing context menu / toolbar / keybinding files**

```bash
grep -rn "ContextMenu\|context-menu" packages/frontend/src/app/spreadsheet 2>&1 | head -5
grep -rn "useKeyboard\|onKeyDown" packages/frontend/src/app/spreadsheet 2>&1 | head -5
grep -rn "Toolbar" packages/frontend/src/app/spreadsheet 2>&1 | head -5
```

- [ ] **Step 2: Add "Insert comment" menu item to the cell context menu**

In the existing context menu definition for cells, add an item:

```tsx
{
  label: 'Insert comment',
  shortcut: 'Cmd+Alt+M',
  onSelect: () => openCommentComposerForActiveCell(),
}
```

Where `openCommentComposerForActiveCell` sets the popover state to open with an empty composer and the active cell's anchor.

- [ ] **Step 3: Add keyboard shortcut**

In the spreadsheet keyboard handler:

```typescript
if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'm') {
  e.preventDefault();
  openCommentComposerForActiveCell();
}
if ((e.metaKey || e.ctrlKey) && e.altKey && e.shiftKey && e.key.toLowerCase() === 'm') {
  e.preventDefault();
  setCommentsPanelOpen((open) => !open);
}
```

- [ ] **Step 4: Add toolbar button**

In the toolbar component, add a button (next to existing icons) with the message-square icon labeled "Comments" that toggles `commentsPanelOpen`.

- [ ] **Step 5: Lint**

```bash
pnpm frontend lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/<modified-files>
git commit -m "Add comment entry points: context menu, shortcut, toolbar"
```

---

### Task 13: Yorkie concurrent integration tests

Two-client tests for concurrent thread creation, concurrent replies, row-delete cascade with undo, and concurrent resolve.

**Files:**
- Create: `packages/frontend/tests/app/spreadsheet/comments-concurrency.test.ts`

- [ ] **Step 1: Write the integration tests**

Pattern to follow: existing `packages/frontend/tests/app/spreadsheet/yorkie-store.*.test.ts` (search for two-client setup helpers).

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setupTwoClients } from './helpers/two-clients'; // existing helper, adjust path

describe('comments concurrency', () => {
  it('two threads added concurrently to same cell are both preserved', async () => {
    const { storeA, storeB, sync } = await setupTwoClients();
    const anchor = { kind: 'sheet-cell' as const, tabId: 't1', rowId: 'r1', colId: 'c1' };
    const author = { userId: 'u', username: 'x' };

    const [tA, tB] = await Promise.all([
      storeA.addThread(anchor, 'from A', author),
      storeB.addThread(anchor, 'from B', author),
    ]);
    await sync();

    const all = await storeA.listThreads();
    const ids = all.map((t) => t.id).sort();
    assert.deepEqual(ids, [tA.id, tB.id].sort());
  });

  it('two replies on the same thread concurrently are both preserved', async () => {
    const { storeA, storeB, sync } = await setupTwoClients();
    const anchor = { kind: 'sheet-cell' as const, tabId: 't1', rowId: 'r1', colId: 'c1' };
    const author = { userId: 'u', username: 'x' };

    const root = await storeA.addThread(anchor, 'root', author);
    await sync();

    await Promise.all([
      storeA.addReply(root.id, 'reply A', author),
      storeB.addReply(root.id, 'reply B', author),
    ]);
    await sync();

    const [thread] = await storeA.listThreads();
    const replies = thread.comments.slice(1).map((c) => c.body).sort();
    assert.deepEqual(replies, ['reply A', 'reply B']);
  });

  it('row delete cascades: thread is removed and undo restores it', async () => {
    const { storeA, sync, undo } = await setupTwoClients();
    const anchor = { kind: 'sheet-cell' as const, tabId: 't1', rowId: 'r1', colId: 'c1' };
    await storeA.addThread(anchor, 'note', { userId: 'u', username: 'x' });
    await sync();

    await storeA.shiftCells('row', 0, -1); // delete the row containing r1
    await sync();
    assert.equal((await storeA.listThreads()).length, 0);

    undo();
    await sync();
    assert.equal((await storeA.listThreads()).length, 1);
  });

  it('concurrent resolve converges to a consistent final state', async () => {
    const { storeA, storeB, sync } = await setupTwoClients();
    const anchor = { kind: 'sheet-cell' as const, tabId: 't1', rowId: 'r1', colId: 'c1' };
    const author = { userId: 'u', username: 'x' };

    const t = await storeA.addThread(anchor, 'x', author);
    await sync();

    await Promise.all([
      storeA.setThreadResolved(t.id, true, author),
      storeB.setThreadResolved(t.id, true, author),
    ]);
    await sync();

    const [a] = await storeA.listThreads();
    const [b] = await storeB.listThreads();
    assert.equal(a.resolved, true);
    assert.equal(b.resolved, true);
    assert.equal(a.resolvedAt, b.resolvedAt); // LWW agreement
  });
});
```

> If `setupTwoClients` does not exist, locate the closest analog (e.g., a Yorkie test fixture) and adapt. The undo helper may be the existing client's `doc.undo()` or similar.

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/comments-concurrency.test.ts
```

Expected: PASS for each scenario.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/tests/app/spreadsheet/comments-concurrency.test.ts
git commit -m "Add Yorkie concurrent integration tests for cell comments"
```

---

### Task 14: Visual interaction tests, final verification, archive

Add visual tests for the UI surfaces, run the full lane, and archive the task.

- [ ] **Step 1: Locate the existing visual test harness**

```bash
find packages/frontend -path "*visual*" -name "*.spec.ts" 2>&1 | head -5
```

Pick the closest neighbor (e.g., context-menu visual spec) as the template.

- [ ] **Step 2: Add `comments.spec.ts`**

`packages/frontend/visual/comments.spec.ts` — a Playwright-style spec covering:

- Marker render: open a sheet with a known thread, screenshot the cell, assert a yellow triangle pixel exists at the cell's top-right.
- Cell click → popover: click a cell with a thread, assert the popover element is visible.
- Cmd+Alt+M opens composer focused on the textarea.
- Side panel tab counts update on resolve.
- Side panel click scrolls to and highlights the anchor cell.

Use the existing helper (e.g. `setupSpreadsheetPage`) to seed the state.

- [ ] **Step 3: Run the visual lane in Docker**

```bash
pnpm verify:browser:docker
```

Expected: PASS for new specs (pre-existing flakes noted).

- [ ] **Step 4: Run unit + integration locally**

```bash
pnpm verify:fast
```

Expected: comment-related tests PASS. Pre-existing slides regressions are tracked separately and may still fail — note them but do not block this work.

- [ ] **Step 5: Update task index**

```bash
pnpm tasks:archive && pnpm tasks:index
```

This moves `docs/tasks/active/20260508-sheets-comments-todo.md` into `docs/tasks/archive/2026/05/` and updates `docs/tasks/README.md`.

- [ ] **Step 6: Add a one-line review section to the bottom of this todo file before archiving**

Append:

```markdown
---

## Review

- All phase B goals from `docs/design/sheets/comments.md` implemented.
- Tests: thread/anchor/store/yorkie-mutations/orphan-cleanup/concurrency all passing.
- Out-of-scope follow-ups: phase C (mentions, notifications, per-user unread).
```

- [ ] **Step 7: Final commit**

```bash
git add docs/tasks/
git commit -m "Archive sheet cell comments task (phase B done)"
```

---

## Self-Review

**Spec coverage:**

| Spec section                                | Task |
| ------------------------------------------- | ---- |
| §2 Data model (types, invariants)           | 1    |
| §1 Module layout (`packages/sheets/comment`) | 1    |
| Anchor → Sref helpers (referenced in §6.2)  | 2    |
| §4 Store interface methods                  | 3    |
| §3 Yorkie schema (`comments?` field)        | 4    |
| §3 Yorkie mutations (concurrent semantics)  | 5    |
| §4 YorkieStore wiring                       | 6    |
| §5 Anchor stability + orphan cleanup        | 7    |
| §6.3 Canvas marker                          | 8    |
| §6.1 Composer                               | 9    |
| §6.1/§6.2 Popover + cell click              | 10   |
| §6.1 Side panel + jump-to-cell              | 11   |
| §6.2 Entry points (menu/shortcut/toolbar)   | 12   |
| §7.2 Yorkie integration tests               | 13   |
| §7.3 Visual / interaction tests             | 14   |
| §6.4 Read-only handling                     | 9, 10 (composer disabled, action buttons hidden) |

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in steps; every code step contains the actual code or exact search command. Locations marked with "search below" all give a concrete `grep` command, not a vague pointer.

**Type consistency:** `Thread`, `Comment`, `CommentAnchor`, `CommentAuthor` named consistently across all tasks. Mutation helpers (`applyAddThread`, `applyAddReply`, `applyEditComment`, `applyDeleteComment`, `applyResolveThread`) named consistently in tasks 5, 6, 7. Store methods (`addThread`, `addReply`, `editComment`, `deleteComment`, `setThreadResolved`, `listThreads`) named consistently across tasks 3, 6, 10, 11, 13.

---

## Review

- All phase B goals from `docs/design/sheets/comments.md` implemented across 14 tasks.
- Tests: thread/anchor/store/yorkie-mutations/orphan-cleanup/concurrency all passing. `pnpm verify:fast` passed clean (58 test files, 1265 tests across all packages).
- Visual tests: skipped. No Playwright or browser-based visual harness exists in the repo; the test suite uses Vitest + jsdom for view-layer tests. The render-comments and overlay canvas tests already cover the marker rendering logic via mock canvas contexts. Full visual/interaction browser tests (marker render, popover open on click, Cmd+Alt+M shortcut, side panel counts, jump-to-cell) are a follow-up.
- Out-of-scope follow-ups: phase C (mentions, notifications, per-user unread); visual/browser interaction tests (Playwright harness would need to be bootstrapped).
