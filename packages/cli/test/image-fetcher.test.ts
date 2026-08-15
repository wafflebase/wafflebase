import { describe, it, expect, vi } from 'vitest';
import {
  assertFetchableImageUrl,
  assertResolvedHostIsPublic,
  createImageFetcher,
  IMAGE_HOSTS_ENV,
  parseAllowedHosts,
  resolveImageUrl,
  type HostLookup,
} from '../src/docs/image-fetcher.js';

/**
 * Every `createImageFetcher` test injects a resolver: the real one would ask
 * the OS about `cdn.example.com`, and a suite that reaches the network is a
 * suite that fails on a plane. `publicLookup` answers with a public address,
 * which is what these tests mean by "an ordinary host".
 */
const publicLookup: HostLookup = async () => ['93.184.216.34'];

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
  });

  it('exempts the server host on any port or scheme', () => {
    // The frontend writes *absolute* image URLs into document content, so a
    // doc authored against `http://localhost:3000` carries that spelling
    // forever. Pinning the exemption to the exact origin would refuse every
    // image in it whenever the CLI is pointed at the same machine by another
    // port or scheme — a working install that stops exporting.
    for (const src of [
      'http://localhost:3000/images/abc',
      'http://localhost:5173/images/abc',
      'https://localhost:3000/images/abc',
    ]) {
      expect(() =>
        assertFetchableImageUrl(src, 'http://localhost:8080'),
      ).not.toThrow();
    }
    // A *different* private host is still refused — that one needs the env var.
    expect(() =>
      assertFetchableImageUrl(
        'http://10.0.0.5:9000/images/abc',
        'http://localhost:3000',
      ),
    ).toThrow(/non-public address/);
  });

  it('refuses IPv6 spellings that embed or tunnel a private address', () => {
    // Enumerating "the private prefixes" misses every way IPv6 can carry an
    // IPv4 address. 2000::/3 is the only global-unicast range, and the two
    // tunnelling prefixes inside it are unwrapped or refused.
    for (const host of [
      '[64:ff9b::a9fe:a9fe]', // NAT64 well-known prefix → 169.254.169.254
      '[2002:a9fe:a9fe::]', // 6to4 → 169.254.169.254
      '[2002:0a00:0005::]', // 6to4 → 10.0.0.5
      '[2001:0:1234::1]', // Teredo
      '[2001:db8::1]', // documentation
      '[ff02::1]', // multicast
      '[100::1]', // discard-only
    ]) {
      expect(() =>
        assertFetchableImageUrl(`http://${host}/a.png`, server),
      ).toThrow(/non-public address/);
    }
    // A 6to4 address tunnelling a public IPv4, and an ordinary global
    // unicast address, are still fetchable.
    expect(() =>
      assertFetchableImageUrl('http://[2002:0808:0808::]/a.png', server),
    ).not.toThrow();
    expect(() =>
      assertFetchableImageUrl('http://[2606:4700::1111]/a.png', server),
    ).not.toThrow();
  });

  it('refuses multicast, broadcast and reserved IPv4 ranges', () => {
    for (const host of [
      '224.0.0.1',
      '239.255.255.250',
      '240.0.0.1',
      '255.255.255.255',
      '192.0.0.1',
      '198.18.0.1',
    ]) {
      expect(() =>
        assertFetchableImageUrl(`http://${host}/a.png`, server),
      ).toThrow(/non-public address/);
    }
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

  it('refuses an image src pointing at a non-public address', async () => {
    // The `src` is document content, so an export must not be talked into
    // GETting the instance-metadata endpoint from the operator's machine.
    const stubFetch = vi.fn();
    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch as unknown as typeof globalThis.fetch,
      lookup: publicLookup,
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
      lookup: publicLookup,
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
      lookup: publicLookup,
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
      lookup: publicLookup,
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
      lookup: publicLookup,
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
      lookup: publicLookup,
    });

    await expect(fetcher('/images/missing')).rejects.toThrow(
      /Image fetch failed: 404 Not Found for https:\/\/api\.wafflebase\.io\/images\/missing/,
    );
  });

  it('asks fetch not to follow redirects, on every hop', async () => {
    // The whole per-hop guard rests on this one option: with `fetch` following
    // redirects itself, the loop below never sees the target and the re-check
    // never happens. Assert the option, not just the behaviour of a stub that
    // would answer the same either way.
    const modes: (string | undefined)[] = [];
    const stubFetch: typeof globalThis.fetch = async (_input, init) => {
      modes.push(init?.redirect);
      if (modes.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.com/moved.png' },
        });
      }
      return new Response(new Uint8Array([9]), { status: 200 });
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup: publicLookup,
    });

    await fetcher('https://cdn.example.com/a.png');
    expect(modes).toEqual(['manual', 'manual']);
  });

  it('releases the body of a redirect it does not follow through', async () => {
    // Nothing reads a 3xx body; left undrained it pins its socket open until
    // the agent times out, which on a doc full of redirecting images stalls
    // the export.
    const seen: Response[] = [];
    const stubFetch: typeof globalThis.fetch = async () => {
      const res =
        seen.length === 0
          ? new Response('redirect body', {
              status: 302,
              headers: { location: 'https://cdn.example.com/moved.png' },
            })
          : new Response(new Uint8Array([1]), { status: 200 });
      seen.push(res);
      return res;
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup: publicLookup,
    });

    await fetcher('https://cdn.example.com/a.png');
    expect(seen[0].bodyUsed).toBe(true);
  });

  it('names an opaque redirect instead of reporting it as "failed: 0"', async () => {
    // A browser's `manual` mode answers with a status-0 opaque-redirect
    // response. Node's undici hands back the real 3xx — but if this ever runs
    // where it does not, the operator should read why, not `failed: 0`.
    // `Response` refuses to be constructed with status 0, so this stands in
    // with the other filtered response that carries it.
    const stubFetch: typeof globalThis.fetch = async () => Response.error();

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup: publicLookup,
    });

    await expect(fetcher('https://cdn.example.com/a.png')).rejects.toThrow(
      /opaque redirect/,
    );
  });

  it('refuses a public name that resolves to the metadata endpoint', async () => {
    // `169.254.169.254.nip.io` is an ordinary public name at wildcard DNS
    // that answers with the literal it embeds. A string check on the URL sees
    // nothing wrong with it, which is the whole trick.
    const stubFetch = vi.fn();
    const lookup: HostLookup = async (host) =>
      host === '169.254.169.254.nip.io' ? ['169.254.169.254'] : ['8.8.8.8'];

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch as unknown as typeof globalThis.fetch,
      lookup,
    });

    await expect(
      fetcher(
        'http://169.254.169.254.nip.io/latest/meta-data/iam/security-credentials/',
      ),
    ).rejects.toThrow(/resolves to 169\.254\.169\.254/);
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it('re-resolves the target of a redirect, not just its spelling', async () => {
    const calls: string[] = [];
    const stubFetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { location: 'http://metadata.internal.example/creds' },
      });
    };
    const lookup: HostLookup = async (host) =>
      host === 'metadata.internal.example' ? ['10.0.0.7'] : ['8.8.8.8'];

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup,
    });

    await expect(fetcher('https://cdn.example.com/a.png')).rejects.toThrow(
      /resolves to 10\.0\.0\.7/,
    );
    expect(calls).toEqual(['https://cdn.example.com/a.png']);
  });

  it('refuses a name that cannot be resolved rather than fetching it', async () => {
    const stubFetch = vi.fn();
    const lookup: HostLookup = async () => {
      throw new Error('ENOTFOUND');
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch as unknown as typeof globalThis.fetch,
      lookup,
    });

    await expect(fetcher('https://nowhere.example/a.png')).rejects.toThrow(
      /could not be resolved/,
    );
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it('never resolves a host the operator already exempted', async () => {
    // The configured server and WAFFLEBASE_IMAGE_HOSTS are decisions the
    // operator made; a resolver has no say in them, and a local `--server`
    // must keep working with no DNS at all.
    const lookup = vi.fn(async () => ['93.184.216.34']);
    const stubFetch: typeof globalThis.fetch = async () =>
      new Response(new Uint8Array([1]), { status: 200 });

    const fetcher = createImageFetcher({
      serverBase: 'http://localhost:3000',
      allowedHosts: ['minio.internal'],
      fetch: stubFetch,
      lookup,
    });

    await fetcher('/images/abc');
    await fetcher('http://minio.internal:9000/blob.png');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('reads the operator allow-list from the environment by default', async () => {
    // `allowedHosts` is the injectable form; the environment variable is the
    // one an operator actually sets, and nothing else exercises that wiring.
    const calls: string[] = [];
    const stubFetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(new Uint8Array([1]), { status: 200 });
    };
    const previous = process.env[IMAGE_HOSTS_ENV];
    process.env[IMAGE_HOSTS_ENV] = '10.0.0.5:9000';
    try {
      const fetcher = createImageFetcher({
        serverBase: 'https://api.wafflebase.io',
        fetch: stubFetch,
        lookup: publicLookup,
      });

      await fetcher('http://10.0.0.5:9000/blob.png');
      expect(calls).toEqual(['http://10.0.0.5:9000/blob.png']);

      // A private host the operator did not list is still refused.
      await expect(fetcher('http://10.0.0.6:9000/blob.png')).rejects.toThrow(
        /non-public address/,
      );
    } finally {
      if (previous === undefined) delete process.env[IMAGE_HOSTS_ENV];
      else process.env[IMAGE_HOSTS_ENV] = previous;
    }
  });
});

