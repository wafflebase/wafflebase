import { describe, it, expect } from 'vitest';
import {
  applyAddThread,
  applyAddReply,
  applyEditComment,
  applyDeleteComment,
  applyResolveThread,
  copyThread,
} from '../../../src/app/spreadsheet/yorkie-worksheet-comments.ts';
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
    applyAddThread(ws, t);
    expect(ws.comments?.t1.id).toBe('t1');
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
    applyAddThread(ws, t);
    applyAddReply(ws, 't1', {
      id: 'c2',
      author: { userId: 'u2', username: 'b' },
      body: 'reply',
      createdAt: 1,
    });
    expect(ws.comments!.t1.comments.length).toBe(2);
    expect(ws.comments!.t1.comments[1].id).toBe('c2');
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
    applyAddThread(ws, t);
    applyDeleteComment(ws, 't1', 'c1');
    expect(ws.comments!.t1).toBe(undefined);
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
    applyAddThread(ws, t);
    applyResolveThread(ws, 't1', true, { userId: 'u2', username: 'b' }, 999);
    expect(ws.comments!.t1.resolved).toBe(true);
    // Timestamps are stored as bigint so Yorkie serializes them as 64-bit Long
    // primitives — see toYorkieMs in yorkie-worksheet-comments.ts.
    expect(ws.comments!.t1.resolvedAt as unknown as bigint).toBe(999n);
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
    applyAddThread(ws, t);
    applyEditComment(ws, 't1', 'c1', 'new', 555);
    expect(ws.comments!.t1.comments[0].body).toBe('new');
    // Stored as bigint — see toYorkieMs note above.
    expect(ws.comments!.t1.comments[0].editedAt as unknown as bigint).toBe(555n);
  });

  it('copyThread returns a structurally-detached deep copy', () => {
    const t: Thread = {
      id: 't1',
      anchor: { kind: 'sheet-cell', tabId: 'tab1', rowId: 'r1', colId: 'c1' },
      comments: [
        { id: 'c1', author: { userId: 'u1', username: 'a', photo: 'p' }, body: 'root', createdAt: 1 },
        { id: 'c2', author: { userId: 'u2', username: 'b' }, body: 'reply', createdAt: 2, editedAt: 3 },
      ],
      resolved: true,
      resolvedAt: 4,
      resolvedBy: { userId: 'u3', username: 'c' },
      createdAt: 0,
    };
    const copy = copyThread(t);
    expect(copy).toEqual(t);
    expect(copy).not.toBe(t);
    expect(copy.anchor).not.toBe(t.anchor);
    expect(copy.comments).not.toBe(t.comments);
    expect(copy.comments[0]).not.toBe(t.comments[0]);
    expect(copy.comments[0].author).not.toBe(t.comments[0].author);
    expect(copy.resolvedBy).not.toBe(t.resolvedBy);
  });

  it('copyThread coerces bigint timestamps back to plain numbers', () => {
    // Mimic what Yorkie returns after wire round-trip: Long-typed primitives
    // surface as bigint on read.  Consumers downstream (formatRelativeTime,
    // numeric comparisons) assume plain numbers, so the boundary must coerce.
    const raw = {
      id: 't1',
      anchor: { kind: 'sheet-cell', tabId: 'tab1', rowId: 'r1', colId: 'c1' },
      comments: [
        {
          id: 'c1',
          author: { userId: 'u1', username: 'a' },
          body: 'x',
          createdAt: 1_778_630_400_000n as unknown as number,
          editedAt: 1_778_630_500_000n as unknown as number,
        },
      ],
      resolved: true,
      createdAt: 1_778_630_400_000n as unknown as number,
      resolvedAt: 1_778_630_600_000n as unknown as number,
      resolvedBy: { userId: 'u2', username: 'b' },
    } as unknown as Thread;
    const copy = copyThread(raw);
    expect(typeof copy.createdAt).toBe('number');
    expect(copy.createdAt).toBe(1_778_630_400_000);
    expect(typeof copy.resolvedAt).toBe('number');
    expect(copy.resolvedAt).toBe(1_778_630_600_000);
    expect(typeof copy.comments[0].createdAt).toBe('number');
    expect(copy.comments[0].createdAt).toBe(1_778_630_400_000);
    expect(typeof copy.comments[0].editedAt).toBe('number');
    expect(copy.comments[0].editedAt).toBe(1_778_630_500_000);
  });

  it('copyThread omits optional fields when absent', () => {
    const t: Thread = {
      id: 't1',
      anchor: { kind: 'sheet-cell', tabId: 'tab1', rowId: 'r1', colId: 'c1' },
      comments: [{ id: 'c1', author: { userId: 'u1', username: 'a' }, body: 'x', createdAt: 0 }],
      resolved: false,
      createdAt: 0,
    };
    const copy = copyThread(t);
    expect('resolvedAt' in copy).toBe(false);
    expect('resolvedBy' in copy).toBe(false);
    expect('photo' in copy.comments[0].author).toBe(false);
    expect('editedAt' in copy.comments[0]).toBe(false);
  });
});
