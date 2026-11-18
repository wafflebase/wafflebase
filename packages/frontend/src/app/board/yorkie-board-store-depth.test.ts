import { describe, expect, it } from 'vitest';
import { MAX_GROUP_DEPTH } from '@wafflebase/slides';
import type { YorkieElement } from '@/types/slides-document';
import { YorkieBoardStore } from './yorkie-board-store';
import { makeYorkieBoardDoc } from './__testkit__';

describe('YorkieBoardStore read of an untrusted group tree', () => {
  it('stops descending at the shared group depth cap', () => {
    const doc = makeYorkieBoardDoc();
    let el: unknown = {
      id: 'leaf',
      type: 'shape',
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      data: { kind: 'rect' },
    };
    for (let i = 0; i < MAX_GROUP_DEPTH + 8; i++) {
      el = {
        id: `g${i}`,
        type: 'group',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { children: [el] },
      };
    }
    // A peer's write, straight into the CRDT, bypassing the store.
    doc.update((r) => {
      (r.elements as unknown as YorkieElement[]).push(el as YorkieElement);
    });
    const store = new YorkieBoardStore(doc);
    let node = store.read().slides[0].elements[0] as {
      type: string;
      data: { children?: unknown[] };
    };
    let groups = 0;
    while (node.type === 'group' && node.data.children!.length > 0) {
      groups++;
      node = node.data.children![0] as typeof node;
    }
    expect(groups).toBe(MAX_GROUP_DEPTH);
  });
});
