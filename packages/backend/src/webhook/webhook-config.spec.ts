import {
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_QUIET_MS,
  documentApiUrl,
  documentUrl,
  loadWebhookConfig,
  parseCidrList,
} from './webhook-config';

describe('loadWebhookConfig', () => {
  it('is disabled with defaults when nothing is set', () => {
    expect(loadWebhookConfig({})).toEqual({
      enabled: false,
      allowedCidrs: [],
      allowHttp: false,
      quietMs: DEFAULT_QUIET_MS,
      maxWaitMs: DEFAULT_MAX_WAIT_MS,
      apiOrigin: undefined,
      frontendOrigin: undefined,
    });
  });

  it.each(['TRUE', 'True', '1', 'yes', 'on', ''])(
    'treats %p as off: only the literal true enables',
    (value) => {
      const config = loadWebhookConfig({
        WAFFLEBASE_WEBHOOKS_ENABLED: value,
        WAFFLEBASE_WEBHOOK_ALLOW_HTTP: value,
      });
      expect(config.enabled).toBe(false);
      expect(config.allowHttp).toBe(false);
    },
  );

  it('enables on the literal true, surrounding space trimmed', () => {
    const config = loadWebhookConfig({
      WAFFLEBASE_WEBHOOKS_ENABLED: ' true ',
      WAFFLEBASE_WEBHOOK_ALLOW_HTTP: 'true',
    });
    expect(config.enabled).toBe(true);
    expect(config.allowHttp).toBe(true);
  });

  it('reads the coalescing windows, falling back on junk', () => {
    expect(
      loadWebhookConfig({
        WAFFLEBASE_WEBHOOK_QUIET_MS: '1000',
        WAFFLEBASE_WEBHOOK_MAX_WAIT_MS: '5000',
      }),
    ).toMatchObject({ quietMs: 1000, maxWaitMs: 5000 });
    expect(
      loadWebhookConfig({
        WAFFLEBASE_WEBHOOK_QUIET_MS: '-5',
        WAFFLEBASE_WEBHOOK_MAX_WAIT_MS: '1e3',
      }),
    ).toMatchObject({
      quietMs: DEFAULT_QUIET_MS,
      maxWaitMs: DEFAULT_MAX_WAIT_MS,
    });
    expect(
      loadWebhookConfig({ WAFFLEBASE_WEBHOOK_QUIET_MS: '0' }).quietMs,
    ).toBe(DEFAULT_QUIET_MS);
  });

  it('prefers WAFFLEBASE_API_ORIGIN, then the callback URL origin', () => {
    expect(
      loadWebhookConfig({
        WAFFLEBASE_API_ORIGIN: 'https://api.example.com/ignored',
        GITHUB_CALLBACK_URL: 'https://other.example.com/auth/github/callback',
      }).apiOrigin,
    ).toBe('https://api.example.com');
    expect(
      loadWebhookConfig({
        GITHUB_CALLBACK_URL: 'https://w.example.com/auth/github/callback',
      }).apiOrigin,
    ).toBe('https://w.example.com');
    expect(
      loadWebhookConfig({ WAFFLEBASE_API_ORIGIN: 'not a url' }).apiOrigin,
    ).toBeUndefined();
  });

  it('reads the frontend origin from FRONTEND_URL', () => {
    expect(
      loadWebhookConfig({ FRONTEND_URL: 'http://localhost:5173/' })
        .frontendOrigin,
    ).toBe('http://localhost:5173');
  });
});

describe('parseCidrList', () => {
  it('keeps exact IPv4 and IPv6 CIDRs', () => {
    expect(parseCidrList(' 10.0.4.0/24 , fd00::/8,192.168.1.10/32')).toEqual([
      '10.0.4.0/24',
      'fd00::/8',
      '192.168.1.10/32',
    ]);
  });

  it('drops entries that do not parse rather than widening them', () => {
    expect(
      parseCidrList(
        '10.0.0.0,10.0.0.0/33,::/129,example.com/24,10.0.0/8,/8,10.0.0.0/-1,10.0.0.0/8x,,',
      ),
    ).toEqual([]);
  });

  it('dedupes', () => {
    expect(parseCidrList('10.0.0.0/8,10.0.0.0/8')).toEqual(['10.0.0.0/8']);
  });
});

describe('document links', () => {
  const config = {
    frontendOrigin: 'https://app.example.com',
    apiOrigin: 'https://api.example.com',
  };

  it('routes each type to its editor', () => {
    expect(documentUrl(config, { id: 'a', type: 'sheet' })).toBe(
      'https://app.example.com/s/a',
    );
    expect(documentUrl(config, { id: 'a', type: 'slides' })).toBe(
      'https://app.example.com/p/a',
    );
    expect(documentUrl(config, { id: 'a', type: 'image' })).toBe(
      'https://app.example.com/f/a',
    );
  });

  it('omits links it cannot build', () => {
    expect(documentUrl({}, { id: 'a', type: 'sheet' })).toBeUndefined();
    expect(documentUrl(config, { id: 'a', type: 'mystery' })).toBeUndefined();
    expect(documentApiUrl({}, 'w', 'd')).toBeUndefined();
  });

  it('builds the v1 metadata URL', () => {
    expect(documentApiUrl(config, 'w1', 'd1')).toBe(
      'https://api.example.com/api/v1/workspaces/w1/documents/d1',
    );
  });
});
