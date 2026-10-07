#!/usr/bin/env node
// Entry point for the SessionStart hook; see session-lib.mjs.
//
// `wafflebase status` only reads the local session file, so this costs a
// process spawn, not a network round trip. Any failure degrades to a
// context line rather than an error: a hook must never block the session.

import { execFileSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext, resolveOnPath } from './session-lib.mjs';

const TIMEOUT_MS = 4000;

// The CLI is resolved from PATH by this hook, never by the OS: a relative
// PATH entry (or, on Windows, cmd.exe's own current-directory lookup) would
// otherwise let the open repository ship a `wafflebase` that runs here,
// before any permission prompt. On Windows `npm i -g` installs a
// `wafflebase.cmd` shim, which Node only runs through cmd.exe, so it is
// spawned by absolute path with a shell; the arguments are constants.
const WINDOWS = process.platform === 'win32';

function resolveCli() {
  return resolveOnPath(process.env.PATH, delimiter, isAbsolute, (dir) => {
    const candidate = join(dir, WINDOWS ? 'wafflebase.cmd' : 'wafflebase');
    try {
      accessSync(candidate, WINDOWS ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      return null;
    }
  });
}

/** @returns {string | null | undefined} undefined: not installed; null: failed. */
function run(args) {
  const resolved = resolveCli();
  if (!resolved) return undefined;
  try {
    return execFileSync(WINDOWS ? `"${resolved}"` : resolved, args, {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: WINDOWS,
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function tableVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const table = JSON.parse(
      readFileSync(join(here, 'command-safety.json'), 'utf8'),
    );
    return table.cliVersion;
  } catch {
    return 'unknown';
  }
}

const version = run(['--version']);
let status = null;
if (version !== undefined) {
  const raw = run(['status', '--format', 'json']);
  try {
    status = raw ? JSON.parse(raw) : null;
  } catch {
    status = null;
  }
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: buildContext({
        // undefined: not installed; null or empty: installed but `--version`
        // failed.
        cliVersion: version === undefined ? null : version || 'unknown',
        status,
        tableVersion: tableVersion(),
        webUrlOverride: process.env.WAFFLEBASE_WEB_URL || undefined,
        apiKeyInEnv: Boolean(process.env.WAFFLEBASE_API_KEY),
        envServer: process.env.WAFFLEBASE_SERVER || undefined,
        envWorkspace: process.env.WAFFLEBASE_WORKSPACE || undefined,
      }),
    },
  }),
);
