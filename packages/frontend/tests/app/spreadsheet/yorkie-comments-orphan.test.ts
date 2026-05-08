import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deleteThreadsForAxis } from '../../../src/app/spreadsheet/yorkie-worksheet-structure.ts';
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
