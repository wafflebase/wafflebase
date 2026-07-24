import yorkie from '@yorkie-js/sdk';
import type { Document as YorkieDocument } from '@yorkie-js/sdk';
import type { ElementInit } from '@wafflebase/slides';
import type { YorkieBoardRoot } from '@/types/board-document';

/**
 * Build a fresh in-memory Yorkie document seeded with the board root
 * shape, mirroring `makeDoc()` in `yorkie-slides-store.test.ts` (which
 * builds a bare `yorkie.Document` + calls `ensureSlidesRoot`). The board
 * has no `ensureBoardRoot` migration helper yet — Task 7 only shipped
 * `initialBoardRoot()`, a plain factory, not a Yorkie-seeding function —
 * so we seed the root directly here via one `doc.update`.
 */
export function makeYorkieBoardDoc(): YorkieDocument<YorkieBoardRoot> {
  const doc = new yorkie.Document<YorkieBoardRoot>(
    `test-board-${Date.now()}-${Math.random()}`,
  );
  doc.update((r) => {
    r.meta = { title: 'Untitled board' };
    r.elements = [];
  });
  return doc;
}

/** Minimal `ElementInit` for a shape element, for `store.addElement` tests. */
export function makeShapeInit(): ElementInit {
  return {
    type: 'shape',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    data: { kind: 'rect' },
  };
}
