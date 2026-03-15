import { Command } from 'commander';
import { loadSession, saveSession } from '../config/session.js';
import type { WorkspaceInfo } from '../config/session.js';

export function formatWorkspaceList(
  workspaces: WorkspaceInfo[],
  activeId: string,
): string {
  return workspaces
    .map((ws) => {
      const marker = ws.id === activeId ? '*' : ' ';
      return `${marker} ${ws.id.slice(0, 8)}  ${ws.name}`;
    })
    .join('\n');
}

export function findWorkspace(
  workspaces: WorkspaceInfo[],
  query: string,
): WorkspaceInfo | undefined {
  // Exact ID match
  const byId = workspaces.find((ws) => ws.id === query);
  if (byId) return byId;

  // Exact name match (case-insensitive)
  const byName = workspaces.find(
    (ws) => ws.name.toLowerCase() === query.toLowerCase(),
  );
  if (byName) return byName;

  // Prefix match on ID
  const byPrefix = workspaces.filter((ws) => ws.id.startsWith(query));
  if (byPrefix.length === 1) return byPrefix[0];

  return undefined;
}

export function registerCtxCommand(program: Command): void {
  const ctx = program.command('ctx').description('Workspace context switching');

  ctx
    .command('list')
    .description('List workspaces')
    .action(() => {
      const session = loadSession();
      if (!session) {
        console.log('Not logged in. Run `wafflebase login`.');
        return;
      }
      console.log(
        formatWorkspaceList(session.workspaces, session.activeWorkspace),
      );
    });

  ctx
    .command('switch <name-or-id>')
    .description('Switch active workspace')
    .action((query: string) => {
      const session = loadSession();
      if (!session) {
        console.error('Not logged in. Run `wafflebase login`.');
        process.exit(1);
      }

      const ws = findWorkspace(session.workspaces, query);
      if (!ws) {
        console.error(`Workspace not found: ${query}`);
        process.exit(1);
      }

      session.activeWorkspace = ws.id;
      saveSession(session);
      console.log(`Switched to ${ws.name}.`);
    });
}
