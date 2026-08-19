/**
 * The data a scene renders, as PLAIN DATA keyed by URL.
 *
 * Wired to the plugin through `options.fixtures`, so this module's default export is
 * what the frame calls before it imports any scene. Two rules, both learned elsewhere in
 * this repo:
 *
 * 1. **Data, never JSX.** `app/harness/visual/slides-scenarios.tsx` is 1,867 lines
 *    because its fixtures are inline JSX. A fixture that can render is a fixture that can
 *    drift from the component it feeds, and it stops being reviewable as data.
 *
 * 2. **Keyed by URL, not by query key.** Every page passes its own `queryFn`, so a
 *    `QueryClient`-level default is never consulted. Substituting at the `fetch` layer
 *    keeps `fetchWithAuth`'s real 401/refresh branch and each page's own
 *    loading/empty/error rendering on the code path.
 *
 * Only the pathname matters — see `installFetchGuard`'s `keyOf`.
 */
import type { FixtureTable } from '@wafflebase/design-editor/scenes';
import { AUTH_FIXTURES } from './auth.ts';
import { SHELL_FIXTURES } from './shell.ts';
import { DOCUMENTS_FIXTURES } from './documents.ts';
import { DATASOURCES_FIXTURES } from './datasources.ts';
import { WORKSPACE_SETTINGS_FIXTURES, WORKSPACE_ANALYTICS_FIXTURES } from './workspace.ts';
import { SHEETS_FIXTURE, DOCS_FIXTURE, SLIDES_FIXTURE, NOTES_FIXTURE } from './canvas.ts';

/** mock name → the fixtures installing it contributes. */
const BY_MOCK: Record<string, FixtureTable> = {
  auth: AUTH_FIXTURES,
};

/**
 * `fixtures: { query: "documents/list" }` → the table under that key.
 *
 * The canvas refs answer the `/api/documents/:id` fetch a canvas page makes for its
 * METADATA (title, type, permissions). The document CONTENT is a separate substitution —
 * a canvas page has no fetch to intercept for "what is in this document", so that happens
 * at `Document` construction in `canvas/yorkie-offline.tsx`.
 *
 * `files/fixture` (the pdf viewer) has no entry: it needs a blob URL rather than JSON, and
 * nothing here can produce one. That scene stays deferred, and an unknown ref contributes
 * nothing — so the first request that needed it trips the guard and names the URL.
 */
const BY_FIXTURE_REF: Record<string, FixtureTable> = {
  'documents/list': DOCUMENTS_FIXTURES,
  'datasources/list': DATASOURCES_FIXTURES,
  'workspace/settings': WORKSPACE_SETTINGS_FIXTURES,
  'workspace/analytics': WORKSPACE_ANALYTICS_FIXTURES,
  'sheets/revenue': SHEETS_FIXTURE,
  'docs/fixture': DOCS_FIXTURE,
  'slides/fixture': SLIDES_FIXTURE,
  'notes/fixture': NOTES_FIXTURE,
};

export interface SceneFixtureConfig {
  shell?: string;
  mocks?: string[];
  fixtures?: Record<string, string>;
}

/**
 * Assemble one scene's table from its manifest entry.
 *
 * WIDEST FIRST, NARROWEST LAST. The app shell's URLs are the defaults and a scene's own
 * `fixtures` ref wins, which is what lets `documents/list` replace the shell's empty
 * folder list without the shell knowing about it.
 *
 * An unknown ref is NOT an error here and NOT silently ignored either — it contributes
 * nothing, so the first request that needed it trips the guard and names the URL. A quiet
 * fallback is what makes a missing fixture look like a broken scene.
 */
export function fixturesFor(config: SceneFixtureConfig | undefined): FixtureTable {
  if (!config) return {};
  const out: FixtureTable = {};
  if (config.shell === 'app') Object.assign(out, SHELL_FIXTURES);
  for (const m of config.mocks ?? []) Object.assign(out, BY_MOCK[m] ?? {});
  for (const ref of Object.values(config.fixtures ?? {})) {
    Object.assign(out, BY_FIXTURE_REF[ref] ?? {});
  }
  return out;
}

export default fixturesFor;
