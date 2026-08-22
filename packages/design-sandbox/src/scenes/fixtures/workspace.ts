/**
 * Workspace-scoped fixtures: settings (members/invites/API keys) and the
 * workspace analytics dashboard.
 *
 * `FIXTURE_USER` is seeded as the `owner` member so the page's owner-gated
 * sections (API Keys, Danger Zone) actually render — an editor who can never
 * see those sections can never judge their layout.
 */
import type { FixtureTable } from '@wafflebase/design-editor/scenes';
import { FIXTURE_USER, FIXTURE_WORKSPACE } from './auth.ts';

const ws = FIXTURE_WORKSPACE.id;

export const FIXTURE_WORKSPACE_DETAIL = {
  ...FIXTURE_WORKSPACE,
  members: [
    {
      id: 'mem-ada',
      role: 'owner',
      joinedAt: '2026-01-04T09:00:00.000Z',
      user: { id: FIXTURE_USER.id, username: FIXTURE_USER.username, email: FIXTURE_USER.email, photo: FIXTURE_USER.photo },
    },
    {
      id: 'mem-grace',
      role: 'member',
      joinedAt: '2026-01-10T12:30:00.000Z',
      user: { id: 2, username: 'grace', email: 'grace@wafflebase.dev' },
    },
  ],
};

export const FIXTURE_INVITES = [
  {
    id: 'inv-1',
    token: 'tok_a1b2c3',
    role: 'member',
    createdAt: '2026-01-30T10:00:00.000Z',
    expiresAt: '2026-03-01T10:00:00.000Z',
  },
];

export const FIXTURE_API_KEYS = [
  {
    id: 'key-1',
    name: 'CI pipeline',
    prefix: 'wfb_a1b2',
    createdAt: '2026-01-15T09:00:00.000Z',
    lastUsedAt: '2026-02-10T14:00:00.000Z',
  },
];

export const WORKSPACE_SETTINGS_FIXTURES: FixtureTable = {
  [`/api/workspaces/${ws}`]: FIXTURE_WORKSPACE_DETAIL,
  [`/api/workspaces/${ws}/invites`]: FIXTURE_INVITES,
  [`/api/workspaces/${ws}/api-keys`]: FIXTURE_API_KEYS,
};

/**
 * The document ranking exercises the "Details" link's route
 * (`/w/:workspaceId/analytics/:id`), which is not itself a manifest scene —
 * picking it with picking OFF just confirms the link shape.
 */
export const FIXTURE_WORKSPACE_ANALYTICS = {
  enabled: true,
  totalViews: 482,
  uniqueVisitors: 96,
  viewsByDay: [
    { date: '2026-07-27', value: 40 },
    { date: '2026-07-28', value: 55 },
    { date: '2026-07-29', value: 38 },
    { date: '2026-07-30', value: 72 },
    { date: '2026-07-31', value: 61 },
    { date: '2026-08-01', value: 90 },
    { date: '2026-08-02', value: 126 },
  ],
  byDocument: [
    { documentId: 'doc-q4-revenue', title: 'Q4 Revenue Model', views: 210, uniqueVisitors: 44 },
    { documentId: 'doc-design-review', title: 'Design review notes — spring platform refresh, week 12', views: 152, uniqueVisitors: 31 },
    { documentId: 'doc-launch-deck', title: 'Launch deck', views: 120, uniqueVisitors: 21 },
  ],
};

// Matched by pathname only (`fetch-fixtures.ts#keyOf`), so the fixture key
// carries no query string even though the real request always has one
// (`?from=&to=`, computed from the live date-range preset).
export const WORKSPACE_ANALYTICS_FIXTURES: FixtureTable = {
  [`/api/workspaces/${ws}/analytics`]: FIXTURE_WORKSPACE_ANALYTICS,
};
