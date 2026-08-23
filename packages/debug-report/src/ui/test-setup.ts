import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * What the React half's tests need from a browser jsdom does not provide.
 *
 * A trimmed port of the frontend's `tests/setup.ts` — only the parts this
 * package's own tests reach, since the rest of that file exists for Radix
 * primitives and file importers that live in the app.
 */

// Unmount between tests, or a rendered overlay from one test answers queries in
// the next — and the session is a process singleton by design, so a leaked mount
// keeps subscribing to it.
afterEach(() => {
  cleanup();
});

// jsdom ships no ResizeObserver, and the overlay reads it at mount.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
