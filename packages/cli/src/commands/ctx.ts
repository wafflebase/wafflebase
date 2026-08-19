import { Command } from 'commander';
import { getGlobalOpts } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
} from '../output/formatter.js';
import { loadSession, saveSession } from '../config/session.js';
import type { WorkspaceInfo } from '../config/session.js';

export interface WorkspaceRow {
  id: string;
  name: string;
  active: boolean;
}

/**
 * Structured workspace list — the shape `wafflebase schema ctx.list`
 * has always advertised. The active workspace is flagged by the
 * `active` field rather than a `*` prefix; `--format table` renders it
 * as a column for humans.
 */
export function buildWorkspaceList(
  workspaces: WorkspaceInfo[],
  activeId: string,
): WorkspaceRow[] {
  return workspaces.map((ws) => ({
    id: ws.id,
    name: ws.name,
    active: ws.id === activeId,
  }));
}

/** Thrown when a command needs a session and none is on disk. */
class NotLoggedInError extends Error {
  readonly code = 'NOT_LOGGED_IN';

  constructor() {
    super('Not logged in. Run `wafflebase login`.');
  }
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
    .action(function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        const session = loadSession();
        // Unlike `status`, this command cannot answer without a
        // session, so it reports a structured error and exits 1. The
        // exit code matches `ctx switch`, which still prints prose.
        if (!session) throw new NotLoggedInError();
        output(
          buildWorkspaceList(session.workspaces, session.activeWorkspace),
          fmt,
        );
      } catch (e) {
        outputError(e);
      }
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
