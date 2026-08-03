import { describe, it, expect } from 'vitest';
import {
  BlockedImageUrlError,
  assertFetchableImageUrl,
  createImageFetcher,
  resolveImageUrl,
} from '../src/docs/image-fetcher.js';
import { EXIT_SYSTEM_ERROR, SystemError, exitCodeFor } from '../src/errors.js';

describe('resolveImageUrl', () => {
  it('passes absolute http(s) URLs through untouched', () => {
    expect(
      resolveImageUrl(
        'https://api.wafflebase.io/images/abc',
        'https://other.example',
      ),
    ).toBe('https://api.wafflebase.io/images/abc');
    expect(
      resolveImageUrl('http://localhost:3000/images/xyz', 'https://other'),
    ).toBe('http://localhost:3000/images/xyz');
  });

  it('passes data:, blob:, and file: URLs through untouched', () => {
    expect(resolveImageUrl('data:image/png;base64,AAA', 'https://x')).toBe(
      'data:image/png;base64,AAA',
    );
    expect(resolveImageUrl('blob:https://x/abc', 'https://y')).toBe(
      'blob:https://x/abc',
    );
  });

  it('prefixes server-relative paths with the configured base', () => {
    expect(resolveImageUrl('/images/abc', 'https://api.wafflebase.io')).toBe(
      'https://api.wafflebase.io/images/abc',
    );
  });

  it('strips a trailing slash from the base before joining', () => {
    expect(resolveImageUrl('/images/abc', 'https://api.wafflebase.io/')).toBe(
      'https://api.wafflebase.io/images/abc',
    );
  });

  it('inserts a slash for relative paths that omit the leading "/"', () => {
    expect(resolveImageUrl('images/abc', 'https://api.wafflebase.io')).toBe(
      'https://api.wafflebase.io/images/abc',
    );
  });

  it('returns the URL unchanged when serverBase is empty', () => {
    expect(resolveImageUrl('/images/abc', '')).toBe('/images/abc');
  });
});

describe('createImageFetcher', () => {
  it('GETs the resolved URL via the injected fetch and returns the blob', async () => {
    const calls: string[] = [];
    const stubFetch: typeof globalThis.fetch = async (input) => {
      calls.push(typeof input === 'string' ? input : (input as URL).toString());
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
    });

    const blob = await fetcher('/images/abc');
    expect(calls).toEqual(['https://api.wafflebase.io/images/abc']);
    expect(blob.type).toBe('image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('passes absolute URLs through without prefixing the base', async () => {
    const calls: string[] = [];
    const stubFetch: typeof globalThis.fetch = async (input) => {
      calls.push(typeof input === 'string' ? input : (input as URL).toString());
      return new Response(new Uint8Array([0]), { status: 200 });
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
    });

    await fetcher('https://cdn.example.com/photo.jpg');
    expect(calls).toEqual(['https://cdn.example.com/photo.jpg']);
  });

  it('throws a descriptive error on non-OK responses', async () => {
    const stubFetch: typeof globalThis.fetch = async () =>
      new Response('not found', { status: 404, statusText: 'Not Found' });

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
    });

    await expect(fetcher('/images/missing')).rejects.toThrow(
      /Image fetch failed: 404 Not Found for https:\/\/api\.wafflebase\.io\/images\/missing/,
    );
  });

  it('classifies a 5xx image response as a system error', async () => {
    const stubFetch: typeof globalThis.fetch = async () =>
      new Response('boom', { status: 503, statusText: 'Unavailable' });

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
    });

    const err = await fetcher('/images/abc')
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SystemError);
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
  });

  it('keeps a presigned query string out of the error message', async () => {
    const stubFetch: typeof globalThis.fetch = async () =>
      new Response('nope', { status: 403, statusText: 'Forbidden' });

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
    });

    const err = await fetcher('https://cdn.example.com/p.jpg?sig=s3cret')
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as Error).message).toContain('https://cdn.example.com/p.jpg');
    expect((err as Error).message).not.toContain('s3cret');
  });

  it('refuses document-supplied internal and non-http URLs before fetching', async () => {
    const calls: string[] = [];
    const stubFetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(new Uint8Array([0]), { status: 200 });
    };
    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
    });

    await expect(fetcher('file:///etc/passwd')).rejects.toBeInstanceOf(
      BlockedImageUrlError,
    );
    await expect(
      fetcher('http://169.254.169.254/latest/meta-data/'),
    ).rejects.toBeInstanceOf(BlockedImageUrlError);
    expect(calls).toEqual([]);
  });
});

describe('assertFetchableImageUrl', () => {
  const base = 'https://api.wafflebase.io';

  it('allows public http(s) and data URLs', () => {
    expect(() =>
      assertFetchableImageUrl('https://cdn.example.com/a.png', base),
    ).not.toThrow();
    expect(() =>
      assertFetchableImageUrl('http://cdn.example.com/a.png', base),
    ).not.toThrow();
    expect(() =>
      assertFetchableImageUrl('data:image/png;base64,AAA', base),
    ).not.toThrow();
  });

  it('rejects schemes that are not network image fetches', () => {
    for (const url of [
      'file:///etc/passwd',
      'blob:https://x/abc',
      'ftp://example.com/a.png',
    ]) {
      expect(() => assertFetchableImageUrl(url, base)).toThrow(
        BlockedImageUrlError,
      );
    }
  });

  it('rejects loopback, private, CGNAT and link-local hosts', () => {
    for (const url of [
      'http://127.0.0.1/a.png',
      'http://localhost:8080/a.png',
      'http://[::1]/a.png',
      'http://10.0.0.5/a.png',
      'http://172.16.4.4/a.png',
      'http://192.168.1.1/a.png',
      'http://100.100.0.1/a.png',
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
    ]) {
      expect(() => assertFetchableImageUrl(url, base)).toThrow(
        BlockedImageUrlError,
      );
    }
  });

  it('allows the configured server even when it is local (dev setup)', () => {
    expect(() =>
      assertFetchableImageUrl(
        'http://localhost:3000/images/abc',
        'http://localhost:3000',
      ),
    ).not.toThrow();
    // …but only that exact host:port.
    expect(() =>
      assertFetchableImageUrl(
        'http://localhost:9999/images/abc',
        'http://localhost:3000',
      ),
    ).toThrow(BlockedImageUrlError);
  });

  it('rejects a src that is not a URL at all', () => {
    expect(() => assertFetchableImageUrl('/images/abc', '')).toThrow(
      BlockedImageUrlError,
    );
  });
});
