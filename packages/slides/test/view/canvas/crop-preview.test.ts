import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCtxSpy, asCtx } from '../../../src/view/canvas/ctx-spy';

// Mock the image cache so the preview sees a "loaded" bitmap without a
// real network/DOM image. naturalWidth/Height are irrelevant here — the
// crop preview draws the whole bitmap into the `full` rect.
const fakeImg = { naturalWidth: 800, naturalHeight: 600 } as HTMLImageElement;
const getOrLoadImage = vi.fn();
vi.mock('../../../src/view/canvas/image-cache', () => ({
  getOrLoadImage: (...args: unknown[]) => getOrLoadImage(...args),
  isImageFailed: () => false,
}));

import { drawCropPreview } from '../../../src/view/canvas/image-renderer';

describe('drawCropPreview', () => {
  beforeEach(() => {
    getOrLoadImage.mockReset();
  });

  it('no-ops while the image is still loading', () => {
    getOrLoadImage.mockReturnValue(null);
    const ctx = createCtxSpy();
    drawCropPreview(
      asCtx(ctx),
      {
        elementId: 'e1',
        src: 'x.png',
        full: { x: 0, y: 0, w: 400, h: 300 },
        window: { x: 50, y: 40, w: 200, h: 150 },
      },
      () => undefined,
    );
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('paints a dimmed full pass and a clipped bright window pass', () => {
    getOrLoadImage.mockReturnValue(fakeImg);
    const ctx = createCtxSpy();
    drawCropPreview(
      asCtx(ctx),
      {
        elementId: 'e1',
        src: 'x.png',
        full: { x: 0, y: 0, w: 400, h: 300 },
        window: { x: 50, y: 40, w: 200, h: 150 },
        dimAlpha: 0.4,
      },
      () => undefined,
    );

    // Both passes draw the whole bitmap into the `full` rect.
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, fakeImg, 0, 0, 400, 300);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(2, fakeImg, 0, 0, 400, 300);

    // Bright pass clips to the crop window.
    expect(ctx.rect).toHaveBeenCalledWith(50, 40, 200, 150);
    expect(ctx.clip).toHaveBeenCalledTimes(1);
  });
});
