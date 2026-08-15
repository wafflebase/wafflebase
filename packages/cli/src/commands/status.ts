import { Command } from 'commander';
import { getGlobalOpts } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
} from '../output/formatter.js';
import { loadSession, isSessionExpired } from '../config/session.js';
import type { Session } from '../config/session.js';

/**
 * `status` payload. Flat (rather than nesting user / workspace /
 * session objects) so `--format table` and `--format csv` — the human
 * paths now that JSON is the default — render every field instead of
 * `[object Object]`.
 */
export interface StatusPayload {
  loggedIn: boolean;
  /** Present only when logged out; tells a human what to do next. */
  message?: string;
  user?: string;
  email?: string;
  server?: string;
  workspaceId?: string;
  /** `null` when the active workspace is absent from the session list. */
  workspaceName?: string | null;
  session?: 'valid' | 'expired';
  expiresAt?: string;
}

export const NOT_LOGGED_IN_MESSAGE = 'Not logged in. Run `wafflebase login`.';

/**
 * Build the structured auth state for a session, or the logged-out
 * payload when there is none. Pure so it can be asserted without
 * spawning the CLI.
 */
export function buildStatus(session: Session | null): StatusPayload {
  if (!session) {
    return { loggedIn: false, message: NOT_LOGGED_IN_MESSAGE };
  }

  const ws = session.workspaces.find((w) => w.id === session.activeWorkspace);

  return {
    loggedIn: true,
    user: session.user.username,
    email: session.user.email,
    server: session.server,
    workspaceId: session.activeWorkspace,
    workspaceName: ws ? ws.name : null,
    session: isSessionExpired(session) ? 'expired' : 'valid',
    expiresAt: session.expiresAt,
  };
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show current auth state')
    .action(function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        // Being logged out is a successful answer to "what is my auth
        // state?", so this stays exit 0 — agents branch on `loggedIn`.
        output(buildStatus(loadSession()), fmt);
      } catch (e) {
        outputError(e);
      }
    });
}
