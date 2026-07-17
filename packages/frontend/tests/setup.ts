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

// jsdom's Blob/File implementation has never gained arrayBuffer()/text()
// (https://github.com/jsdom/jsdom/issues/2555). File importers read the
// picked File via `file.arrayBuffer()`, so polyfill it on top of jsdom's
// FileReader, which does support readAsArrayBuffer.
if (typeof globalThis.Blob !== 'undefined' && !globalThis.Blob.prototype.arrayBuffer) {
  globalThis.Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
