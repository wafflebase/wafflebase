import { defineConfig } from 'vitest/config';

// Development server config (uses Vite defaults).
// Library build config is in vite.build.ts.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
});
