/**
 * Serving the editor shell — the first of §6's two behaviour changes.
 *
 * The prototype WAS a Vite app: its own root, its own `react()` and
 * `tailwindcss()` in the plugins array, and two HTML entries. As a plugin it owns
 * none of that, so the shell has to be served as prebuilt bytes from
 * `configureServer` middleware. The consumer's Tailwind and React then never
 * process our UI — which is the point: their Tailwind config would restyle our
 * panels, and two Reacts in one page is two Reacts.
 *
 * Two HTML entries, still. `scene.html` is a real document rather than an
 * `about:blank` the host fills in, because that is what gives each frame its own
 * module realm — the engines hold module-level mutable state, so a shared realm
 * would let the two sides see each other's.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

// Imported, not declared: the browser client needs the same value and cannot import
// this file, which pulls in `node:fs`. See `src/base.ts`. Re-exported so every
// existing `import { BASE } from './shell.ts'` keeps working.
import { BASE } from '../base.ts';

export { BASE };

export interface ShellDeps {
  /** Directory holding the prebuilt `index.html`, `scene.html` and assets. */
  distDir: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

export function shellServer(deps: ShellDeps): Plugin {
  return {
    name: 'wafflebase-design-editor:shell',
    apply: 'serve',

    configureServer(server) {
      server.middlewares.use(BASE, (req, res, next) => {
        // The bridge owns `/api/**` under the same base and registers its own
        // middleware; anything it does not answer must fall through rather than be
        // served as a missing asset.
        const raw = (req.url ?? '/').split('?')[0];
        if (raw.startsWith('/api/')) return next();

        // Decoded before it is resolved: a built asset with a space or any non-ASCII
        // character arrives percent-encoded, and resolving the encoded form looks for
        // a file literally named `a%20b.js`. Malformed encoding is a client error, not
        // a traversal — `decodeURIComponent` throws on a lone `%`.
        let url: string;
        try {
          url = decodeURIComponent(raw);
        } catch {
          res.statusCode = 400;
          res.end('malformed request path');
          return;
        }

        // `/` and `/scene` are the two documents; everything else is an asset.
        const rel =
          url === '/' || url === '' ? 'index.html' : url === '/scene' ? 'scene.html' : url.slice(1);

        // The shell's own dist is a fixed, first-party directory, but the request
        // path is not — so it gets the same containment check as any consumer path.
        const abs = path.resolve(deps.distDir, rel);
        const within = path.relative(deps.distDir, abs);
        if (within.startsWith('..') || path.isAbsolute(within)) {
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }

        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          // A missing shell is a build problem, not a routing one, and saying so
          // beats a bare 404 that reads as "the editor is not installed".
          res.statusCode = 404;
          res.end(
            `design-editor shell asset not found: ${rel}\n` +
              `(expected under ${deps.distDir} — was the package built?)`,
          );
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', CONTENT_TYPES[path.extname(abs)] ?? 'application/octet-stream');
        // Never cached: the shell is dev-only and a stale one is indistinguishable
        // from a broken one.
        res.setHeader('Cache-Control', 'no-store');

        // An unhandled `error` on a read stream is an unhandled 'error' EVENT, which
        // takes the dev server's process down — for something as ordinary as the file
        // being replaced by a rebuild mid-request. And `destroy()` on close releases
        // the descriptor when the browser aborts, which it does on every navigation
        // away from a half-loaded shell.
        const stream = fs.createReadStream(abs);
        stream.on('error', (err) => {
          server.config.logger.error(`[design-editor] shell read failed: ${rel} — ${String(err)}`);
          // Headers are already sent, so there is no status left to change: end the
          // response and let the client see a truncated body rather than a hang.
          res.destroy();
        });
        res.on('close', () => stream.destroy());
        stream.pipe(res);
      });
    },
  };
}
