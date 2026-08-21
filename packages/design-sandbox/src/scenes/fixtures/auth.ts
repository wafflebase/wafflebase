/**
 * The identity a scene renders under.
 *
 * `mocks: ["auth"]` in `scenes.config.json` resolves to THIS, not to a
 * provider: the frontend has no auth context (`createContext` appears only in
 * `theme-provider.tsx`, `ui/chart.tsx` and `ui/sidebar.tsx`), so a scene's
 * notion of "who am I" arrives over `/auth/me` like everything else.
 *
 * `photo` is a data URI on purpose. A remote avatar would be the one request
 * the kill-switch has to allow, and an `<img>` that 404s in a visual diff reads
 * as a layout regression.
 */
import type { FixtureTable } from '@wafflebase/design-editor/scenes';

const AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#B8651A"/><text x="32" y="41" font-family="Inter,sans-serif" font-size="26" fill="#FFF8EE" text-anchor="middle">A</text></svg>`,
  );

export const FIXTURE_USER = {
  id: 1,
  authProvider: 'github',
  username: 'ada',
  email: 'ada@wafflebase.dev',
  photo: AVATAR,
};

export const FIXTURE_WORKSPACE = {
  id: 'ws-fixture',
  name: 'Acme Design',
  slug: 'acme-design',
  createdAt: '2026-01-04T09:00:00.000Z',
};

/**
 * Only the identity. `/workspaces` and `/analytics/enabled` used to live here and
 * moved to `shell.ts`: they are what `app/Layout.tsx` fetches, not what "who am
 * I" means, and a scene needs them exactly when it declares `shell: "app"`.
 */
export const AUTH_FIXTURES: FixtureTable = {
  '/api/auth/me': FIXTURE_USER,
  /*
   * THE BELL RIDES WITH THE SIGNED-IN USER, which is why it lives here and not in the shell
   * table. `app/Layout` renders the site header for `shell: "app"` scenes, but the canvas
   * scenes have no shell and render it themselves through `document-detail.tsx` — so keying
   * it to the shell left all four canvas scenes asking for a URL no fixture covered. Every
   * scene that declares `auth` is exactly the set that paints a header; `login` declares
   * neither, and has none.
   *
   * Zero, not a number: an unread badge is chrome, and a scene under design review should
   * not carry a red dot that means nothing.
   */
  '/api/notifications/unread-count': { count: 0 },

};
