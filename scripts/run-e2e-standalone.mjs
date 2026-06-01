#!/usr/bin/env node
// One-shot e2e runner: boots backend + frontend dev server, waits on
// ports, runs `pnpm verify:e2e`, tears down. Designed for CI and clean
// local runs. Postgres + Yorkie must already be up (docker compose up -d).

import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

const BACKEND_PORT = Number(process.env.PORT ?? 3000);
const FRONTEND_PORT = 5173;
const WAIT_TIMEOUT_MS = 60_000;
const WAIT_INTERVAL_MS = 500;

const children = [];

function startChild(cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
    shell: false,
  });
  children.push(child);
  return child;
}

function waitForPort(port) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    const tick = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for :${port}`));
        } else {
          setTimeout(tick, WAIT_INTERVAL_MS);
        }
      });
    };
    tick();
  });
}

function preflightHints() {
  const hints = [];
  if (!process.env.DATABASE_URL && !process.env.SKIP_E2E_PREFLIGHT) {
    hints.push(
      "  • DATABASE_URL is unset — run `docker compose up -d` and source the backend .env first.",
    );
  }
  if (hints.length > 0) {
    console.warn('[verify:e2e:standalone] preflight hints:');
    for (const h of hints) console.warn(h);
  }
}

function cleanup() {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

(async () => {
  preflightHints();

  console.log('[verify:e2e:standalone] starting backend (WAFFLEBASE_E2E_AUTH=1)');
  startChild('pnpm', ['--filter', '@wafflebase/backend', 'start:dev'], {
    WAFFLEBASE_E2E_AUTH: '1',
  });

  console.log('[verify:e2e:standalone] starting frontend dev server');
  startChild('pnpm', ['--filter', '@wafflebase/frontend', 'dev']);

  try {
    await Promise.all([waitForPort(BACKEND_PORT), waitForPort(FRONTEND_PORT)]);
  } catch (err) {
    console.error(`[verify:e2e:standalone] ${err.message}`);
    console.error(
      'Hints: `docker compose up -d` for Postgres + Yorkie; check backend logs for missing env.',
    );
    cleanup();
    process.exit(1);
  }

  console.log('[verify:e2e:standalone] running playwright');
  const playwright = startChild('pnpm', ['verify:e2e']);
  playwright.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 1);
  });
})();
