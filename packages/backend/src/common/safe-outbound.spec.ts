import { promises as dnsPromises } from 'node:dns';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  assertSafeUrl,
  isBlockedAddress,
  safeFetch,
  SafeOutboundError,
} from './safe-outbound';

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:2800:220:1:248:1893:25c8:1946';
const STRICT = { allowedCidrs: [], allowHttp: false };
const LOCAL = { allowedCidrs: ['127.0.0.1/32'], allowHttp: true };

type LookupResult = { address: string; family: number }[];

function mockLookup(...answers: (string[] | Error)[]) {
  const spy = jest.spyOn(dnsPromises, 'lookup') as unknown as jest.SpyInstance<
    Promise<LookupResult>
  >;
  let call = 0;
  spy.mockImplementation(() => {
    const answer = answers[Math.min(call++, answers.length - 1)];
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(
      answer.map((address) => ({
        address,
        family: address.includes(':') ? 6 : 4,
      })),
    );
  });
  return spy;
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(SafeOutboundError);
    return err as SafeOutboundError;
  }
  throw new Error('expected a SafeOutboundError');
}

afterEach(() => jest.restoreAllMocks());

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '100.127.255.255',
    '169.254.169.254',
    '192.0.0.8',
    '198.18.0.1',
    '198.19.255.255',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b::10.0.0.1',
    '2002:7f00:1::',
    'fe80::1%eth0',
    'not-an-ip',
  ])('refuses %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    PUBLIC_V4,
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '100.128.0.1',
    '169.255.0.1',
    '198.20.0.1',
    PUBLIC_V6,
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
  ])('lets %s through', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  it('accepts a public https host and returns every resolved address', async () => {
    mockLookup([PUBLIC_V4, PUBLIC_V6]);
    await expect(
      assertSafeUrl('https://hooks.example.com/x', STRICT),
    ).resolves.toEqual({ addresses: [PUBLIC_V4, PUBLIC_V6] });
  });

  it('refuses when any one resolved address is private', async () => {
    mockLookup([PUBLIC_V4, '10.0.0.5']);
    const err = await refusal(
      assertSafeUrl('https://hooks.example.com/x', STRICT),
    );
    expect(err.code).toBe('private_address');
    expect(err.address).toBe('10.0.0.5');
  });

  it('refuses an AAAA record that maps to IPv4 loopback', async () => {
    mockLookup(['::ffff:127.0.0.1']);
    const err = await refusal(assertSafeUrl('https://evil.example/', STRICT));
    expect(err.code).toBe('private_address');
  });

  it('checks literal IP hosts without DNS', async () => {
    const lookup = mockLookup([PUBLIC_V4]);
    for (const url of [
      'https://127.0.0.1/',
      'https://0x7f.1/',
      'https://2130706433/',
      'https://[::1]/',
      'https://[::ffff:127.0.0.1]/',
      'https://[64:ff9b::169.254.169.254]/',
      'https://169.254.169.254/latest/meta-data',
    ]) {
      expect((await refusal(assertSafeUrl(url, STRICT))).code).toBe(
        'private_address',
      );
    }
    await expect(
      assertSafeUrl(`https://${PUBLIC_V4}/`, STRICT),
    ).resolves.toEqual({ addresses: [PUBLIC_V4] });
    await expect(
      assertSafeUrl('https://[2001:4860:4860::8888]/', STRICT),
    ).resolves.toEqual({ addresses: ['2001:4860:4860::8888'] });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses metadata and localhost names even when they resolve public', async () => {
    mockLookup([PUBLIC_V4]);
    for (const host of [
      'metadata.google.internal',
      'metadata.google.internal.',
      'localhost',
      'app.localhost',
      'instance-data.ec2.internal',
    ]) {
      expect(
        (await refusal(assertSafeUrl(`https://${host}/`, STRICT))).code,
      ).toBe('private_address');
    }
  });

  it('lets an allowed CIDR through, and nothing outside it', async () => {
    const opts = {
      allowedCidrs: ['10.0.4.0/24', 'fd00::/8'],
      allowHttp: false,
    };
    mockLookup(['10.0.4.7'], ['fd00::7'], ['10.0.5.1']);
    await expect(assertSafeUrl('https://a.corp/', opts)).resolves.toEqual({
      addresses: ['10.0.4.7'],
    });
    await expect(assertSafeUrl('https://b.corp/', opts)).resolves.toEqual({
      addresses: ['fd00::7'],
    });
    expect((await refusal(assertSafeUrl('https://c.corp/', opts))).code).toBe(
      'private_address',
    );
    // A mapped address is judged by its IPv4 against an IPv4 CIDR.
    await expect(
      assertSafeUrl('https://[::ffff:10.0.4.9]/', opts),
    ).resolves.toEqual({ addresses: ['::ffff:a00:409'] });
  });

  it('lets a metadata name through only when its address is allowed', async () => {
    mockLookup(['169.254.169.254']);
    await expect(
      assertSafeUrl('https://metadata.google.internal/', {
        allowedCidrs: ['169.254.169.254/32'],
        allowHttp: false,
      }),
    ).resolves.toEqual({ addresses: ['169.254.169.254'] });
  });

  it('ignores an allowed CIDR that does not parse', async () => {
    mockLookup(['10.0.0.1']);
    const opts = {
      allowedCidrs: ['10.0.0.1', '10.0.0.0/99'],
      allowHttp: false,
    };
    expect((await refusal(assertSafeUrl('https://a.corp/', opts))).code).toBe(
      'private_address',
    );
  });

  it('refuses http unless allowHttp, and other schemes always', async () => {
    mockLookup([PUBLIC_V4]);
    expect(
      (await refusal(assertSafeUrl('http://hooks.example.com/', STRICT))).code,
    ).toBe('scheme_not_allowed');
    await expect(
      assertSafeUrl('http://hooks.example.com/', {
        ...STRICT,
        allowHttp: true,
      }),
    ).resolves.toEqual({ addresses: [PUBLIC_V4] });
    for (const url of ['ftp://hooks.example.com/', 'file:///etc/passwd']) {
      expect(
        (await refusal(assertSafeUrl(url, { ...STRICT, allowHttp: true })))
          .code,
      ).toBe('scheme_not_allowed');
    }
  });

  it('refuses malformed URLs and userinfo', async () => {
    mockLookup([PUBLIC_V4]);
    expect((await refusal(assertSafeUrl('not a url', STRICT))).code).toBe(
      'invalid_url',
    );
    const err = await refusal(
      assertSafeUrl('https://user:hunter2@hooks.example.com/', STRICT),
    );
    expect(err.code).toBe('invalid_url');
    expect(err.message).not.toContain('hunter2');
  });

  it('reports DNS failure', async () => {
    mockLookup(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    expect(
      (await refusal(assertSafeUrl('https://nope.example/', STRICT))).code,
    ).toBe('dns_failed');
  });

  it('never puts the URL in an error message', async () => {
    mockLookup(['10.0.0.1']);
    const err = await refusal(
      assertSafeUrl('https://a.example/hooks/s3cr3t-token', STRICT),
    );
    expect(err.message).not.toContain('s3cr3t');
    expect(err.message).not.toContain('a.example');
  });
});

