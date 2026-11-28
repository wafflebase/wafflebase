import { Command } from 'commander';
import { getConfig, getGlobalOpts } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
} from '../output/formatter.js';
import { loadSession, isSessionExpired } from '../config/session.js';
import type { Session } from '../config/session.js';
import type { CliConfig } from '../config/config.js';

/**
 * `status` payload. Flat (rather than nesting user / workspace /
 * session objects) so `--format table` and `--format csv` — the human
 * paths now that JSON is the default — render every field instead of
 * `[object Object]`.
 */
export interface StatusPayload {
  /** A browser login session exists (`wafflebase login`). */
  loggedIn: boolean;
  /**
   * What the next command authenticates with — an API key (flag, env or
   * profile) wins over the session, so this can differ from `loggedIn`.
   * Absent when the caller did not resolve the config.
   */
  auth?: 'session' | 'api-key' | 'none';
  /** Tells a human what to do next, or that an API key is in charge. */
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
export const API_KEY_ONLY_MESSAGE =
  'No browser session; commands authenticate with an API key.';
export const API_KEY_NO_WORKSPACE_MESSAGE =
  'An API key is set but no workspace is. Set WAFFLEBASE_WORKSPACE (Settings → API keys shows the line).';
export const API_KEY_OVERRIDES_MESSAGE =
  'An API key is set, so commands use it instead of this login session.';

const AUTH_FROM_MODE: Record<CliConfig['authMode'], StatusPayload['auth']> = {
  'api-key': 'api-key',
  jwt: 'session',
  none: 'none',
};

/**
 * Build the structured auth state for a session, or the logged-out
 * payload when there is none. Pure so it can be asserted without
 * spawning the CLI.
 */
export function buildStatus(
  session: Session | null,
  config?: Pick<CliConfig, 'authMode' | 'workspace' | 'server'>,
): StatusPayload {
  const auth = config ? AUTH_FROM_MODE[config.authMode] : undefined;
  if (!session) {
    if (auth === 'api-key') {
      return {
        loggedIn: false,
        auth,
        message: config!.workspace
          ? API_KEY_ONLY_MESSAGE
          : API_KEY_NO_WORKSPACE_MESSAGE,
        server: config!.server,
        ...(config!.workspace ? { workspaceId: config!.workspace } : {}),
      };
    }
    return {
      loggedIn: false,
      ...(auth ? { auth } : {}),
      message: NOT_LOGGED_IN_MESSAGE,
    };
  }

  if (auth === 'api-key') {
    return {
      loggedIn: true,
      auth,
      message: API_KEY_OVERRIDES_MESSAGE,
      user: session.user.username,
      email: session.user.email,
      server: config!.server,
      workspaceId: config!.workspace,
      session: isSessionExpired(session) ? 'expired' : 'valid',
      expiresAt: session.expiresAt,
    };
  }

  const ws = session.workspaces.find((w) => w.id === session.activeWorkspace);

  return {
    loggedIn: true,
    ...(auth ? { auth } : {}),
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
        output(buildStatus(loadSession(), getConfig(opts)), fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
