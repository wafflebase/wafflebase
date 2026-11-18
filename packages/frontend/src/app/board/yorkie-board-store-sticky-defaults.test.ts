import { describe, it, expect } from 'vitest';
import type { ElementInit } from '@wafflebase/slides';
import {
  STICKY_CORNER_ADJ,
  STICKY_ROLE,
  STICKY_SHADOW,
  STICKY_TEXT_INSET,
  SYNTHETIC_SLIDE_ID,
} from '@wafflebase/board';
import { YorkieBoardStore } from './yorkie-board-store';
import { makeYorkieBoardDoc } from './__testkit__';

/** A sticky as boards stored it before the preset carried radius + padding. */
const legacySticky = (): ElementInit =>
  ({
    type: 'shape',
    frame: { x: 0, y: 0, w: 180, h: 180, rotation: 0 },
    data: {
      kind: 'roundRect',
      role: STICKY_ROLE,
      fill: { kind: 'srgb', value: '#FFF8B8' },
      effects: { shadow: { ...STICKY_SHADOW } },
      text: { blocks: [], verticalAnchor: 'middle', autofit: 'shrink' },
    },
  }) as ElementInit;

describe('YorkieBoardStore sticky defaults', () => {
  it('reads an older sticky with the small corner radius and even padding', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    let id = '';
    store.batch(() => {
      id = store.addElement(SYNTHETIC_SLIDE_ID, legacySticky());
    });
    const el = store.read().slides[0].elements.find((e) => e.id === id)!;
    const data = el.data as { adjustments?: number[]; text: { inset?: unknown } };
    expect(data.adjustments).toEqual([STICKY_CORNER_ADJ]);
    expect(data.text.inset).toEqual(STICKY_TEXT_INSET);
  });

  it('keeps a radius somebody set on the sticky', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    const init = legacySticky();
    (init.data as { adjustments?: number[] }).adjustments = [12000];
    let id = '';
    store.batch(() => {
      id = store.addElement(SYNTHETIC_SLIDE_ID, init);
    });
    const el = store.read().slides[0].elements.find((e) => e.id === id)!;
    expect((el.data as { adjustments?: number[] }).adjustments).toEqual([12000]);
  });
});
