import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  loadImage,
  setCredentialedImageOrigins,
} from '../src/image/index.js';

/** The app's own API origin, as `main.tsx` declares it. */
const OURS = 'https://api.wafflebase.test';

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
  setCredentialedImageOrigins([]);
});

const callbacks = () => ({
  onLoad: vi.fn(),
  onError: vi.fn(),
  onRetry: vi.fn(),
});

describe('loadImage', () => {
  it('asks for credentialed CORS on our own origin, before setting src', () => {
    // `use-credentials`, not `anonymous`: the workspace image route authorizes
    // on the session cookie, and `anonymous` sends none cross-origin — it
    // would be refused, fall back, and taint the canvas anyway. Assigning
    // `crossOrigin` after the load has started has no effect on the request
    // in flight, so the order matters too.
    setCredentialedImageOrigins([OURS]);
    loadImage(`${OURS}/images/a.png`, callbacks());
    expect(FakeImage.created).toHaveLength(1);
    expect(FakeImage.created[0].corsAtRequest).toBe('use-credentials');
    expect(FakeImage.created[0].src).toBe(`${OURS}/images/a.png`);
  });

  it('loads a third-party host plainly, with no CORS attempt at all', () => {
    // Most public image hosts send no `Access-Control-Allow-Origin`, so asking
    // would cost a failed request per image and end in the same tainted
    // canvas. Their behaviour is unchanged by this module existing.
    setCredentialedImageOrigins([OURS]);
    const cbs = callbacks();
    loadImage('https://third-party.test/a.png', cbs);

    expect(FakeImage.created).toHaveLength(1);
    expect(FakeImage.created[0].corsAtRequest).toBeNull();

    FakeImage.created[0].onerror!();
    // Straight to the error: there was no CORS attempt to fall back from.
    expect(cbs.onRetry).not.toHaveBeenCalled();
    expect(cbs.onError).toHaveBeenCalledTimes(1);
    expect(FakeImage.created).toHaveLength(1);
  });

  it('drops a plain-http origin rather than sending it credentials', () => {
    // A deployment can be configured with non-`Secure` cookies, so
    // `use-credentials` against an http origin would put the session cookie on
    // the wire in cleartext.
    setCredentialedImageOrigins(['http://images.example.test']);
    loadImage('http://images.example.test/a.png', callbacks());
    expect(FakeImage.created[0].corsAtRequest).toBeNull();
  });

  it('keeps loopback, which is every developer’s backend', () => {
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://api.localhost:3000',
    ]) {
      FakeImage.created = [];
      setCredentialedImageOrigins([origin]);
      loadImage(`${origin}/images/a.png`, callbacks());
      expect(FakeImage.created[0].corsAtRequest).toBe('use-credentials');
    }
  });

  it('ignores an unparseable origin', () => {
    setCredentialedImageOrigins(['not-a-url']);
    loadImage('https://anything.test/a.png', callbacks());
    expect(FakeImage.created[0].corsAtRequest).toBeNull();
  });

  it('asks for nothing when no origin is configured', () => {
    // A consumer that never configures this gets exactly the behaviour that
    // existed before the module did.
    loadImage(`${OURS}/images/a.png`, callbacks());
    expect(FakeImage.created[0].corsAtRequest).toBeNull();
  });

  it('does not ask for CORS on a data: URL', () => {
    // A `data:` URL never taints the canvas, so there is nothing to gain and a
    // CORS attribute on one is meaningless.
    setCredentialedImageOrigins([OURS]);
    loadImage('data:image/png;base64,iVBORw0KGgo=', callbacks());
    expect(FakeImage.created[0].corsAtRequest).toBeNull();
  });

  it('reports success without retrying', () => {
    setCredentialedImageOrigins([OURS]);
    const cbs = callbacks();
    loadImage(`${OURS}/images/a.png`, cbs);
    FakeImage.created[0].onload!();
    expect(cbs.onLoad).toHaveBeenCalledTimes(1);
    expect(cbs.onRetry).not.toHaveBeenCalled();
    expect(FakeImage.created).toHaveLength(1);
  });

  it('retries plainly when our own origin refuses the CORS load', () => {
    // A misconfigured allowlist, or an image belonging to another deployment.
    // Rendering it matters more than reading the canvas back.
    setCredentialedImageOrigins([OURS]);
    const cbs = callbacks();
    loadImage(`${OURS}/images/a.png`, cbs);
    FakeImage.created[0].onerror!();

    expect(FakeImage.created).toHaveLength(2);
    expect(FakeImage.created[1].corsAtRequest).toBeNull();
    expect(FakeImage.created[1].src).toBe(`${OURS}/images/a.png`);
    // The caller must be able to re-point its cache at the retry.
    expect(cbs.onRetry).toHaveBeenCalledTimes(1);
    // Not an error yet — the retry may still succeed.
    expect(cbs.onError).not.toHaveBeenCalled();
  });

  it('reports the retry loading, so a cached element is the live one', () => {
    setCredentialedImageOrigins([OURS]);
    const cbs = callbacks();
    loadImage(`${OURS}/images/a.png`, cbs);
    FakeImage.created[0].onerror!();
    FakeImage.created[1].onload!();
    expect(cbs.onLoad).toHaveBeenCalledTimes(1);
  });

  it('errors once the plain retry also fails, and does not retry again', () => {
    setCredentialedImageOrigins([OURS]);
    const cbs = callbacks();
    loadImage(`${OURS}/images/a.png`, cbs);
    FakeImage.created[0].onerror!();
    FakeImage.created[1].onerror!();

    expect(cbs.onError).toHaveBeenCalledTimes(1);
    // Two attempts total: a third would loop forever on a genuinely broken URL.
    expect(FakeImage.created).toHaveLength(2);
  });
});
