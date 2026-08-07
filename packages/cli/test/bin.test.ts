import { describe, it, expect, vi } from 'vitest';

// `src/bin.ts` runs the CLI as a module-scope side effect, so it can only be
// observed by importing it with the entrypoint stubbed. Without this guard
// `runCli` (and the error envelope it owns — see output.test.ts) could stop
// being reached from the shipped binary with every other test still green.
const { runCli } = vi.hoisted(() => ({
  runCli: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock('../src/cli.js', () => ({ runCli, buildProgram: vi.fn() }));

describe('bin entrypoint', () => {
  it('runs the CLI on import, letting runCli default to process.argv', async () => {
    await import('../src/bin.js');

    expect(runCli).toHaveBeenCalledOnce();
    // No explicit program/argv: `runCli` builds the wired program and lets
    // commander read `process.argv` itself.
    expect(runCli).toHaveBeenCalledWith();
  });
});
