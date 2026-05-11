import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    applyAddThread(ws, t);
    applyAddReply(ws, 't1', {
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
    applyAddThread(ws, t);
    applyDeleteComment(ws, 't1', 'c1');
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
    applyAddThread(ws, t);
    applyResolveThread(ws, 't1', true, { userId: 'u2', username: 'b' }, 999);
    assert.equal(ws.comments!.t1.resolved, true);
    // Timestamps are stored as bigint so Yorkie serializes them as 64-bit Long
    // primitives — see toYorkieMs in yorkie-worksheet-comments.ts.
    assert.equal(ws.comments!.t1.resolvedAt as unknown as bigint, 999n);
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
    assert.equal(ws.comments!.t1.comments[0].body, 'new');
    // Stored as bigint — see toYorkieMs note above.
    assert.equal(
      ws.comments!.t1.comments[0].editedAt as unknown as bigint,
      555n,
    );
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
    assert.deepEqual(copy, t);
    assert.notEqual(copy, t);
    assert.notEqual(copy.anchor, t.anchor);
    assert.notEqual(copy.comments, t.comments);
    assert.notEqual(copy.comments[0], t.comments[0]);
    assert.notEqual(copy.comments[0].author, t.comments[0].author);
    assert.notEqual(copy.resolvedBy, t.resolvedBy);
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
    assert.strictEqual(typeof copy.createdAt, 'number');
    assert.strictEqual(copy.createdAt, 1_778_630_400_000);
    assert.strictEqual(typeof copy.resolvedAt, 'number');
    assert.strictEqual(copy.resolvedAt, 1_778_630_600_000);
    assert.strictEqual(typeof copy.comments[0].createdAt, 'number');
    assert.strictEqual(copy.comments[0].createdAt, 1_778_630_400_000);
    assert.strictEqual(typeof copy.comments[0].editedAt, 'number');
    assert.strictEqual(copy.comments[0].editedAt, 1_778_630_500_000);
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
    assert.equal('resolvedAt' in copy, false);
    assert.equal('resolvedBy' in copy, false);
    assert.equal('photo' in copy.comments[0].author, false);
    assert.equal('editedAt' in copy.comments[0], false);
  });
});
