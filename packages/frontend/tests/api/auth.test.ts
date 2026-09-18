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
 * for. A cookie that expired is nobody's decision — and this device's archives
 * are the only copy of work the server never took, so deleting those would be
 * the feature causing the loss it exists to prevent. The live entries go on
 * both paths, because the server still holds that content and a shared disk
 * should not.
 */
describe('sign-out and local data', () => {
  let erase: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    erase = vi.fn(async () => {});
    vi.doMock('../../src/lib/offline-erase.ts', () => ({
      eraseOfflineDataOnLogout: (options?: { keepArchives?: boolean }) =>
        erase(options),
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

    expect(erase).toHaveBeenCalledWith({ keepArchives: false });
  });

  test('an expired session erases the live entries but keeps the archives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    const { fetchWithAuth } = await import('../../src/api/auth.ts');

    await expect(fetchWithAuth('/api/a')).rejects.toThrow(/Session expired/);

    expect(erase).toHaveBeenCalledWith({ keepArchives: true });
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