describe('safeFetch', () => {
  let server: http.Server;
  let port: number;
  let hits: { headers: http.IncomingHttpHeaders; body: string; url: string }[];
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeEach(async () => {
    hits = [];
    handler = (_req, res) => res.end('ok');
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        hits.push({ headers: req.headers, body, url: req.url ?? '' });
        handler(req, res);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const init = (overrides: Partial<Parameters<typeof safeFetch>[1]> = {}) => ({
    method: 'POST' as const,
    headers: { 'content-type': 'application/json', 'x-test': '1' },
    body: '{"hello":"wörld"}',
    timeoutMs: 2000,
    maxResponseBytes: 1024,
    ...LOCAL,
    ...overrides,
  });

  it('posts the body and headers and returns the response', async () => {
    handler = (_req, res) => {
      res.setHeader('x-reply', 'yes');
      res.statusCode = 201;
      res.end('created');
    };
    const result = await safeFetch(`http://127.0.0.1:${port}/hook?a=1`, init());
    expect(result.status).toBe(201);
    expect(result.bodyExcerpt).toBe('created');
    expect(result.headers['x-reply']).toBe('yes');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe('/hook?a=1');
    expect(hits[0].body).toBe('{"hello":"wörld"}');
    expect(hits[0].headers['x-test']).toBe('1');
    expect(hits[0].headers['content-length']).toBe(
      String(Buffer.byteLength('{"hello":"wörld"}')),
    );
  });

  it('connects to the checked address while keeping the hostname', async () => {
    mockLookup(['127.0.0.1']);
    const result = await safeFetch(`http://hook.test:${port}/`, init());
    expect(result.status).toBe(200);
    expect(hits[0].headers.host).toBe(`hook.test:${port}`);
  });

  it('refuses before connecting when the address is not allowed', async () => {
    const err = await refusal(
      safeFetch(`http://127.0.0.1:${port}/`, init({ allowedCidrs: [] })),
    );
    expect(err.code).toBe('private_address');
    expect(hits).toHaveLength(0);
  });

  it('refuses http without allowHttp', async () => {
    const err = await refusal(
      safeFetch(`http://127.0.0.1:${port}/`, init({ allowHttp: false })),
    );
    expect(err.code).toBe('scheme_not_allowed');
    expect(hits).toHaveLength(0);
  });

  it('defeats DNS rebinding: a private answer at connect time is refused', async () => {
    // Public for the up-front check, private for the socket's own lookup.
    const lookup = mockLookup([PUBLIC_V4], ['10.0.0.5']);
    const err = await refusal(
      safeFetch(`http://rebind.test:${port}/`, init({ allowedCidrs: [] })),
    );
    expect(err.code).toBe('private_address');
    expect(err.address).toBe('10.0.0.5');
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(hits).toHaveLength(0);
  });

  it('returns a redirect as a status without following it', async () => {
    handler = (_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `http://127.0.0.1:${port}/elsewhere`);
      res.end();
    };
    const result = await safeFetch(`http://127.0.0.1:${port}/`, init());
    expect(result.status).toBe(302);
    expect(result.headers.location).toContain('/elsewhere');
    expect(hits).toHaveLength(1);
  });

  it('caps the response read and returns the excerpt', async () => {
    handler = (_req, res) => {
      res.statusCode = 200;
      // Never ends on its own: the cap has to cut it off.
      const chunk = 'x'.repeat(16 * 1024);
      const write = () => {
        if (!res.destroyed && res.write(chunk)) setImmediate(write);
        else if (!res.destroyed) res.once('drain', write);
      };
      write();
    };
    const result = await safeFetch(
      `http://127.0.0.1:${port}/`,
      init({ maxResponseBytes: 1024 }),
    );
    expect(result.status).toBe(200);
    expect(result.bodyExcerpt).toBe('x'.repeat(1024));
  });

  it('does not split a UTF-8 character at the cap', async () => {
    handler = (_req, res) => res.end('éééé'); // 2 bytes each
    const result = await safeFetch(
      `http://127.0.0.1:${port}/`,
      init({ maxResponseBytes: 3 }),
    );
    expect(result.bodyExcerpt).toBe('é');
  });

  it('times out a server that never answers', async () => {
    handler = () => {
      /* hold the request open */
    };
    const err = await refusal(
      safeFetch(`http://127.0.0.1:${port}/`, init({ timeoutMs: 200 })),
    );
    expect(err.code).toBe('timeout');
  });

  it('reports a refused connection as a network error', async () => {
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const err = await refusal(
      safeFetch(`http://127.0.0.1:${closedPort}/secret-path`, init()),
    );
    expect(err.code).toBe('network');
    expect(err.message).not.toContain('secret-path');
  });
});
