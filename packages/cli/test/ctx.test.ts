import { describe, it, expect } from 'vitest';
import { buildWorkspaceList, findWorkspace } from '../src/commands/ctx.js';
import { format } from '../src/output/formatter.js';
import type { WorkspaceInfo } from '../src/config/session.js';

const workspaces: WorkspaceInfo[] = [
  { id: 'e98ff707-1111-2222-3333-444444444444', name: "hackerwins's Workspace" },
  { id: 'abc12345-aaaa-bbbb-cccc-dddddddddddd', name: 'Team Workspace' },
];

describe('buildWorkspaceList', () => {
  it('flags the active workspace', () => {
    const rows = buildWorkspaceList(workspaces, workspaces[0].id);
    expect(rows[0].active).toBe(true);
    expect(rows[1].active).toBe(false);
  });

  it('flags the second workspace when it is active', () => {
    const rows = buildWorkspaceList(workspaces, workspaces[1].id);
    expect(rows[0].active).toBe(false);
    expect(rows[1].active).toBe(true);
  });

  it('emits full IDs and names in session order', () => {
    const rows = buildWorkspaceList(workspaces, workspaces[0].id);
    expect(rows).toEqual([
      {
        id: 'e98ff707-1111-2222-3333-444444444444',
        name: "hackerwins's Workspace",
        active: true,
      },
      {
        id: 'abc12345-aaaa-bbbb-cccc-dddddddddddd',
        name: 'Team Workspace',
        active: false,
      },
    ]);
  });

  it('returns an empty array when there are no workspaces', () => {
    expect(buildWorkspaceList([], 'none')).toEqual([]);
  });

  it('is JSON-parseable as emitted by the default format', () => {
    const rows = buildWorkspaceList(workspaces, workspaces[0].id);
    expect(JSON.parse(format(rows, 'json'))).toEqual(rows);
  });
});

describe('findWorkspace', () => {
  it('finds by exact ID', () => {
    const ws = findWorkspace(workspaces, workspaces[0].id);
    expect(ws).toBe(workspaces[0]);
  });

  it('finds by exact name (case-insensitive)', () => {
    const ws = findWorkspace(workspaces, 'team workspace');
    expect(ws).toBe(workspaces[1]);
  });

  it('finds by exact name (original case)', () => {
    const ws = findWorkspace(workspaces, 'Team Workspace');
    expect(ws).toBe(workspaces[1]);
  });

  it('finds by ID prefix', () => {
    const ws = findWorkspace(workspaces, 'e98ff707');
    expect(ws).toBe(workspaces[0]);
  });

  it('returns undefined for an unknown query', () => {
    const ws = findWorkspace(workspaces, 'unknown-workspace');
    expect(ws).toBeUndefined();
  });

  it('returns undefined when prefix matches multiple workspaces', () => {
    const ambiguous: WorkspaceInfo[] = [
      { id: 'aabbccdd-1111-2222-3333-444444444444', name: 'Workspace A' },
      { id: 'aabbccdd-5555-6666-7777-888888888888', name: 'Workspace B' },
    ];
    const ws = findWorkspace(ambiguous, 'aabbccdd');
    expect(ws).toBeUndefined();
  });
});
