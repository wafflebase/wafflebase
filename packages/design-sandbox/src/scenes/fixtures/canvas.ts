/**
 * What a canvas scene's own PAGE fetches, as opposed to what its engine
 * renders. `document-detail.tsx` / `docs-detail.tsx` / `slides-detail.tsx` /
 * `notes-detail.tsx` all call the same three things directly (confirmed by
 * grepping every one of them): `fetchMe`/`fetchMeOptional` (`/auth/me`,
 * already covered by `auth.ts` — every canvas scene's `mocks` already lists
 * `"auth"`), `fetchWorkspaces` (`/workspaces`, for the sidebar's workspace
 * switcher — these pages render their OWN `<AppSidebar>` rather than going
 * through `shell: "app"`, so `shell.ts`'s `SHELL_FIXTURES` never applies
 * here), and `fetchDocument(id)` (`/documents/:id`, this document's own
 * title/workspaceId — `id` is literally `"fixture"` for all four scenes,
 * since every canvas route is `/s/fixture`, `/d/fixture`, ... and each
 * fetches under its OWN ref, so the identical URL path across all four
 * never collides in practice).
 *
 * Reuses the exact documents already listed in `documents.ts#FIXTURE_DOCUMENTS`
 * (same id-prefix narrative, different literal id since the canvas route's
 * param is the fixed string "fixture") — so the Documents list scene and a
 * canvas editor scene tell the same story about the same fictional documents.
 *
 * `docs-detail.tsx` additionally reaches `GET /api/workspaces/:id` (singular,
 * not the list) through `components/comments/use-workspace-members.ts` — the
 * `@`-mention autocomplete for the comments panel, keyed on the document's
 * own `workspaceId`. Reuses `workspace.ts#FIXTURE_WORKSPACE_DETAIL` (already
 * shaped with `members`) rather than a second literal, so the mention list
 * and the workspace settings scene agree on who is in the workspace.
 */
import type { FixtureTable } from '@wafflebase/design-editor/scenes';
import { FIXTURE_USER, FIXTURE_WORKSPACE } from './auth.ts';
import { FIXTURE_WORKSPACE_DETAIL } from './workspace.ts';

const author = { id: FIXTURE_USER.id, username: FIXTURE_USER.username, photo: FIXTURE_USER.photo };
const ws = FIXTURE_WORKSPACE.id;

/** Every canvas scene's page fetches this, regardless of engine. */
const WORKSPACES_FIXTURE: FixtureTable = {
  '/api/workspaces': [FIXTURE_WORKSPACE],
  [`/api/workspaces/${ws}`]: FIXTURE_WORKSPACE_DETAIL,
};

function documentFixture(doc: {
  title: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}): FixtureTable {
  return {
    ...WORKSPACES_FIXTURE,
    '/api/documents/fixture': {
      id: 'fixture',
      title: doc.title,
      type: doc.type,
      description: '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      workspaceId: ws,
      folderId: null,
      author,
      editors: [],
      canManage: true,
    },
  };
}

export const SHEETS_FIXTURE: FixtureTable = documentFixture({
  title: 'Q4 Revenue Model',
  type: 'sheet',
  createdAt: '2026-01-08T10:15:00.000Z',
  updatedAt: '2026-02-11T16:42:00.000Z',
});

export const DOCS_FIXTURE: FixtureTable = documentFixture({
  title: 'Design review notes — spring platform refresh, week 12',
  type: 'doc',
  createdAt: '2026-01-19T08:00:00.000Z',
  updatedAt: '2026-02-10T11:05:00.000Z',
});

export const SLIDES_FIXTURE: FixtureTable = documentFixture({
  title: 'Launch deck',
  type: 'slides',
  createdAt: '2026-01-22T13:30:00.000Z',
  updatedAt: '2026-02-09T09:20:00.000Z',
});

export const NOTES_FIXTURE: FixtureTable = documentFixture({
  title: 'Scratchpad',
  type: 'note',
  createdAt: '2026-02-01T07:45:00.000Z',
  updatedAt: '2026-02-08T18:11:00.000Z',
});
