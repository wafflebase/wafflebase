/**
 * The preview worker's protocol and — mostly — its failure paths.
 *
 * WHY FAKE CHILDREN RATHER THAN THE REAL EMITTER. Each test here spawns a child emulating
 * one behaviour — a banner on stdout, a malformed line, an immediate exit, silence, a
 * wrapper that outlives the pipe it was reading. The real `preview-tokens.mts` does none
 * of those on demand, and the behaviours that matter are exactly the ones it cannot be
 * asked to perform. The real worker is covered in `core-adapter.test.ts`, through
 * `emit()`, where it belongs.
 *
 * The failure paths are the point. A worker that dies leaves requests in flight, and the
 * prototype's version answered them only when their individual 15-second timers expired —
 * so a broken emitter presented as a hung editor rather than a broken one. Each test below
 * asserts a settled answer, and the suite would take minutes rather than seconds if any of
 * them regressed to waiting for a timeout.
 */

import { describe, expect, it } from 'vitest';
import {
  createPreviewWorker,
  type PreviewSources,
  type PreviewWorker,
} from '../../src/tokens/preview-worker';

/** A worker built from an inline node script, so each test owns its behaviour. */
const fake = (script: string, timeoutMs = 5_000): PreviewWorker =>
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

/**
 * A worker whose child is a WRAPPER, holding a pipe the child itself stops reading.
 *
 * The process `spawn` returns is a shell, and the thing that reads stdin is a
 * short-lived node it runs — the `pnpm exec tsx` chain's shape, where the emitter
 * reading the pipe sits two levels below the process the worker holds. When that
 * emitter dies and the wrapper does not, the pipe's read end is gone while
 * `exitCode` and `killed` are both still clear, and a write fails with `EPIPE`
 * rather than `ERR_STREAM_DESTROYED`.
 *
 * Ordered so nothing races: the shell consumes the request, closes the read end
 * with `exec 0<&-`, and answers only AFTER that. The answer that releases the first
 * `render()` is therefore emitted into an already-broken pipe, so the second write
 * cannot arrive early. Measured 25/25.
 *
 * `fs.closeSync(0)` in a plain node child was tried first and REJECTED as flaky —
 * 1/20 standalone, and it failed 3 of 15 vitest runs. Closing the fd does not
 * reliably close the pipe: libuv still holds it registered for reading, so the
 * parent's write lands in the buffer and SUCCEEDS, and the request then hangs until
 * the child exits. A shell keeps no such bookkeeping, which is why the close here is
 * a plain redirection.
 *
 * POSIX only, like the process-group `dispose()` and `DETACH` this suite already
 * leans on; nothing in this package runs on Windows.
 */
const wrapperFake = (timeoutMs: number): PreviewWorker =>
  createPreviewWorker({
    cwd: process.cwd(),
    command: '/bin/sh',
    args: [
      '-c',
      [
        'read -r req',
        'exec 0<&-',
        // `$$` is the shell's own pid — the process `spawn` returned, and the group
        // leader. Reporting it in the answer is what lets a test assert the dropped
        // child was actually killed, with no `ps` scraping and no pid guessing.
        `'${process.execPath}' -e 'const m=JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify({id:m.id,ok:true,light:{"--n":String(m.id),"--pid":process.argv[2]}})+"\\n")' "$req" "$$"`,
        // Bounded, because staying alive is the whole point: `dispose()` reaches the
        // LIVE child only, and the respawn test leaves a predecessor behind by design.
        'sleep 5',
      ].join('\n'),
    ],
    timeoutMs,
  });

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

  it('settles in-flight requests when the child outlives its stdin', async () => {
    // The failure the case above cannot reach, and the one that used to take the whole
    // process down: an unhandled `'error'` event on a stream is an uncaught exception. With
    // the fix reverted, vitest reports it as an unhandled error charged to whichever file
    // was running — which is how a bug in this worker surfaced as failures somewhere else.
    //
    // 600 s deliberately. This child never exits, so `child.on('exit')` cannot settle the
    // request; a regression fails by hanging rather than by assertion.
    const w = wrapperFake(600_000);
    try {
      expect((await w.render(SOURCES)).ok).toBe(true);
      const r = await w.render(SOURCES);
      expect(r.ok).toBe(false);
      // `EPIPE`, and explicitly NOT the exit path. Same write into the same dead pipe as
      // the test above, different error, because the discriminator is whether the stream
      // has been destroyed — and it has not, the child is still running.
      expect(r.error).toContain('lost stdin: EPIPE');
      expect(r.error).not.toContain('exited');
    } finally {
      w.dispose();
    }
  });

  it('respawns after the child loses its stdin', async () => {
    const w = wrapperFake(600_000);
    try {
      expect((await w.render(SOURCES)).light?.['--n']).toBe('1');
      expect((await w.render(SOURCES)).error).toContain('lost stdin');

      // `--n: 1` from a fresh child whose predecessor never exited. `ensure()` keys its
      // liveness check on `exitCode` and `killed`, both still clear on the old child, so
      // this passes only because the stdin failure dropped `live` too. Without that the
      // worker writes into the same dead pipe forever and a broken emitter never recovers
      // without a dev-server restart. No polling needed: the `'error'` event is what
      // settles the second render, and `die()` clears `live` before it resolves.
      expect((await w.render(SOURCES)).light?.['--n']).toBe('1');
    } finally {
      w.dispose();
    }
  });

  it('kills the child it drops on stdin loss', async () => {
    // `die()` clears `live`, and nothing can reach that child afterwards — `dispose()`
    // only ever stops its replacement. So the signal has to happen here or the process
    // tree leaks, once per respawn. Measured before this test existed: two wrappers
    // survived a run of this file, and every assertion still passed, which is exactly
    // the kind of silent regression this suite is supposed to catch.
    const w = wrapperFake(600_000);
    let pid: number;
    try {
      const first = await w.render(SOURCES);
      pid = Number(first.light?.['--pid']);
      expect(Number.isInteger(pid)).toBe(true);
      // Alive right now, so the assertion below is about the kill and not about a pid
      // that was never running.
      expect(() => process.kill(pid, 0)).not.toThrow();

      expect((await w.render(SOURCES)).error).toContain('lost stdin');
    } finally {
      w.dispose();
    }

    // Polled: SIGTERM delivery and reaping are asynchronous. `process.kill(pid, 0)`
    // throws ESRCH once the pid is gone — it is our own child, so Node reaps it.
    let gone = false;
    for (let i = 0; i < 60 && !gone; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        gone = true;
        break;
      }
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(gone, `wrapper ${pid} survived being dropped`).toBe(true);
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

      /*
       * Polled, not slept. The child calls `process.exit` 10 ms after answering, and
       * `ensure()` only replaces it once the PARENT has observed that exit; a fixed wait
       * bets on winning that race, and on a loaded machine the write instead lands in a
       * dying pipe and the test fails for a reason it is not about.
       *
       * `--n: 1` again, not `2`, is still the whole assertion — the fresh child's sequence
       * starts over, which is the observable proof that this is a new process. So a `2`
       * means the old child answered and the loop simply has not waited long enough yet,
       * and a worker that never respawned answers nothing at all: the loop then exhausts
       * and `light` stays undefined, which is the regression this case exists to catch.
       */
      let light: Record<string, string> | undefined;
      for (let i = 0; i < 100; i++) {
        const r = await w.render(SOURCES);
        if (r.ok && r.light?.['--n'] === '1') {
          light = r.light;
          break;
        }
        await new Promise((res) => setTimeout(res, 20));
      }
      expect(light, 'no fresh child ever answered').toEqual({ '--n': '1' });
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
