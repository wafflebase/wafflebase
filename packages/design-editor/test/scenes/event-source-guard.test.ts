// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

/**
 * `EventSource` is the SECOND way out of the frame, and it does not go through `fetch`.
 *
 * Every scene mounting the real app shell opened `/api/notifications/stream` — an
 * `EventSource`, so it bypassed the wrapped `fetch` entirely and reached the real backend.
 * The guard's stated contract is that requests never leave the frame, and the browser gate
 * could not catch the exception either, because the gate looks for the guard's own
 * `unmocked` report and this never produced one.
 *
 * A SEPARATE FILE, not a case in `fetch-fixtures.test.ts`, for two reasons that both come
 * from the module: the guard is install-once, so that file's module-scope install has
 * already run by the time a test body executes; and jsdom ships no `EventSource`, so the
 * stub has to exist BEFORE the module is imported. Hence the dynamic import below.
 */
describe('the EventSource guard', () => {
  it('refuses a stream, reports it through onMiss, and errors like a dead backend', async () => {
    class FakeEventSource extends EventTarget {
      static opened: string[] = [];
      constructor(url: string) {
        super();
        FakeEventSource.opened.push(url);
      }
      close() {}
    }
    (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;

    const missed: Array<[string, string]> = [];
    const mod = await import('../../src/scenes/fetch-fixtures.ts');
    mod.installFetchGuard({ fixtures: {}, onMiss: (url, method) => missed.push([url, method]) });

    const es = new window.EventSource('/api/notifications/stream');

    // Reported the same way a missed `fetch` is, so one gate assertion covers both routes…
    expect(missed).toEqual([['/api/notifications/stream', 'EVENTSOURCE']]);
    // …and the real constructor was never reached, so nothing left the frame.
    expect(FakeEventSource.opened).toEqual([]);

    // Behaves as a stream that immediately errors — the state the app already handles when
    // the backend is down — rather than throwing at the construction site.
    const errored = await new Promise<boolean>((resolve) => {
      es.onerror = () => resolve(true);
      setTimeout(() => resolve(false), 100);
    });
    expect(errored).toBe(true);
    es.close();
  });
});
