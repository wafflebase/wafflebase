import { describe, it, expect } from 'vitest';
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
    expect(ws.comments.t1).toBe(undefined);
    expect(ws.comments.t2.id).toBe('t2');
  });

  it('removes threads whose colId is in the deleted set', () => {
    const ws = {
      comments: {
        t1: thread('t1', 'r1', 'cA'),
        t2: thread('t2', 'r1', 'cB'),
      },
    };
    deleteThreadsForAxis(ws, 'col', new Set(['cA']));
    expect(ws.comments.t1).toBe(undefined);
    expect(ws.comments.t2.id).toBe('t2');
  });

  it('is a no-op when comments map is missing', () => {
    const ws: { comments?: Record<string, Thread> } = {};
    deleteThreadsForAxis(ws, 'row', new Set(['r1']));
    expect(ws.comments).toBe(undefined);
  });

  it('preserves threads not in the deleted set while removing those that are', () => {
    const ws = {
      comments: {
        t1: thread('t1', 'r1', 'c1'),
        t2: thread('t2', 'r2', 'c2'),
        t3: thread('t3', 'r3', 'c3'),
      },
    };
    deleteThreadsForAxis(ws, 'row', new Set(['r1', 'r3']));
    expect(ws.comments.t1).toBe(undefined);
    expect(ws.comments.t2.id).toBe('t2');
    expect(ws.comments.t3).toBe(undefined);
  });
});
