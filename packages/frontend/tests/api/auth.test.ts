import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The 401 eviction redirect is a full-page navigation, and a full-page
 * navigation is refusable: the sync-status guard registers a `beforeunload`
 * handler on a document with unsent edits, so the browser asks first and the
 * user can say no. These cover the consequence of that — the redirect latch
 * must not stay set after a refusal, or session eviction is off for the rest
 * of the tab.
 */
describe('fetchWithAuth 401 eviction', () => {
  let assigned: Array<string>;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    assigned = [];

    // jsdom refuses a real navigation, so the href setter is what is observed.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        set href(value: string) {
          assigned.push(value);
        },
        get href() {
          return assigned[assigned.length - 1] ?? 'http://localhost/';
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function loadWithAlways401() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    return await import('../../src/api/auth.ts');
  }

  test('redirects to /login once for a burst of 401s', async () => {
    const { fetchWithAuth } = await loadWithAlways401();

    await expect(fetchWithAuth('/api/a')).rejects.toThrow(/Session expired/);
    await expect(fetchWithAuth('/api/b')).rejects.toThrow(/Session expired/);

    expect(assigned).toEqual(['/login']);
  });

  test('redirects again after a refused navigation', async () => {
    const { fetchWithAuth } = await loadWithAlways401();

    await expect(fetchWithAuth('/api/a')).rejects.toThrow(/Session expired/);
    expect(assigned).toEqual(['/login']);

    // The page is still running, which is the only signal a `beforeunload`
    // prompt was answered with "Cancel" — the browser fires no event for it.
    await vi.advanceTimersByTimeAsync(2000);

    await expect(fetchWithAuth('/api/b')).rejects.toThrow(/Session expired/);
    expect(assigned).toEqual(['/login', '/login']);
  });
});

/**
 * What a sign-out does to what offline persistence wrote to this device.
 *
 * Two different events end a session and they must not be treated alike. A
 * person choosing "Log out" on a shared machine is exactly who the erase is
 * for. A 401 is nobody's decision — and a live entry is not a disposable copy
 * of what the server holds, it carries the un-pushed change log, so erasing it
 * there destroys the only durable copy of work the server never took. Worse,
 * `fetchWithAuth` is what every request in the app goes through, so one 401
 * from any background poll would reach it.
 */
describe('sign-out and local data', () => {
  let erase: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    erase = vi.fn(async () => {});
    vi.doMock('../../src/lib/offline-erase.ts', () => ({
      eraseOfflineDataOnLogout: () => erase(),
    }));
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { set href(_value: string) {}, get href() { return 'http://localhost/'; } },
    });
  });

  afterEach(() => {
    vi.doUnmock('../../src/lib/offline-erase.ts');
    vi.unstubAllGlobals();
  });

  test('a deliberate logout erases everything, archives included', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const { logout } = await import('../../src/api/auth.ts');

    await logout({ redirect: false, showSuccessToast: false });

    expect(erase).toHaveBeenCalled();
  });

  test('an expired session erases nothing at all', async () => {
    // The live entries carry the un-pushed change log, and this arm is reached
    // by any request in the app. Erasing here would destroy the only durable
    // copy of unsent work from a call site unrelated to anything the user did.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    const { fetchWithAuth } = await import('../../src/api/auth.ts');

    await expect(fetchWithAuth('/api/a')).rejects.toThrow(/Session expired/);

    expect(erase).not.toHaveBeenCalled();
  });

  test('erases nothing until the server has actually ended the session', async () => {
    // A logout request that failed leaves the user signed in, and erasing
    // their local documents there deletes unsent work for a sign-out that did
    // not happen.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    const { logout } = await import('../../src/api/auth.ts');

    await logout({
      redirect: false,
      showSuccessToast: false,
      suppressFailure: true,
    });

    expect(erase).not.toHaveBeenCalled();
  });

  test('erases nothing when the server refuses the sign-out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const { logout } = await import('../../src/api/auth.ts');

    await logout({
      redirect: false,
      showSuccessToast: false,
      suppressFailure: true,
    });

    expect(erase).not.toHaveBeenCalled();
  });

  test('erases before the redirect, so the navigation cannot race it', async () => {
    const order: Array<string> = [];
    erase.mockImplementation(async () => {
      order.push('erase');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        set href(_value: string) {
          order.push('redirect');
        },
        get href() {
          return 'http://localhost/';
        },
      },
    });
    const { logout } = await import('../../src/api/auth.ts');

    await logout({ showSuccessToast: false });

    expect(order).toEqual(['erase', 'redirect']);
  });
});
