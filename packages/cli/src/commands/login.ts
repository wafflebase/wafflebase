import { Command } from 'commander';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import {
  loadSession,
  saveSession,
  decodeJwtExpiry,
} from '../config/session.js';
import type { Session, WorkspaceInfo } from '../config/session.js';
import { DEFAULT_SERVER } from '../config/config.js';

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Log in via GitHub OAuth in the browser')
    .option('--server <url>', 'Server URL', DEFAULT_SERVER)
    .action(async (opts: { server: string }) => {
      const server = opts.server.replace(/\/$/, '');

      // 1. Check existing session
      const existing = loadSession();
      if (existing) {
        const answer = await ask(
          `Logged in as ${existing.user.username}. Continue? [Y/n] `,
        );
        if (answer.toLowerCase() === 'n') {
          console.log('Cancelled.');
          return;
        }
      }

      // 2. Start local HTTP server
      const { port, waitForCallback, close } = await startCallbackServer();

      // 3. Build OAuth URL and open browser
      const oauthUrl = `${server}/auth/github?mode=cli&port=${port}`;
      console.error(`Opening browser: ${oauthUrl}`);
      console.error('If the browser does not open, visit the URL above.');

      try {
        const open = (await import('open')).default;
        await open(oauthUrl);
      } catch {
        // Browser open failed — URL was already printed
      }

      // 4. Wait for callback
      let code: string;
      try {
        code = await waitForCallback();
      } finally {
        close();
      }

      // 5. Exchange code for tokens
      const exchangeRes = await fetch(`${server}/auth/cli/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!exchangeRes.ok) {
        console.error(
          'Token exchange failed. Try again with `wafflebase login`.',
        );
        process.exit(1);
      }

      const tokens = (await exchangeRes.json()) as {
        accessToken: string;
        refreshToken: string;
      };

      // 6. Get user info
      const meRes = await fetch(`${server}/auth/me`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (!meRes.ok) {
        console.error('Failed to fetch user info.');
        process.exit(1);
      }

      const user = (await meRes.json()) as {
        id: number;
        username: string;
        email: string;
        photo: string | null;
      };

      // 7. Get workspace list
      const wsRes = await fetch(`${server}/workspaces`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      let workspaces: WorkspaceInfo[] = [];
      if (wsRes.ok) {
        workspaces = (await wsRes.json()) as WorkspaceInfo[];
      }

      // 8. Select workspace
      let activeWorkspace = '';
      if (workspaces.length === 0) {
        console.log('No workspaces found.');
      } else if (workspaces.length === 1) {
        activeWorkspace = workspaces[0].id;
        console.log(`Workspace: ${workspaces[0].name}`);
      } else {
        console.log('Select a workspace:');
        workspaces.forEach((ws, i) => {
          console.log(`  ${i + 1}. ${ws.name} (${ws.id.slice(0, 8)})`);
        });
        const choice = await ask('Enter number: ');
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < workspaces.length) {
          activeWorkspace = workspaces[idx].id;
        } else {
          activeWorkspace = workspaces[0].id;
          console.log(`Invalid choice, using ${workspaces[0].name}.`);
        }
      }

      // 9. Save session
      const session: Session = {
        server,
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: decodeJwtExpiry(tokens.accessToken),
        activeWorkspace,
        workspaces,
      };

      saveSession(session);
      console.log(`Logged in as ${user.username}.`);
    });
}

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function startCallbackServer(): Promise<{
  port: number;
  waitForCallback: () => Promise<string>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let callbackResolve: (code: string) => void;
    let callbackReject: (err: Error) => void;

    const callbackPromise = new Promise<string>((res, rej) => {
      callbackResolve = res;
      callbackReject = rej;
    });

    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing code');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body><h2>Login successful!</h2><p>You can close this tab.</p></body></html>',
      );

      if (!settled) {
        settled = true;
        callbackResolve(code);
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        callbackReject(
          new Error('Login timed out. Try again with `wafflebase login`.'),
        );
      }
      srv.close();
    }, 30_000);

    // Try to listen on a random port (up to 3 attempts)
    let attempts = 0;
    const tryListen = () => {
      attempts++;
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to start callback server'));
          return;
        }
        resolve({
          port: addr.port,
          waitForCallback: () => callbackPromise,
          close: () => {
            clearTimeout(timeout);
            srv.close();
          },
        });
      });
    };

    srv.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && attempts < 3) {
        tryListen();
      } else {
        reject(err);
      }
    });

    tryListen();
  });
}
