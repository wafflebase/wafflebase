/* eslint-disable @typescript-eslint/no-explicit-any -- fakeStore is a
   minimal SlidesStore stub; typing `init`/`added` precisely would just
   re-declare the store's element-init union for no test-clarity gain. */
import { describe, it, expect, vi } from 'vitest';
import { insertImageOnSlide, computeImageFrame } from './insert-image';

function fakeStore(meta: object = {}) {
  const added: { slideId: string; init: any }[] = [];
  return {
    read: () => ({ meta }),
    batch: (fn: () => void) => fn(),
    addElement: (slideId: string, init: any) => {
      added.push({ slideId, init });
      return 'img-1';
    },
    added,
  } as any;
}

describe('insertImageOnSlide center override', () => {
  it('centers the image frame on `center` when provided (keeps computed size)', async () => {
    const store = fakeStore();
    const upload = vi.fn().mockResolvedValue({ url: 'u', w: 100, h: 100 });
    await insertImageOnSlide({ store, slideId: 'board', file: {} as File, upload, center: { x: 1000, y: 2000 } });
    const { init } = store.added[0];
    expect(init.frame.w).toBe(100);
    expect(init.frame.h).toBe(100);
    expect(init.frame.x).toBe(1000 - 100 / 2);
    expect(init.frame.y).toBe(2000 - 100 / 2);
  });

  it('falls back to slide-center framing when center is omitted', async () => {
    const store = fakeStore();
    const upload = vi.fn().mockResolvedValue({ url: 'u', w: 100, h: 100 });
    await insertImageOnSlide({ store, slideId: 's1', file: {} as File, upload });
    const { init } = store.added[0];
    const expected = computeImageFrame(100, 100);
    expect(init.frame.x).toBe(expected.x);
    expect(init.frame.y).toBe(expected.y);
  });
});
