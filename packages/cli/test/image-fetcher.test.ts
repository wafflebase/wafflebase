import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  assertFetchableImageUrl,
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
    '255.255.255.255',
    '224.0.0.1',
    '198.18.0.1',
    '192.0.0.1',
    '64:ff9b::a9fe:a9fe', // NAT64 → 169.254.169.254
    '64:ff9b::7f00:1', // NAT64 → 127.0.0.1
    '64:ff9b:1::1', // local-use NAT64 prefix
    '2002:7f00:1::1', // 6to4 → 127.0.0.1
    '2001:0:5db8:d822:0:0:80ff:fffe', // Teredo, client ~(127.0.0.1)
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '172.32.0.1',
    '2606:4700::1111',
    '64:ff9b::808:808', // NAT64 → 8.8.8.8 stays reachable
    '2002:5db8:d822::1', // 6to4 → 93.184.216.34
    '2001:0:5db8:d822:0:0:f7f7:f7f7', // Teredo, client ~(8.8.8.8)
  ])(
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

  it('fails closed when the name cannot be resolved', async () => {
    const { fetcher, calls } = fetcherWith({
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    const err = await fetcher('https://cdn.example.com/photo.jpg')
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SystemError);
    expect((err as SystemError).code).toBe('NETWORK_ERROR');
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
    expect(calls).toEqual([]);
  });

  it('fails closed when the resolver answers with no addresses', async () => {
    const { fetcher, calls } = fetcherWith({ lookup: async () => [] });
    const err = await fetcher('https://cdn.example.com/photo.jpg')
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SystemError);
    expect(calls).toEqual([]);
  });

  it('allows the configured server spelled as another name for it', async () => {
    // The frontend persists absolute image URLs, so a dev document says
    // `http://localhost:3000/...` while the CLI may be pointed at
    // `--server http://127.0.0.1:3000`. Same listener, different name.
    const { fetcher, calls } = fetcherWith({
      serverBase: 'http://127.0.0.1:3000',
      lookup: async (h) => (h === 'localhost' ? ['127.0.0.1'] : []),
    });
    await fetcher('http://localhost:3000/api/v1/workspaces/w/images/abc');
    expect(calls).toEqual([
      'http://localhost:3000/api/v1/workspaces/w/images/abc',
    ]);
  });

  it('allows the configured server named where the doc used its address', async () => {
    const { fetcher, calls } = fetcherWith({
      serverBase: 'http://localhost:3000',
      lookup: async (h) => (h === 'localhost' ? ['127.0.0.1'] : []),
    });
    await fetcher('http://127.0.0.1:3000/images/abc');
    expect(calls).toEqual(['http://127.0.0.1:3000/images/abc']);
  });

  it('does not extend the server exemption to another port on that host', async () => {
    const { fetcher, calls } = fetcherWith({
      serverBase: 'http://localhost:3000',
      lookup: async (h) => (h === 'localhost' ? ['127.0.0.1'] : []),
    });
    await expect(fetcher('http://127.0.0.1:9200/_search')).rejects.toThrow(
      /Refusing to fetch/,
    );
    expect(calls).toEqual([]);
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

describe('assertFetchableImageUrl address pinning', () => {
  const SERVER = new URL('http://127.0.0.1:3000');

  it('pins a public host to the addresses it approved', async () => {
    await expect(
      assertFetchableImageUrl('https://cdn.example.com/p.jpg', SERVER, () =>
        Promise.resolve(['93.184.216.34', '8.8.8.8']),
      ),
    ).resolves.toEqual(['93.184.216.34', '8.8.8.8']);
  });

  it('opens no connection for a data: URL', async () => {
    await expect(
      assertFetchableImageUrl('data:image/png;base64,AAA', SERVER, () =>
        Promise.resolve([]),
      ),
    ).resolves.toBeNull();
  });

  it('drops the internal addresses a server-port host also answers with', async () => {
    // The exemption is per address: a host that answers with the
    // server's address *and* an internal one must not get the
    // private-address check skipped for the internal one.
    const allowed = await assertFetchableImageUrl(
      'http://mixed.example:3000/x',
      SERVER,
      async (h) =>
        h === 'mixed.example' ? ['127.0.0.1', '10.0.0.5'] : ['127.0.0.1'],
    );
    expect(allowed).toEqual(['127.0.0.1']);
  });

  it('refuses a server-port host that shares no address with the server', async () => {
    await expect(
      assertFetchableImageUrl('http://mixed.example:3000/x', SERVER, async (h) =>
        h === 'mixed.example' ? ['10.0.0.5', '169.254.169.254'] : ['127.0.0.1'],
      ),
    ).rejects.toThrow(/resolves to an internal address/);
  });

  it('drops the private half of a public host’s answer', async () => {
    // Nothing is granted by allowing the public address: the request is
    // pinned to what comes back, so the private one is unreachable.
    await expect(
      assertFetchableImageUrl('https://split.example/p.jpg', SERVER, () =>
        Promise.resolve(['93.184.216.34', '169.254.169.254']),
      ),
    ).resolves.toEqual(['93.184.216.34']);
  });
});

describe('createImageFetcher over a real listener', () => {
  /** A loopback server that 302s `/r` to `/img`, which serves bytes. */
  async function listener(): Promise<{ server: Server; port: number }> {
    const server = createServer((req, res) => {
      if (req.url === '/r') {
        res.writeHead(302, { location: '/img' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from([1, 2, 3]));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return { server, port: address.port };
  }

  it('follows a redirect through the real transport, pinned to the gated address', async () => {
    const { server, port } = await listener();
    try {
      const fetcher = createImageFetcher({
        serverBase: `http://127.0.0.1:${port}`,
      });
      const blob = await fetcher('/r');
      expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([
        1, 2, 3,
      ]);
    } finally {
      server.close();
    }
  });

  it('reads the hop through undici when the fetch layer opaque-filters it', async () => {
    // A spec-conformant `redirect: 'manual'` yields status 0 with no
    // headers, which carries neither the status nor the `Location` the
    // redirect loop needs. The fallback re-reads the hop, so redirects
    // still work (and are still gated) on such a runtime.
    const { server, port } = await listener();
    try {
      const fetcher = createImageFetcher({
        serverBase: `http://127.0.0.1:${port}`,
        fetch: async () => Response.error(),
      });
      const blob = await fetcher('/r');
      expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([
        1, 2, 3,
      ]);
    } finally {
      server.close();
    }
  });
});
