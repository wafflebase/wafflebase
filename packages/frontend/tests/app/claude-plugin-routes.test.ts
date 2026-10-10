import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The Claude Code plugin (plugins/wafflebase/) builds document deep links
// from its own copy of these routes. The pin lives here, in the frontend
// suite, so a route rename fails the lane that a frontend-only change runs.
// Vitest runs from packages/frontend (jsdom gives import.meta.url no file:).
const appSource = readFileSync(resolve('src/App.tsx'), 'utf8');
const sessionLib = pathToFileURL(
  resolve('../../plugins/wafflebase/hooks/session-lib.mjs'),
).href;

/** `/<x>/:id` document-detail routes; `/t/:id` is the template landing. */
const NON_DOCUMENT = new Set(['t']);

describe('Claude plugin deep-link routes', () => {
  it('match the router in both directions', async () => {
    const { ROUTES } = (await import(/* @vite-ignore */ sessionLib)) as {
      ROUTES: Record<string, string>;
    };
    const app = new Set(
      [...appSource.matchAll(/path="\/([a-z])\/:id"/g)]
        .map((m) => m[1])
        .filter((p) => !NON_DOCUMENT.has(p)),
    );
    expect(new Set(Object.values(ROUTES))).toEqual(app);
  });
});
