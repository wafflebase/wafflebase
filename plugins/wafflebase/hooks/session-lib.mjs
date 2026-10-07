// SessionStart context for the Wafflebase plugin: is the CLI installed,
// who is logged in, and which web origin deep links should point at.
// Pure functions here; session-start.mjs does the I/O.

/**
 * The web app's origin for an API server URL. The CLI only knows the API
 * server, and the frontend is usually a sibling origin, so:
 *   1. `WAFFLEBASE_WEB_URL` when the user set it (always wins),
 *   2. `api.<host>` → `<host>` (the hosted service's shape),
 *   3. `localhost:3000` → `localhost:5173` (this repository's `pnpm dev`),
 *   4. otherwise the server's own origin (a single-origin self-host).
 *
 * @param {string | undefined} server
 * @param {string | undefined} override
 * @returns {string | null}
 */
export function webOrigin(server, override) {
  if (override) return override.replace(/\/+$/, '');
  if (!server) return null;
  let url;
  try {
    url = new URL(server);
  } catch {
    return null;
  }
  if (url.hostname.startsWith('api.')) {
    url.hostname = url.hostname.slice('api.'.length);
  } else if (
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
    url.port === '3000'
  ) {
    url.port = '5173';
  }
  return url.origin;
}

/** Deep-link route prefix per document type (frontend `App.tsx`). */
export const ROUTES = {
  sheet: 's',
  doc: 'd',
  slides: 'p',
  note: 'n',
  board: 'b',
  pdf: 'f',
  image: 'f',
  file: 'f',
};

function majorMinor(v) {
  const m = /^(\d+)\.(\d+)/.exec(v ?? '');
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * Build the context lines injected at session start.
 *
 * @param {{
 *   cliVersion: string | null,      // `wafflebase --version`, null = not installed
 *   status: object | null,          // `wafflebase status` JSON, null = failed
 *   tableVersion: string,           // CLI version the guard table came from
 *   webUrlOverride?: string,
 * }} input
 * @returns {string}
 */
export function buildContext({ cliVersion, status, tableVersion, webUrlOverride }) {
  const lines = ['Wafflebase plugin:'];
  if (!cliVersion) {
    lines.push(
      '- The `wafflebase` CLI is not installed or not on PATH. Before any Wafflebase task, tell the user to install it (`npm install -g @wafflebase/cli`) and run `wafflebase login`. Do not install it yourself.',
    );
    return lines.join('\n');
  }
  lines.push(`- CLI ${cliVersion} is installed.`);
  if (majorMinor(cliVersion) !== majorMinor(tableVersion)) {
    lines.push(
      `- The plugin's permission table was generated for CLI ${tableVersion}; commands it does not know will ask for confirmation. Suggest updating whichever side is older.`,
    );
  }

  if (!status) {
    lines.push(
      '- `wafflebase status` failed; run it to see why before using other commands.',
    );
    return lines.join('\n');
  }
  if (!status.loggedIn) {
    lines.push(
      '- Not logged in. Ask the user to run `wafflebase login` themselves (it opens a browser), or to set WAFFLEBASE_API_KEY. Do not run login for them.',
    );
    return lines.join('\n');
  }
  if (status.session === 'expired') {
    lines.push(
      '- The saved session has expired; the CLI refreshes it on the next call. If a call fails with an auth error, ask the user to run `wafflebase login`.',
    );
  }
  const ws = status.workspaceName
    ? `${status.workspaceName} (${status.workspaceId})`
    : status.workspaceId;
  lines.push(`- Logged in as ${status.user} on ${status.server}, workspace ${ws}.`);

  const origin = webOrigin(status.server, webUrlOverride);
  if (origin) {
    const routes = Object.entries(ROUTES)
      .map(([type, r]) => `${type} → /${r}/<id>`)
      .join(', ');
    lines.push(
      `- Link every document you mention or touch as ${origin}/<route>/<id> (${routes}).${webUrlOverride ? '' : ' If links do not open, the user can set WAFFLEBASE_WEB_URL.'}`,
    );
  }
  return lines.join('\n');
}
