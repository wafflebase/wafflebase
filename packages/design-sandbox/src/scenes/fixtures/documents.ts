/**
 * The documents list.
 *
 * Chosen to exercise the layout rather than to look tidy: every document type
 * the list has an icon branch for, a row that is currently being edited (the
 * `editors` avatar stack), a long title that must truncate, a row the user
 * cannot manage (`canManage: false` hides the row actions), and a folder. A
 * fixture of five identical rows would let a broken branch look fine.
 *
 * Times are fixed literals. A `Date.now()`-relative fixture makes "2 minutes
 * ago" drift between the two frames of a visual diff and turns every capture
 * into a false positive.
 */
import type { FixtureTable } from '@wafflebase/design-editor/scenes';
import { FIXTURE_USER, FIXTURE_WORKSPACE } from './auth.ts';

const author = { id: FIXTURE_USER.id, username: FIXTURE_USER.username, photo: FIXTURE_USER.photo };
const ws = FIXTURE_WORKSPACE.id;

export const FIXTURE_DOCUMENTS = [
  {
    id: 'doc-q4-revenue',
    title: 'Q4 Revenue Model',
    type: 'sheet',
    description: '',
    createdAt: '2026-01-08T10:15:00.000Z',
    updatedAt: '2026-02-11T16:42:00.000Z',
    workspaceId: ws,
    folderId: null,
    author,
    // Drives the "currently editing" avatar stack — a branch that only renders
    // when someone else has the document open.
    editors: [{ username: 'grace', email: 'grace@wafflebase.dev' }],
    canManage: true,
  },
  {
    id: 'doc-design-review',
    title: 'Design review notes — spring platform refresh, week 12',
    type: 'doc',
    description: '',
    createdAt: '2026-01-19T08:00:00.000Z',
    updatedAt: '2026-02-10T11:05:00.000Z',
    workspaceId: ws,
    folderId: null,
    author,
    editors: [],
    canManage: true,
  },
  {
    id: 'doc-launch-deck',
    title: 'Launch deck',
    type: 'slides',
    description: '',
    createdAt: '2026-01-22T13:30:00.000Z',
    updatedAt: '2026-02-09T09:20:00.000Z',
    workspaceId: ws,
    folderId: null,
    author,
    editors: [],
    canManage: true,
  },
  {
    id: 'doc-contract',
    title: 'Vendor contract (signed)',
    type: 'pdf',
    description: '',
    createdAt: '2026-01-05T15:00:00.000Z',
    updatedAt: '2026-01-05T15:00:00.000Z',
    workspaceId: ws,
    folderId: null,
    // Someone else's document: the row actions must not render.
    author: { id: 2, username: 'grace', photo: null },
    editors: [],
    canManage: false,
  },
  {
    id: 'doc-scratch',
    title: 'Scratchpad',
    type: 'note',
    description: '',
    createdAt: '2026-02-01T07:45:00.000Z',
    updatedAt: '2026-02-08T18:11:00.000Z',
    workspaceId: ws,
    folderId: null,
    author,
    editors: [],
    canManage: true,
  },
];

export const FIXTURE_FOLDERS = [
  {
    id: 'folder-archive',
    name: 'Archive',
    parentId: null,
    authorID: FIXTURE_USER.id,
    createdAt: '2026-01-02T09:00:00.000Z',
  },
];

export const DOCUMENTS_FIXTURES: FixtureTable = {
  '/api/documents': FIXTURE_DOCUMENTS,
  [`/api/workspaces/${ws}/folders`]: FIXTURE_FOLDERS,
  [`/api/workspaces/${ws}/documents`]: FIXTURE_DOCUMENTS,
};
