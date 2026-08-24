// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  getOrLoadImage,
  isImageFailed,
  setImageUrlResolver,
  clearImageCacheForTests,
} from '../../../src/view/canvas/image-cache';

// Captures every constructed image so a test can inspect the URL actually
// fetched. `onerror` fires on the next microtask so failure paths resolve.
const created: FakeImage[] = [];
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  private _src = '';
  get src(): string {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => this.onerror?.());
  }
  constructor() {
    created.push(this);
  }
}

const flush = (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(() => resolve()));

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal('Image', FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearImageCacheForTests();
});

const LOGICAL = '/api/v1/workspaces/w1/images/a.png';

describe('setImageUrlResolver', () => {
  it('fetches the resolved URL, not the logical src', () => {
    setImageUrlResolver((s) => `${s}?token=T`);
    getOrLoadImage(LOGICAL, () => undefined);
    expect(created).toHaveLength(1);
    expect(created[0].src).toContain('token=T');
  });

  it('isImageFailed keys on the resolved URL so the failure is visible via the logical src', async () => {
    setImageUrlResolver((s) => `${s}?token=T`);
    getOrLoadImage(LOGICAL, () => undefined);
    await flush();
    // The renderer checks failure with the CRDT-stored (logical) src.
    expect(isImageFailed(LOGICAL)).toBe(true);
  });

  it('is identity by default (no token appended)', () => {
    getOrLoadImage(LOGICAL, () => undefined);
    expect(created[0].src).not.toContain('token=');
  });

  it('clearing with null restores identity', () => {
    setImageUrlResolver((s) => `${s}?token=T`);
    setImageUrlResolver(null);
    getOrLoadImage(LOGICAL, () => undefined);
    expect(created[0].src).not.toContain('token=');
  });
});
