/**
 * What the APP SHELL needs, as opposed to what a page needs.
 *
 * `app/Layout.tsx` is not a passive wrapper — it fetches on mount
 * (`fetchWorkspaces` for the workspace switcher, `fetchAnalyticsEnabled` to
 * decide whether the Analytics nav entry exists) and `components/app-sidebar.tsx`
 * adds `fetchMe` for the user footer. So a scene gains three URLs the moment it
 * declares `shell: "app"`, none of which its own page file mentions.
 *
 * They live here rather than in `auth.ts` because they are not the identity: the
 * shell needs them whether or not a scene mocks auth, and burying `/workspaces`
 * under the `auth` key made the dependency unreadable — the reason the shell
 * exists is `Layout`, so the fixtures follow `shell`.
 */
import type { FixtureTable } from '@wafflebase/design-editor/scenes';
import { FIXTURE_WORKSPACE } from './auth.ts';

export const SHELL_FIXTURES: FixtureTable = {
  '/api/workspaces': [FIXTURE_WORKSPACE],

  /**
   * `enabled: true` ON PURPOSE, even though an unconfigured deployment answers
   * `false`.
   *
   * The Analytics nav entry is behind this flag, and a conditional row that
   * never renders is a row nobody can judge. Costs: the entry links to
   * `/w/:id/analytics`, which the scene's `MemoryRouter` has no route for, so
   * clicking it with picking OFF leaves the shell with an empty content area
   * until you reload the frame. Worth it — the alternative is a nav list that is
   * permanently one item shorter than the real one.
   */
  '/api/analytics/enabled': { enabled: true },

  /**
   * The workspace's folder list. Empty by default so a scene that only needs the
   * shell does not inherit folder rows; `documents/list` overrides it (see
   * `fixturesFor`'s ordering) with a real folder.
   */
  [`/api/workspaces/${FIXTURE_WORKSPACE.id}/folders`]: [],
};
