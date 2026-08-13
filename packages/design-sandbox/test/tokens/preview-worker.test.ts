/**
 * The preview worker's protocol and — mostly — its failure paths.
 *
 * WHY FAKE CHILDREN RATHER THAN THE REAL EMITTER. Every test here spawns `node -e` with a
 * few lines emulating one behaviour: a banner on stdout, a malformed line, an immediate
 * exit, silence. The real `preview-tokens.mts` does none of those on demand, and the
 * behaviours that matter are exactly the ones it cannot be asked to perform. The real
 * worker is covered in `core-adapter.test.ts`, through `emit()`, where it belongs.
 *
 * The failure paths are the point. A worker that dies leaves requests in flight, and the
 * prototype's version answered them only when their individual 15-second timers expired —
 * so a broken emitter presented as a hung editor rather than a broken one. Each test below
 * asserts a settled answer, and the suite would take minutes rather than seconds if any of
 * them regressed to waiting for a timeout.
 */

import { describe, expect, it } from 'vitest';
import { createPreviewWorker, type PreviewSources } from '../../src/tokens/preview-worker';

/** A worker built from an inline node script, so each test owns its behaviour. */
const fake = (script: string, timeoutMs = 5_000) =>
  createPreviewWorker({
    cwd: process.cwd(),
    command: process.execPath,
    args: ['-e', script],
    timeoutMs,
  });

/** The line protocol, in the shape `preview-tokens.mts` implements. */
const READ_LINES = `const rl = require('readline').createInterface({input: process.stdin});`;

const SOURCES: PreviewSources = {
  palette: 'PALETTE',
  semantic: 'SEMANTIC',
  radius: 'RADIUS',
  typography: 'TYPOGRAPHY',
};

describe('createPreviewWorker', () => {
  it('renders a response and correlates it by id', async () => {
    const w = fake(`${READ_LINES}
      rl.on('line', (l) => {
        const m = JSON.parse(l);
        process.stdout.write(JSON.stringify({id: m.id, ok: true, light: {'--seen': m.files.palette}, dark: {}}) + '\\n');
      });`);
    try {
      const r = await w.render(SOURCES);
      expect(r.ok).toBe(true);
      expect(r.light).toEqual({ '--seen': 'PALETTE' });
    } finally {
      w.dispose();
    }
  });

  it('keeps concurrent requests apart', async () => {
    // Replies in REVERSE order, so a worker that matched responses positionally rather
    // than by id would hand each request the other's answer.
    const w = fake(`${READ_LINES}
      const q = [];
      rl.on('line', (l) => {
        q.push(JSON.parse(l));
        if (q.length === 2) for (const m of q.reverse())
          process.stdout.write(JSON.stringify({id: m.id, ok: true, light: {'--id': String(m.id)}, dark: {}}) + '\\n');
      });`);
    try {
      const [a, b] = await Promise.all([
        w.render({ ...SOURCES, palette: 'A' }),
        w.render({ ...SOURCES, palette: 'B' }),
      ]);
      expect(a.light).toEqual({ '--id': '1' });
      expect(b.light).toEqual({ '--id': '2' });
    } finally {
      w.dispose();
    }
  });

  it('skips a package-manager banner on stdout', async () => {
    // Measured, not hypothetical: `pnpm exec` prints to stdout, and a worker that treated
    // the first line as its response would fail every request behind one banner.
    const w = fake(`
      process.stdout.write('Progress: resolved 1, reused 0\\n');
      ${READ_LINES}
      rl.on('line', (l) => {
        const m = JSON.parse(l);
        process.stdout.write(JSON.stringify({id: m.id, ok: true, light: {}, dark: {}}) + '\\n');
      });`);
    try {
      expect((await w.render(SOURCES)).ok).toBe(true);
    } finally {
      w.dispose();
    }
  });

  it('survives a malformed JSON line', async () => {
    const w = fake(`${READ_LINES}
      rl.on('line', (l) => {
        const m = JSON.parse(l);
        process.stdout.write('{not json at all\\n');
        process.stdout.write(JSON.stringify({id: m.id, ok: true, light: {'--ok': '1'}, dark: {}}) + '\\n');
      });`);
    try {
      expect((await w.render(SOURCES)).light).toEqual({ '--ok': '1' });
    } finally {
      w.dispose();
    }
  });

  it('reports an unfindable command instead of hanging', async () => {
    const w = createPreviewWorker({
      cwd: process.cwd(),
      command: 'wafflebase-no-such-command',
      args: [],
      // Deliberately far longer than the test could tolerate: if the `error` event did not
      // settle the request, this test would fail by TIMING OUT rather than by assertion,
      // which is the regression it guards against.
      timeoutMs: 600_000,
    });
    try {
      const r = await w.render(SOURCES);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('failed to start');
    } finally {
      w.dispose();
    }
  });

  it('settles in-flight requests with the cause when the child dies', async () => {
    const w = fake(
      `process.stderr.write('Error: cannot find module tsx\\n'); process.exit(3);`,
      600_000,
    );
    try {
      const r = await w.render(SOURCES);
      expect(r.ok).toBe(false);
      // The exit code AND the stderr tail. The prototype discarded stderr, so a startup
      // failure reported `preview worker exited` with nothing to act on.
      expect(r.error).toContain('exited (code 3)');
      expect(r.error).toContain('cannot find module tsx');
    } finally {
      w.dispose();
    }
  });

  it('times out a worker that never answers', async () => {
    const w = fake(`${READ_LINES} rl.on('line', () => {});`, 120);
    try {
      const r = await w.render(SOURCES);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('timed out after 120ms');
    } finally {
      w.dispose();
    }
  });

  it('respawns after the child exits', async () => {
    // A worker that answers once and quits. The second render must get a fresh child
    // rather than a permanent "worker exited" — the dev server outlives its children.
    const w = fake(`${READ_LINES}
      rl.on('line', (l) => {
        const m = JSON.parse(l);
        process.stdout.write(JSON.stringify({id: m.id, ok: true, light: {'--n': String(m.id)}, dark: {}}) + '\\n');
        setTimeout(() => process.exit(0), 10);
      });`);
    try {
      expect((await w.render(SOURCES)).light).toEqual({ '--n': '1' });
      await new Promise((r) => setTimeout(r, 80));
      // `--n: 1` again, not `2`: the fresh child's sequence starts over, which is the
      // observable proof that this is a new process and not the old one.
      expect((await w.render(SOURCES)).light).toEqual({ '--n': '1' });
    } finally {
      w.dispose();
    }
  });

  it('refuses to render after dispose', async () => {
    const w = fake(`${READ_LINES} rl.on('line', () => {});`);
    w.dispose();
    const r = await w.render(SOURCES);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('preview worker disposed');
  });

  it('settles in-flight requests on dispose', async () => {
    const w = fake(`${READ_LINES} rl.on('line', () => {});`, 600_000);
    const pending = w.render(SOURCES);
    w.dispose();
    expect(await pending).toEqual({ ok: false, error: 'preview worker disposed' });
  });

  it('is idempotent under a repeated dispose', () => {
    const w = fake(`${READ_LINES} rl.on('line', () => {});`);
    w.dispose();
    expect(() => w.dispose()).not.toThrow();
  });
});
