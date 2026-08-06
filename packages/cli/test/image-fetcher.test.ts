import { describe, it, expect } from 'vitest';
import {
  createImageFetcher,
  isPrivateAddress,
  resolveImageUrl,
} from '../src/docs/image-fetcher.js';
import {
  EXIT_SYSTEM_ERROR,
  EXIT_USER_ERROR,
  SystemError,
  exitCodeFor,
} from '../src/errors.js';

/** Public-resolving DNS stub, so no test touches the real resolver. */
const publicLookup = async () => ['93.184.216.34'];

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
      lookup: publicLookup,
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
      lookup: publicLookup,
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
      lookup: publicLookup,
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
      lookup: publicLookup,
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
      lookup: publicLookup,
    });

    const err = await fetcher('https://cdn.example.com/p.jpg?sig=s3cret')
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as Error).message).toContain('https://cdn.example.com/p.jpg');
    expect((err as Error).message).not.toContain('s3cret');
  });

  it('turns an unreachable image host into a NETWORK_ERROR system error', async () => {
    const stubFetch: typeof globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup: publicLookup,
    });

    const err = await fetcher('/images/abc')
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SystemError);
    expect((err as SystemError).code).toBe('NETWORK_ERROR');
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])(
    'allows %s',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe('createImageFetcher SSRF gate', () => {
  function fetcherWith(opts: {
    lookup?: (h: string) => Promise<string[]>;
    onFetch?: (url: string) => Response;
    serverBase?: string;
  }) {
    const calls: string[] = [];
    const stubFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push(url);
      return opts.onFetch?.(url) ?? new Response(new Uint8Array([1]));
    };
    return {
      calls,
      fetcher: createImageFetcher({
        serverBase: opts.serverBase ?? 'https://api.wafflebase.io',
        fetch: stubFetch,
        lookup: opts.lookup ?? publicLookup,
      }),
    };
  }

  it.each([
    ['file:', 'file:///etc/passwd'],
    ['blob:', 'blob:https://x/abc'],
  ])('refuses to dereference a %s URL', async (_label, src) => {
    const { fetcher, calls } = fetcherWith({});
    const err = await fetcher(src)
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('IMAGE_URL_BLOCKED');
    expect(exitCodeFor(err)).toBe(EXIT_USER_ERROR);
    expect(calls).toEqual([]);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:9000/secret',
    'http://[::ffff:7f00:1]/secret',
    'http://10.0.0.5/internal',
  ])('refuses the internal address %s', async (src) => {
    const { fetcher, calls } = fetcherWith({});
    await expect(fetcher(src)).rejects.toThrow(/Refusing to fetch/);
    expect(calls).toEqual([]);
  });

  it.each(['http://localhost:9000/x', 'http://metadata.google.internal/x'])(
    'refuses the internal host %s',
    async (src) => {
      const { fetcher, calls } = fetcherWith({});
      await expect(fetcher(src)).rejects.toThrow(/Refusing to fetch/);
      expect(calls).toEqual([]);
    },
  );

  it('refuses a public name whose DNS record points at loopback', async () => {
    const { fetcher, calls } = fetcherWith({
      lookup: async () => ['127.0.0.1'],
    });
    await expect(fetcher('http://evil.example/x')).rejects.toThrow(
      /resolves to an internal address/,
    );
    expect(calls).toEqual([]);
  });

  it('allows a public name that resolves publicly', async () => {
    const { fetcher, calls } = fetcherWith({});
    await fetcher('https://cdn.example.com/photo.jpg');
    expect(calls).toEqual(['https://cdn.example.com/photo.jpg']);
  });

  it('does not block on an unresolvable name — the fetch reports it', async () => {
    const { fetcher, calls } = fetcherWith({
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    await fetcher('https://cdn.example.com/photo.jpg');
    expect(calls).toEqual(['https://cdn.example.com/photo.jpg']);
  });

  it('still allows the configured server even on localhost', async () => {
    const { fetcher, calls } = fetcherWith({
      serverBase: 'http://localhost:3000',
      lookup: async () => ['127.0.0.1'],
    });
    await fetcher('/images/abc');
    expect(calls).toEqual(['http://localhost:3000/images/abc']);
  });

  it('does not treat a public host as an IPv6 range (fc2.com)', async () => {
    const { fetcher, calls } = fetcherWith({});
    await fetcher('https://fc2.com/photo.jpg');
    expect(calls).toEqual(['https://fc2.com/photo.jpg']);
  });

  it('re-checks each redirect hop instead of trusting the first host', async () => {
    const { fetcher, calls } = fetcherWith({
      onFetch: (url) =>
        url === 'https://cdn.example.com/photo.jpg'
          ? new Response(null, {
              status: 302,
              headers: { location: 'http://169.254.169.254/latest/' },
            })
          : new Response(new Uint8Array([1])),
    });

    await expect(fetcher('https://cdn.example.com/photo.jpg')).rejects.toThrow(
      /Refusing to fetch/,
    );
    expect(calls).toEqual(['https://cdn.example.com/photo.jpg']);
  });

  it('follows a redirect to another allowed host', async () => {
    const { fetcher, calls } = fetcherWith({
      onFetch: (url) =>
        url === 'https://cdn.example.com/photo.jpg'
          ? new Response(null, {
              status: 302,
              headers: { location: 'https://images.example.com/photo.jpg' },
            })
          : new Response(new Uint8Array([7])),
    });

    const blob = await fetcher('https://cdn.example.com/photo.jpg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([7]),
    );
    expect(calls).toEqual([
      'https://cdn.example.com/photo.jpg',
      'https://images.example.com/photo.jpg',
    ]);
  });

  it('stops after too many redirects', async () => {
    const { fetcher, calls } = fetcherWith({
      onFetch: () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.com/loop' },
        }),
    });

    await expect(fetcher('https://cdn.example.com/loop')).rejects.toThrow(
      /too many redirects/,
    );
    expect(calls.length).toBe(6);
  });
});
