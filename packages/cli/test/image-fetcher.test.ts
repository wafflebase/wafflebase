import { describe, it, expect, vi } from 'vitest';
import {
  assertFetchableImageUrl,
  createImageFetcher,
  parseAllowedHosts,
  resolveImageUrl,
} from '../src/docs/image-fetcher.js';

describe('parseAllowedHosts', () => {
  it('splits, trims, lowercases and drops empties', () => {
    expect(parseAllowedHosts(' 10.0.0.5:9000 , MinIO.internal ,,')).toEqual([
      '10.0.0.5:9000',
      'minio.internal',
    ]);
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts('')).toEqual([]);
  });
});

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

describe('assertFetchableImageUrl', () => {
  const server = 'https://api.wafflebase.io';

  it('allows public http(s) and data URLs', () => {
    expect(() =>
      assertFetchableImageUrl('https://cdn.example.com/a.png', server),
    ).not.toThrow();
    expect(() =>
      assertFetchableImageUrl('http://cdn.example.com/a.png', server),
    ).not.toThrow();
    expect(() =>
      assertFetchableImageUrl('data:image/png;base64,AAA', server),
    ).not.toThrow();
  });

  it('refuses schemes that are not http, https, or data', () => {
    for (const url of [
      'file:///etc/passwd',
      'blob:https://x/abc',
      'ftp://internal.example/a.png',
    ]) {
      expect(() => assertFetchableImageUrl(url, server)).toThrow(
        /Refusing to fetch image over/,
      );
    }
  });

  it('refuses loopback, private, link-local and CGNAT literals', () => {
    for (const host of [
      '169.254.169.254',
      '127.0.0.1',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.100.0.1',
      'localhost',
      'app.localhost',
      '[::1]',
      '[fd00::1]',
      '[fe80::1]',
      '[::ffff:169.254.169.254]',
    ]) {
      expect(() =>
        assertFetchableImageUrl(`http://${host}/a.png`, server),
      ).toThrow(/non-public address/);
    }
  });

  it('refuses the trailing-dot spelling of a loopback name', () => {
    // `new URL('http://localhost./a').hostname` is `localhost.` — the WHATWG
    // parser keeps the root label on a *domain* host, while every OS resolver
    // treats it as the same name. An exact-match set misses it.
    for (const host of ['localhost.', 'localhost..', 'app.localhost.']) {
      expect(() =>
        assertFetchableImageUrl(`http://${host}/a.png`, server),
      ).toThrow(/non-public address/);
    }
  });

  it('does not mistake public addresses for private ones', () => {
    for (const host of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '8.8.8.8']) {
      expect(() =>
        assertFetchableImageUrl(`http://${host}/a.png`, server),
      ).not.toThrow();
    }
  });

  it('names the escape hatch when it refuses a private address', () => {
    expect(() =>
      assertFetchableImageUrl('http://10.0.0.5:9000/a.png', server),
    ).toThrow(/WAFFLEBASE_IMAGE_HOSTS/);
  });

  it('allows a private host the operator listed explicitly', () => {
    // A split-origin self-hosted install (blobs on an internal MinIO) is a
    // deployment shape, not an attack — but the operator has to name it.
    expect(() =>
      assertFetchableImageUrl('http://10.0.0.5:9000/a.png', server, [
        '10.0.0.5:9000',
      ]),
    ).not.toThrow();
    // Host without a port matches any port on that host.
    expect(() =>
      assertFetchableImageUrl('http://127.0.0.1:9200/a.png', server, [
        '127.0.0.1',
      ]),
    ).not.toThrow();
    // A different host is still refused.
    expect(() =>
      assertFetchableImageUrl('http://10.0.0.6:9000/a.png', server, [
        '10.0.0.5:9000',
      ]),
    ).toThrow(/non-public address/);
  });

  it('exempts the configured server, so a local --server keeps working', () => {
    expect(() =>
      assertFetchableImageUrl(
        'http://localhost:3000/images/abc',
        'http://localhost:3000',
      ),
    ).not.toThrow();
    // A different port on the same host is a different origin — still refused.
    expect(() =>
      assertFetchableImageUrl(
        'http://localhost:9200/images/abc',
        'http://localhost:3000',
      ),
    ).toThrow(/non-public address/);
  });

  it('refuses a URL that never resolved to an absolute one', () => {
    expect(() => assertFetchableImageUrl('/images/abc', '')).toThrow(
      /no server to resolve it against/,
    );
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

  it('refuses an image src pointing at a non-public address', async () => {
    // The `src` is document content, so an export must not be talked into
    // GETting the instance-metadata endpoint from the operator's machine.
    const stubFetch = vi.fn();
    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch as unknown as typeof globalThis.fetch,
    });

    await expect(
      fetcher('http://169.254.169.254/latest/meta-data/iam/security-credentials/'),
    ).rejects.toThrow(/non-public address/);
    await expect(fetcher('file:///etc/passwd')).rejects.toThrow(
      /Refusing to fetch image over "file:"/,
    );
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it('still fetches the configured server even when it is local', async () => {
    const calls: string[] = [];
    const stubFetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(new Uint8Array([1]), { status: 200 });
    };
    const fetcher = createImageFetcher({
      serverBase: 'http://localhost:3000',
      fetch: stubFetch,
    });

    await fetcher('/images/abc');
    expect(calls).toEqual(['http://localhost:3000/images/abc']);
  });

  it('re-checks the target of a redirect instead of following it blindly', async () => {
    // A public host the guard allows can answer 302 -> the metadata endpoint.
    // `fetch` follows redirects by default and re-runs no caller-side check,
    // so the guard has to own the hop.
    const calls: string[] = [];
    const stubFetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(null, {
        status: 302,
        headers: {
          location:
            'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
        },
      });
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
    });

    await expect(fetcher('https://attacker.example/x.png')).rejects.toThrow(
      /non-public address/,
    );
    // Only the first hop was ever requested.
    expect(calls).toEqual(['https://attacker.example/x.png']);
  });

  it('follows a redirect to another public host', async () => {
    const calls: string[] = [];
    const stubFetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Response(null, {
          status: 301,
          headers: { location: '/moved/a.png' },
        });
      }
      return new Response(new Uint8Array([7]), { status: 200 });
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
    });

    const blob = await fetcher('https://cdn.example.com/photo.jpg');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([7]);
    expect(calls).toEqual([
      'https://cdn.example.com/photo.jpg',
      'https://cdn.example.com/moved/a.png',
    ]);
  });

  it('gives up rather than following an endless redirect chain', async () => {
    let n = 0;
    const stubFetch: typeof globalThis.fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: `https://cdn.example.com/${n++}.png` },
      });

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
    });

    await expect(fetcher('https://cdn.example.com/a.png')).rejects.toThrow(
      /Too many redirects/,
    );
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
});
