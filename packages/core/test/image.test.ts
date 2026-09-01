import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadImage } from '../src/image/index.js';

/**
 * A stand-in for `HTMLImageElement` that records what was set and lets a test
 * fire `onload` / `onerror` by hand. There is no network here — what is under
 * test is the CORS-then-retry ordering, which is the only reason this helper
 * exists rather than three copies of `new Image()`.
 */
class FakeImage {
  static created: FakeImage[] = [];
  crossOrigin: string | null = null;
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** `crossOrigin` as it stood when `src` was assigned. */
  corsAtRequest: string | null = null;

  constructor() {
    FakeImage.created.push(this);
  }

  setSrc(value: string) {
    this.corsAtRequest = this.crossOrigin;
    this.src = value;
  }
}

beforeEach(() => {
  FakeImage.created = [];
  vi.stubGlobal(
    'Image',
    class {
      constructor() {
        const fake = new FakeImage();
        return new Proxy(fake, {
          set(target, prop, value) {
            if (prop === 'src') {
              target.setSrc(value as string);
              return true;
            }
            (target as unknown as Record<string, unknown>)[prop as string] =
              value;
            return true;
          },
        }) as unknown as FakeImage;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadImage', () => {
  it('asks for CORS on the first attempt, before setting src', () => {
    // Assigning `crossOrigin` after the load has started has no effect on the
    // request already in flight, so the order is the whole point.
    loadImage('https://example.test/a.png', {
      onLoad: vi.fn(),
      onError: vi.fn(),
      onRetry: vi.fn(),
    });
    expect(FakeImage.created).toHaveLength(1);
    expect(FakeImage.created[0].corsAtRequest).toBe('anonymous');
    expect(FakeImage.created[0].src).toBe('https://example.test/a.png');
  });

  it('reports success without retrying', () => {
    const onLoad = vi.fn();
    const onRetry = vi.fn();
    loadImage('https://example.test/a.png', {
      onLoad,
      onError: vi.fn(),
      onRetry,
    });
    FakeImage.created[0].onload!();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(FakeImage.created).toHaveLength(1);
  });

  it('retries without CORS when the CORS attempt fails', () => {
    // A host that sends no `Access-Control-Allow-Origin` rejects the CORS load
    // outright. Rendering the image matters more than reading the canvas back,
    // so the retry drops the requirement rather than the image.
    const onError = vi.fn();
    const onRetry = vi.fn();
    loadImage('https://third-party.test/a.png', {
      onLoad: vi.fn(),
      onError,
      onRetry,
    });
    FakeImage.created[0].onerror!();

    expect(FakeImage.created).toHaveLength(2);
    expect(FakeImage.created[1].corsAtRequest).toBeNull();
    expect(FakeImage.created[1].src).toBe('https://third-party.test/a.png');
    // The caller must be able to re-point its cache at the retry.
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Not an error yet — the retry may still succeed.
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports the retry loading, so a cached element is the live one', () => {
    const onLoad = vi.fn();
    loadImage('https://third-party.test/a.png', {
      onLoad,
      onError: vi.fn(),
      onRetry: vi.fn(),
    });
    FakeImage.created[0].onerror!();
    FakeImage.created[1].onload!();
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('errors once the plain retry also fails, and does not retry again', () => {
    const onError = vi.fn();
    loadImage('https://broken.test/a.png', {
      onLoad: vi.fn(),
      onError,
      onRetry: vi.fn(),
    });
    FakeImage.created[0].onerror!();
    FakeImage.created[1].onerror!();

    expect(onError).toHaveBeenCalledTimes(1);
    // Two attempts total: a third would loop forever on a genuinely broken URL.
    expect(FakeImage.created).toHaveLength(2);
  });
});
