import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Automatically unmount and cleanup after each test
afterEach(() => {
  cleanup();
});

// jsdom ships no ResizeObserver; Radix primitives (Slider, etc.) read it
// at mount. Provide a no-op so component tests can render them.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
