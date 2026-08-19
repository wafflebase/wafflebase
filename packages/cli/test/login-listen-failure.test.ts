import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * A callback server that never starts must not leave the login's timer
 * behind.
 *
 * `startCallbackServer` arms the wait timeout as part of setting up, but
 * the only handle that clears it is the `close()` returned when the
 * promise *resolves*. On a rejection path — `listen` erroring with
 * anything other than a retryable EADDRINUSE, or an unusable address —
 * the caller never receives `close()`, so the timer stays armed: it
 * holds the event loop open for the full wait (now three minutes) and
 * then rejects the callback promise that, on this path, nobody is
 * awaiting. That surfaces as `wafflebase login` printing its error and
 * then sitting there until it dies on an unhandled rejection.
 *
 * `node:http` is mocked because a failing `listen(0, '127.0.0.1')` is
 * not otherwise reachable: port 0 always resolves to a free port.
 */
vi.mock('node:http', async () => {
  const { EventEmitter } = await import('node:events');
  class FailingServer extends EventEmitter {
    listen() {
      queueMicrotask(() => {
        this.emit(
          'error',
          Object.assign(new Error('listen EACCES'), { code: 'EACCES' }),
        );
      });
      return this;
    }
    close() {}
    address() {
      return null;
    }
  }
  return { createServer: () => new FailingServer() };
});

describe('startCallbackServer — failed start', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    unhandled.length = 0;
  });

  it('leaves no armed timer behind when the server cannot listen', async () => {
    const { startCallbackServer, createLoginNonce } = await import(
      '../src/commands/login.js'
    );
    process.on('unhandledRejection', onUnhandled);

    await expect(
      startCallbackServer(createLoginNonce(), { timeoutMs: 50 }),
    ).rejects.toThrow(/EACCES/);

    // Well past the wait: with the timer still armed it fires here and
    // rejects a promise this path never handed to anyone.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(unhandled).toEqual([]);
  });
});
