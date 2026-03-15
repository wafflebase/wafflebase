import { describe, it, expect } from 'vitest';
import {
  formatWorkspaceList,
  findWorkspace,
} from '../src/commands/ctx.js';
import type { WorkspaceInfo } from '../src/config/session.js';

const workspaces: WorkspaceInfo[] = [
  { id: 'e98ff707-1111-2222-3333-444444444444', name: "hackerwins's Workspace" },
  { id: 'abc12345-aaaa-bbbb-cccc-dddddddddddd', name: 'Team Workspace' },
];

describe('formatWorkspaceList', () => {
  it('marks the active workspace with *', () => {
    const output = formatWorkspaceList(workspaces, workspaces[0].id);
    const lines = output.split('\n');
    expect(lines[0]).toMatch(/^\*/);
    expect(lines[1]).toMatch(/^ /);
  });

  it('shows truncated IDs and workspace names', () => {
    const output = formatWorkspaceList(workspaces, workspaces[0].id);
    expect(output).toContain('e98ff707');
    expect(output).toContain("hackerwins's Workspace");
    expect(output).toContain('abc12345');
    expect(output).toContain('Team Workspace');
  });

  it('marks the second workspace when it is active', () => {
    const output = formatWorkspaceList(workspaces, workspaces[1].id);
    const lines = output.split('\n');
    expect(lines[0]).toMatch(/^ /);
    expect(lines[1]).toMatch(/^\*/);
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
