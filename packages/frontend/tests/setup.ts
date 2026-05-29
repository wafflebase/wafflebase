import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Automatically unmount and cleanup after each test
afterEach(() => {
  cleanup();
});
