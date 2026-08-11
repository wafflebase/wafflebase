import { UserThrottlerGuard } from './user-throttler.guard';

/**
 * `ThrottlerGuard`'s default tracker keys on the request IP, which both
 * shares one bucket across colleagues behind a NAT and leaves an attacker
 * with several source addresses effectively uncapped. This endpoint is the
 * one a client calls on its own initiative, so it keys on the caller instead.
 */
describe('UserThrottlerGuard', () => {
  // Only `getTracker` is under test; the guard's storage/reflector wiring is
  // Nest's and is exercised by the HTTP integration tests. It stays
  // `protected` in the class — reaching it here rather than widening it keeps
  // the test's needs out of the production surface.
  const guard = Object.create(UserThrottlerGuard.prototype) as {
    getTracker(req: Record<string, unknown>): Promise<string>;
  };

  it('keys on the authenticated user, not the address they came from', async () => {
    await expect(
      guard.getTracker({ ip: '10.0.0.1', user: { id: 42 } }),
    ).resolves.toBe('user:42');
  });

  it('gives two users behind one address separate buckets', async () => {
    const a = await guard.getTracker({ ip: '10.0.0.1', user: { id: 1 } });
    const b = await guard.getTracker({ ip: '10.0.0.1', user: { id: 2 } });
    expect(a).not.toBe(b);
  });

  it('gives one user the same bucket from two addresses', async () => {
    const a = await guard.getTracker({ ip: '10.0.0.1', user: { id: 1 } });
    const b = await guard.getTracker({ ip: '203.0.113.9', user: { id: 1 } });
    expect(a).toBe(b);
  });

  it('falls back to the address when there is no authenticated user', async () => {
    await expect(guard.getTracker({ ip: '10.0.0.1' })).resolves.toBe(
      '10.0.0.1',
    );
  });

  it('falls back when the user carries no usable id', async () => {
    await expect(
      guard.getTracker({ ip: '10.0.0.1', user: { id: undefined } }),
    ).resolves.toBe('10.0.0.1');
  });
});
