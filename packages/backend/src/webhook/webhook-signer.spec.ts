import {
  generateWebhookSecret,
  signWebhook,
  verifyWebhook,
} from './webhook-signer';

// The test vector from the Standard Webhooks reference libraries
// (github.com/standard-webhooks/standard-webhooks). Matching it is what lets
// a consumer verify us with any off-the-shelf verifier.
const VECTOR = {
  secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: 1614265330,
  body: '{"test": 2432232314}',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
};

describe('webhook-signer', () => {
  it('matches the Standard Webhooks test vector', () => {
    const headers = signWebhook({
      id: VECTOR.id,
      timestamp: VECTOR.timestamp,
      body: VECTOR.body,
      secrets: [VECTOR.secret],
    });
    expect(headers).toEqual({
      'webhook-id': VECTOR.id,
      'webhook-timestamp': String(VECTOR.timestamp),
      'webhook-signature': VECTOR.signature,
    });
  });

  it('generates whsec_ secrets of 32 random bytes', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(a.slice('whsec_'.length), 'base64')).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it('sends one signature per secret during a rotation, current first', () => {
    const current = generateWebhookSecret();
    const previous = VECTOR.secret;
    const headers = signWebhook({
      id: VECTOR.id,
      timestamp: VECTOR.timestamp,
      body: VECTOR.body,
      secrets: [current, previous],
    });
    const parts = headers['webhook-signature'].split(' ');
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe(VECTOR.signature);

    const now = VECTOR.timestamp;
    for (const secret of [current, previous]) {
      expect(
        verifyWebhook({ headers, body: VECTOR.body, secret, nowSeconds: now }),
      ).toBe(true);
    }
    expect(
      verifyWebhook({
        headers,
        body: VECTOR.body,
        secret: generateWebhookSecret(),
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('refuses a secret-less signing request', () => {
    expect(() =>
      signWebhook({ id: 'x', timestamp: 1, body: '', secrets: [] }),
    ).toThrow();
  });

  describe('verifyWebhook', () => {
    const headers = {
      'webhook-id': VECTOR.id,
      'webhook-timestamp': String(VECTOR.timestamp),
      'webhook-signature': VECTOR.signature,
    };

    it('accepts within the tolerance and refuses outside it', () => {
      const verify = (nowSeconds: number) =>
        verifyWebhook({
          headers,
          body: VECTOR.body,
          secret: VECTOR.secret,
          nowSeconds,
        });
      expect(verify(VECTOR.timestamp + 300)).toBe(true);
      expect(verify(VECTOR.timestamp - 300)).toBe(true);
      expect(verify(VECTOR.timestamp + 301)).toBe(false);
      expect(verify(VECTOR.timestamp - 301)).toBe(false);
      expect(
        verifyWebhook({
          headers,
          body: VECTOR.body,
          secret: VECTOR.secret,
          nowSeconds: VECTOR.timestamp + 3600,
          toleranceSeconds: 3600,
        }),
      ).toBe(true);
    });

    it('refuses a tampered body, id or timestamp', () => {
      const base = {
        body: VECTOR.body,
        secret: VECTOR.secret,
        nowSeconds: VECTOR.timestamp,
      };
      expect(
        verifyWebhook({ ...base, headers, body: '{"test": 2432232315}' }),
      ).toBe(false);
      expect(
        verifyWebhook({
          ...base,
          headers: { ...headers, 'webhook-id': 'msg_other' },
        }),
      ).toBe(false);
      expect(
        verifyWebhook({
          ...base,
          headers: {
            ...headers,
            'webhook-timestamp': String(VECTOR.timestamp + 1),
          },
        }),
      ).toBe(false);
    });

    it('ignores unknown signature versions and missing headers', () => {
      const base = {
        body: VECTOR.body,
        secret: VECTOR.secret,
        nowSeconds: VECTOR.timestamp,
      };
      expect(
        verifyWebhook({
          ...base,
          headers: {
            ...headers,
            'webhook-signature': VECTOR.signature.replace('v1,', 'v2,'),
          },
        }),
      ).toBe(false);
      expect(
        verifyWebhook({
          ...base,
          headers: { 'webhook-id': VECTOR.id },
        }),
      ).toBe(false);
    });

    it('reads header names case-insensitively', () => {
      expect(
        verifyWebhook({
          headers: {
            'Webhook-Id': VECTOR.id,
            'Webhook-Timestamp': String(VECTOR.timestamp),
            'Webhook-Signature': `v1,bogus ${VECTOR.signature}`,
          },
          body: VECTOR.body,
          secret: VECTOR.secret,
          nowSeconds: VECTOR.timestamp,
        }),
      ).toBe(true);
    });
  });
});