describe('assertResolvedHostIsPublic', () => {
  const server = 'https://api.wafflebase.io';

  it('allows a name that resolves to public addresses only, and hands them back', async () => {
    // The addresses are returned, not discarded: the fetcher dials one of them
    // directly so DNS cannot answer differently between check and connect.
    await expect(
      assertResolvedHostIsPublic(
        'https://cdn.example.com/a.png',
        server,
        [],
        async () => ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
      ),
    ).resolves.toEqual(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']);
  });

  it('refuses when any resolved address is non-public', async () => {
    // A name can answer with several records; one private answer is enough to
    // aim the request inside the network, so all of them have to be public.
    await expect(
      assertResolvedHostIsPublic('https://mixed.example/a.png', server, [], async () => [
        '93.184.216.34',
        '127.0.0.1',
      ]),
    ).rejects.toThrow(/resolves to 127\.0\.0\.1/);
  });

  it('does not resolve IP literals, which were already decided', async () => {
    const lookup = vi.fn(async () => ['93.184.216.34']);
    await assertResolvedHostIsPublic('http://8.8.8.8/a.png', server, [], lookup);
    await assertResolvedHostIsPublic('data:image/png;base64,AAA', server, [], lookup);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('createImageFetcher (bounded, address-pinned requests)', () => {
  it('dials the address it checked and carries the name in Host', async () => {
    // Check-then-connect is a race: `fetch` resolves the name a second time,
    // so a resolver the attacker controls can answer publicly for the check
    // and with 169.254.169.254 for the connection. Dialling the approved
    // address closes it; the Host header keeps virtual hosts working.
    const seen: { url: string; host?: string }[] = [];
    const stubFetch: typeof globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), host: headers.get('host') ?? undefined });
      return new Response(new Uint8Array([1]), { status: 200 });
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup: async () => ['93.184.216.34'],
    });

    await fetcher('http://cdn.example.com/a.png');
    expect(seen).toEqual([
      { url: 'http://93.184.216.34/a.png', host: 'cdn.example.com' },
    ]);
  });

  it('leaves https dialled by name so the certificate still validates', async () => {
    // An IP literal has no SNI and no matching certificate, so pinning https
    // would break every fetch. TLS carries that half: a rebound internal host
    // would have to present a valid certificate for the attacker's name.
    const seen: string[] = [];
    const stubFetch: typeof globalThis.fetch = async (input, init) => {
      seen.push(String(input));
      expect(new Headers(init?.headers).get('host')).toBeNull();
      return new Response(new Uint8Array([1]), { status: 200 });
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup: async () => ['93.184.216.34'],
    });

    await fetcher('https://cdn.example.com/a.png');
    expect(seen).toEqual(['https://cdn.example.com/a.png']);
  });

  it('resolves a relative redirect against the name, not the pinned address', async () => {
    const seen: string[] = [];
    const stubFetch: typeof globalThis.fetch = async (input) => {
      seen.push(String(input));
      if (seen.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: '/moved/a.png' },
        });
      }
      return new Response(new Uint8Array([7]), { status: 200 });
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup: async () => ['93.184.216.34'],
    });

    await fetcher('http://cdn.example.com/a.png');
    expect(seen).toEqual([
      'http://93.184.216.34/a.png',
      'http://93.184.216.34/moved/a.png',
    ]);
  });

  it('bounds every request with a timeout signal', async () => {
    // The document decides which host is dialled; a host that accepts and
    // never answers would otherwise hang the export forever.
    let signal: AbortSignal | undefined;
    const stubFetch: typeof globalThis.fetch = async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Response(new Uint8Array([1]), { status: 200 });
    };

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup: publicLookup,
      timeoutMs: 1234,
    });

    await fetcher('https://cdn.example.com/a.png');
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a body larger than the cap, by declared length', async () => {
    const stubFetch: typeof globalThis.fetch = async () =>
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'content-length': '999999' },
      });

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup: publicLookup,
      maxBytes: 1024,
    });

    await expect(fetcher('https://cdn.example.com/big.png')).rejects.toThrow(
      /exceeds the .* limit/,
    );
  });

  it('refuses a body larger than the cap even when it lies about its length', async () => {
    // `Content-Length` is a claim; the stream is the fact. Without the second
    // check an image `src` could stream unbounded bytes into the exporter.
    const stubFetch: typeof globalThis.fetch = async () =>
      new Response(new Uint8Array(4096), { status: 200 });

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup: publicLookup,
      maxBytes: 1024,
    });

    await expect(fetcher('https://cdn.example.com/big.png')).rejects.toThrow(
      /exceeds the .* limit/,
    );
  });

  it('returns a body within the cap with its content type intact', async () => {
    const stubFetch: typeof globalThis.fetch = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });

    const fetcher = createImageFetcher({
      serverBase: 'https://api.wafflebase.io',
      fetch: stubFetch,
      lookup: publicLookup,
      maxBytes: 1024,
    });

    const blob = await fetcher('https://cdn.example.com/a.png');
    expect(blob.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([
      1, 2, 3,
    ]);
  });
});
