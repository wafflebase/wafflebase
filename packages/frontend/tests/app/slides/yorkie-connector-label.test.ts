import { describe, it, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import type { Document } from '@yorkie-js/sdk';
import type {
  ConnectorElement,
  ElementInit,
  SlidesStore,
  TextBody,
} from '@wafflebase/slides';
import { SYNTHETIC_SLIDE_ID } from '@wafflebase/board';
import type { YorkieSlidesRoot } from '../../../src/types/slides-document.ts';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from '../../../src/app/slides/yorkie-slides-store.ts';
import { YorkieBoardStore } from '../../../src/app/board/yorkie-board-store.ts';
import { makeYorkieBoardDoc } from '../../../src/app/board/__testkit__';

const label: TextBody = {
  blocks: [
    {
      id: 'b1',
      type: 'paragraph',
      inlines: [{ text: 'yes', style: { fontSize: 14 } }],
      style: { alignment: 'center' },
    },
  ] as TextBody['blocks'],
};

const connectorInit = (): ElementInit => ({
  type: 'connector',
  routing: 'straight',
  start: { kind: 'free', x: 0, y: 0 },
  end: { kind: 'free', x: 100, y: 0 },
  arrowheads: {},
  frame: { x: 0, y: 0, w: 100, h: 0, rotation: 0 },
});

function slidesStore(): { store: SlidesStore; slideId: string } {
  const doc: Document<YorkieSlidesRoot> = new yorkie.Document<YorkieSlidesRoot>(
    `test-label-${Date.now()}-${Math.random()}`,
  );
  ensureSlidesRoot(doc);
  const store = new YorkieSlidesStore(doc);
  let slideId = '';
  store.batch(() => {
    slideId = store.addSlide('blank');
  });
  return { store, slideId };
}

function boardStore(): { store: SlidesStore; slideId: string } {
  return { store: new YorkieBoardStore(makeYorkieBoardDoc()), slideId: SYNTHETIC_SLIDE_ID };
}

describe.each([
  ['YorkieSlidesStore', slidesStore],
  ['YorkieBoardStore', boardStore],
])('%s.updateConnectorLabel', (_name, make) => {
  it('writes, reads back and removes a label; undo restores it', () => {
    const { store, slideId } = make();
    let id = '';
    store.batch(() => {
      id = store.addElement(slideId, connectorInit());
    });
    const read = () =>
      store.read().slides[0].elements.find((e) => e.id === id) as ConnectorElement;
    expect(read().label).toBeUndefined();

    store.batch(() => store.updateConnectorLabel(slideId, id, label));
    expect(read().label?.blocks[0].inlines[0].text).toBe('yes');

    store.batch(() => store.updateConnectorLabel(slideId, id, undefined));
    expect(read().label).toBeUndefined();

    store.undo();
    expect(read().label?.blocks[0].inlines[0].text).toBe('yes');
  });

  it('a connector created with a label (paste / duplicate) keeps it', () => {
    const { store, slideId } = make();
    let id = '';
    store.batch(() => {
      id = store.addElement(slideId, { ...connectorInit(), label } as ElementInit);
    });
    const c = store.read().slides[0].elements.find((e) => e.id === id) as ConnectorElement;
    expect(c.label?.blocks[0].inlines[0].text).toBe('yes');
  });
});
