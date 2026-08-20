/**
 * The datasources list.
 *
 * `password` is always masked by the API, so the fixture masks it too — a
 * fixture that carries a plausible-looking secret is a fixture someone will
 * eventually paste somewhere real.
 *
 * Two rows with different `sslEnabled` and different host shapes, because the
 * list renders a badge off the first and truncates on the second.
 */
import type { FixtureTable } from '@wafflebase/design-editor/scenes';
import { FIXTURE_USER, FIXTURE_WORKSPACE } from './auth.ts';

const ws = FIXTURE_WORKSPACE.id;

export const FIXTURE_DATASOURCES = [
  {
    id: 'ds-analytics',
    name: 'Analytics warehouse',
    host: 'analytics.internal',
    port: 5432,
    database: 'metrics',
    username: 'readonly',
    password: '••••••••',
    sslEnabled: true,
    authorID: FIXTURE_USER.id,
    workspaceId: ws,
    createdAt: '2026-01-12T10:00:00.000Z',
    updatedAt: '2026-02-03T14:25:00.000Z',
  },
  {
    id: 'ds-local',
    name: 'Local Postgres',
    host: 'localhost',
    port: 5432,
    database: 'wafflebase',
    username: 'wafflebase',
    password: '••••••••',
    sslEnabled: false,
    authorID: FIXTURE_USER.id,
    workspaceId: ws,
    createdAt: '2026-01-30T16:40:00.000Z',
    updatedAt: '2026-01-30T16:40:00.000Z',
  },
];

export const DATASOURCES_FIXTURES: FixtureTable = {
  '/api/datasources': FIXTURE_DATASOURCES,
  [`/api/workspaces/${ws}/datasources`]: FIXTURE_DATASOURCES,
};
