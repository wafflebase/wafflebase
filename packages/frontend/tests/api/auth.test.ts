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
