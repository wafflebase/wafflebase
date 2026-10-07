#!/usr/bin/env node
// Entry point for the SessionStart hook; see session-lib.mjs.
//
// `wafflebase status` only reads the local session file, so this costs a
// process spawn, not a network round trip. Any failure degrades to a
// context line rather than an error: a hook must never block the session.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext } from './session-lib.mjs';

const TIMEOUT_MS = 4000;

// On Windows `npm i -g` installs a `wafflebase.cmd` shim, which Node only
// spawns through a shell (and execFile does not search PATHEXT). The
// arguments below are constants, so the shell sees nothing user-supplied.
const WINDOWS = process.platform === 'win32';

function run(args) {
  try {
    return execFileSync(WINDOWS ? 'wafflebase.cmd' : 'wafflebase', args, {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: WINDOWS,
      windowsHide: true,
    }).trim();
  } catch (e) {
    // ENOENT: not installed. Anything else: installed but failing.
    if (e && e.code === 'ENOENT') return undefined;
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
        // undefined: not installed; null: installed but `--version` failed.
        cliVersion: version === undefined ? null : (version ?? 'unknown'),
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
