/**
 * preview-tokens.mts — render the token variable map from PATCHED sources.
 *
 * A long-lived worker for the design-editor bridge (`POST
 * /__design-editor/preview-tokens`). Reads one JSON request per line on stdin and
 * writes one JSON response per line on stdout.
 *
 * WHY A WORKER AND NOT A LIBRARY CALL. The bridge runs inside the Vite config,
 * which Node loads as transpiled JS — it cannot `import` a `.ts` file. Spawning
 * `tsx` per request costs ~400 ms, far too slow for a live preview, so the
 * bridge keeps one of these warm: the render itself is sub-millisecond and only
 * the IPC (~1 ms) is paid per edit.
 *
 * WHY NOT COMPUTE THE VARS IN THE BROWSER. `paletteBlock()` has hand-written,
 * mode-conditional logic (`syrupForMode`; `--wb-syrup-deep` maps to
 * `palette.butter` in dark). Porting that into the sandbox client would make the
 * preview's colour maths a second implementation of the emitter, free to drift
 * from the bytes a commit actually writes. Running the real emitter is the only
 * way "what you see is what you save" holds — and it is also what resolves
 * `computed` bindings like `` `rgba(${palette.butterRgb}, 0.30)` ``, which no
 * text-level analysis could.
 *
 * WHY IT TAKES TEXT, NOT VALUES. The bridge's `composeIntents` produces the
 * patched SOURCE of the four token files without writing them. Turning that into
 * values means evaluating the modules, so the worker writes them to a scratch
 * directory and imports them. A fresh directory per request is what busts the
 * ESM cache: `semantic.ts` imports `./palette`, and a query-string bust on
 * `semantic.ts` alone would still resolve the CACHED palette and silently return
 * pre-edit colours.
 *
 * Request:  { id, files: { palette, semantic, radius, typography } }   // source text
 * Response: { id, ok: true, light: {var: value}, dark: {…} } | { id, ok: false, error }
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { tokenBlocks, type TokenSources } from './build-css.js';

interface Request {
  id?: number;
  files?: Partial<Record<'palette' | 'semantic' | 'radius' | 'typography', string>>;
}

const NAMES = ['palette', 'semantic', 'radius', 'typography'] as const;
const toMap = (block: Array<[string, string]>) => Object.fromEntries(block);

/** Scratch dirs from previous requests, removed once the next one succeeds. */
const stale: string[] = [];

async function handle(req: Request) {
  const files = req.files ?? {};
  const missing = NAMES.filter((n) => typeof files[n] !== 'string');
  if (missing.length) throw new Error(`files must include ${missing.join(', ')}`);

  const dir = mkdtempSync(join(tmpdir(), 'wb-preview-tokens-'));
  stale.push(dir);
  for (const n of NAMES) writeFileSync(join(dir, `${n}.ts`), files[n]!, 'utf8');

  const load = async (n: string) => import(pathToFileURL(join(dir, `${n}.ts`)).href);
  const [p, s, r, t] = await Promise.all(NAMES.map(load));
  const sources: TokenSources = {
    palette: p.palette,
    semantic: s.semantic,
    radius: r.radius,
    typography: t.typography,
  };

  const { light, dark } = tokenBlocks(sources);
  // Keep only the newest scratch dir; the imported modules stay resident in the
  // ESM registry, so deleting the files afterwards is safe.
  while (stale.length > 1) rmSync(stale.shift()!, { recursive: true, force: true });
  return { light: toMap(light), dark: toMap(dark) };
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let id: number | undefined;
  (async () => {
    try {
      const req = JSON.parse(trimmed) as Request;
      id = req.id;
      const out = await handle(req);
      process.stdout.write(`${JSON.stringify({ id, ok: true, ...out })}\n`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      process.stdout.write(`${JSON.stringify({ id, ok: false, error })}\n`);
    }
  })();
});

process.on('exit', () => {
  for (const d of stale) rmSync(d, { recursive: true, force: true });
});
