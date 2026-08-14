import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Command } from 'commander';
import { formatJson } from '../src/output/json.js';
import { formatTable } from '../src/output/table.js';
import { formatCsv } from '../src/output/csv.js';
import { formatYaml } from '../src/output/yaml.js';
import {
  format,
  output,
  outputError,
  type OutputFormat,
} from '../src/output/formatter.js';
import { SystemError, httpError } from '../src/errors.js';
import { InvalidDocxError } from '../src/docs/docx-import.js';
import { buildProgram, runCli } from '../src/cli.js';
import { createProgram } from '../src/commands/root.js';
import { registerDocsCommand } from '../src/commands/docs.js';
import { registerSheetsCommand } from '../src/commands/sheets.js';

describe('formatJson', () => {
  it('pretty-prints JSON', () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('formatTable', () => {
  it('formats array of objects as aligned table', () => {
    const data = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ];
    const result = formatTable(data);
    const lines = result.split('\n');
    expect(lines).toHaveLength(4); // header + separator + 2 rows
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('name');
    expect(lines[2]).toContain('Alice');
    expect(lines[3]).toContain('Bob');
  });

  it('returns no results for empty array', () => {
    expect(formatTable([])).toBe('(no results)');
  });
});

describe('formatCsv', () => {
  it('formats array of objects as CSV', () => {
    const data = [
      { name: 'Alice', score: 95 },
      { name: 'Bob', score: 87 },
    ];
    const result = formatCsv(data);
    const lines = result.split('\n');
    expect(lines[0]).toBe('name,score');
    expect(lines[1]).toBe('Alice,95');
    expect(lines[2]).toBe('Bob,87');
  });

  it('escapes commas and quotes', () => {
    const data = [{ value: 'has, comma' }, { value: 'has "quotes"' }];
    const result = formatCsv(data);
    const lines = result.split('\n');
    expect(lines[1]).toBe('"has, comma"');
    expect(lines[2]).toBe('"has ""quotes"""');
  });

  it('returns empty string for empty array', () => {
    expect(formatCsv([])).toBe('');
  });

  it('formats a single object as one-row CSV', () => {
    const result = formatCsv({ id: '1', title: 'Doc' });
    const lines = result.split('\n');
    expect(lines[0]).toBe('id,title');
    expect(lines[1]).toBe('1,Doc');
  });

  it('serializes nested objects as JSON', () => {
    const data = [{ name: 'a', meta: { x: 1 } }];
    const result = formatCsv(data);
    const lines = result.split('\n');
    // JSON is CSV-escaped: {"x":1} → "{""x"":1}"
    expect(lines[1]).toBe('a,"{""x"":1}"');
  });
});

describe('formatYaml', () => {
  it('formats array of objects as YAML', () => {
    const data = [
      { name: 'Alice', score: 95 },
      { name: 'Bob', score: 87 },
    ];
    const result = formatYaml(data);
    expect(result).toBe(
      '- name: Alice\n  score: 95\n- name: Bob\n  score: 87',
    );
  });
});

describe('format dispatcher', () => {
  const data = [{ a: 1 }];

  it('dispatches to json', () => {
    expect(format(data, 'json')).toContain('"a"');
  });

  it('dispatches to table', () => {
    expect(format(data, 'table')).toContain('a');
  });

  it('dispatches to csv', () => {
    expect(format(data, 'csv')).toContain('a\n1');
  });

  it('dispatches to yaml', () => {
    expect(format(data, 'yaml')).toBe('- a: 1');
  });

  it('rejects unsupported formats instead of returning undefined', () => {
    expect(() => format(data, 'xml' as OutputFormat)).toThrow(
      'Unsupported output format: xml',
    );
  });
});

describe('outputError', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    stderrSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {
        /* swallow */
      });
    process.exitCode = 0;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  function getEmittedBody(): { error: { code: string; message: string } } {
    expect(stderrSpy).toHaveBeenCalledOnce();
    const raw = String(stderrSpy.mock.calls[0]?.[0]);
    return JSON.parse(raw) as { error: { code: string; message: string } };
  }

  it('defaults to code:"ERROR" for plain Error instances', () => {
    outputError(new Error('boom'));
    expect(getEmittedBody().error.code).toBe('ERROR');
    expect(process.exitCode).toBe(1);
  });

  it('preserves a structured `code` field on Error subclasses', () => {
    outputError(new InvalidDocxError('bad zip'));
    const body = getEmittedBody();
    expect(body.error.code).toBe('INVALID_DOCX');
    expect(body.error.message).toBe('bad zip');
    expect(process.exitCode).toBe(1);
  });

  it('falls back to "ERROR" when the code field is non-string', () => {
    class NumericCodeError extends Error {
      readonly code = 42;
    }
    outputError(new NumericCodeError('numeric'));
    expect(getEmittedBody().error.code).toBe('ERROR');
  });

  it('stringifies non-Error throwables', () => {
    outputError('plain string failure');
    expect(getEmittedBody().error.message).toBe('plain string failure');
    expect(process.exitCode).toBe(1);
  });

  it('exits 2 for a system error', () => {
    outputError(new SystemError('NETWORK_ERROR', 'fetch failed'));
    const body = getEmittedBody();
    expect(body.error.code).toBe('NETWORK_ERROR');
    expect(process.exitCode).toBe(2);
  });

  it('exits 2 for an auth failure surfaced by httpError', () => {
    outputError(httpError(401));
    expect(getEmittedBody().error.code).toBe('AUTH_ERROR');
    expect(process.exitCode).toBe(2);
  });

  it('still exits 1 for a 404, which is a user error', () => {
    outputError(httpError(404));
    expect(getEmittedBody().error.code).toBe('ERROR');
    expect(process.exitCode).toBe(1);
  });
});

describe('output', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* swallow */
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('prints the body', () => {
    output({ a: 1 }, 'json');
    expect(stdoutSpy).toHaveBeenCalledOnce();
    expect(String(stdoutSpy.mock.calls[0]?.[0])).toBe('{\n  "a": 1\n}');
  });

  it('honors the requested format', () => {
    output([{ a: 1 }], 'csv');
    expect(String(stdoutSpy.mock.calls[0]?.[0])).toBe('a\n1');
  });
});

// Regression guard for #660. Asserting on `output`/`outputError` directly
// cannot catch this regression: after the signature change they take no
// `quiet` argument, so a unit call always prints. The bug lived at the
// command call sites, which read `--quiet` off the parsed global options —
// so the guard has to drive a real command through commander with the flag
// set and watch what reaches stdout/stderr. Reintroducing suppression at
// any of these call sites fails these tests.
describe('--quiet does not suppress the body or the error envelope', () => {
  const ENV_KEYS = [
    'WAFFLEBASE_CONFIG',
    'WAFFLEBASE_API_KEY',
    'WAFFLEBASE_SERVER',
    'WAFFLEBASE_WORKSPACE',
  ] as const;

  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let savedEnv: Record<string, string | undefined>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    // Point at a config path that cannot exist so the resolved config comes
    // purely from these env vars — no developer's ~/.wafflebase leaks in.
    process.env.WAFFLEBASE_CONFIG = '/nonexistent/wafflebase-test.yaml';
    process.env.WAFFLEBASE_API_KEY = 'wfb_test';
    process.env.WAFFLEBASE_SERVER = 'https://api.test';
    process.env.WAFFLEBASE_WORKSPACE = 'ws-1';

    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* swallow */
    });
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow */
    });
    process.exitCode = 0;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.unstubAllGlobals();
    process.exitCode = originalExitCode;
  });

  function stubFetch(status: number, data: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function buildProgram(): Command {
    const program = createProgram();
    registerDocsCommand(program);
    registerSheetsCommand(program);
    return program;
  }

  async function run(...argv: string[]): Promise<void> {
    await buildProgram().parseAsync(['node', 'wafflebase', ...argv]);
  }

  it('prints the result body for `docs list --quiet`', async () => {
    stubFetch(200, [{ id: 'doc-1', title: 'Doc' }]);
    await run('docs', 'list', '--quiet');
    expect(stdoutSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(stdoutSpy.mock.calls[0]?.[0]))).toEqual([
      { id: 'doc-1', title: 'Doc' },
    ]);
    expect(process.exitCode).toBe(0);
  });

  it('prints the result body for `sheets cells get --quiet`', async () => {
    stubFetch(200, { A1: { value: '1' } });
    await run('sheets', 'cells', 'get', 'doc-1', 'A1', '--quiet');
    expect(stdoutSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(stdoutSpy.mock.calls[0]?.[0]))).toEqual({
      A1: { value: '1' },
    });
  });

  it('respects --format while quiet (body is the redirected data)', async () => {
    stubFetch(200, [{ id: 'doc-1', title: 'Doc' }]);
    await run('docs', 'list', '--quiet', '--format', 'csv');
    expect(String(stdoutSpy.mock.calls[0]?.[0])).toBe('id,title\ndoc-1,Doc');
  });

  it('prints the error envelope on stderr and fails under --quiet', async () => {
    // `--quiet` gates neither the envelope nor the classification: a 5xx
    // is a server fault, so it exits 2 with `SERVER_ERROR` here exactly
    // as it would without the flag.
    stubFetch(500, null);
    await run('docs', 'get', 'doc-1', '--quiet');
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(String(stderrSpy.mock.calls[0]?.[0])) as {
      error: { code: string; message: string };
    };
    expect(body.error).toEqual({ code: 'SERVER_ERROR', message: 'HTTP 500' });
    expect(process.exitCode).toBe(2);
  });

  // `sheets cells batch` parses its input before it talks to the server; that
  // parse used to sit outside the try, so malformed JSON skipped the envelope
  // entirely and left the exit code at 0.
  it('envelopes malformed `sheets cells batch --data` JSON', async () => {
    const fetchMock = stubFetch(200, {});
    await run('sheets', 'cells', 'batch', 'doc-1', '--data', '{', '--quiet');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(String(stderrSpy.mock.calls[0]?.[0])) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('ERROR');
    expect(process.exitCode).toBe(1);
  });
});

// The guards above drive `parseAsync` directly, so they only describe the
// shipped behavior if the entrypoint awaits the action promises too. These
// exercise the entrypoint itself (`runCli`, which `src/bin.ts` is a one-line
// delegate to — see test/bin.test.ts) with an action that rejects after a
// microtask, i.e. the case no command handled itself. Under the synchronous
// `parse()` commander drops the action promise, so the rejection escapes the
// entrypoint's catch: nothing reaches stderr, the exit code stays 0, and the
// first test below fails.
describe('runCli entrypoint', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* swallow */
    });
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow */
    });
    process.exitCode = 0;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  class LateFailure extends Error {
    readonly code = 'LATE_FAILURE';
  }

  /** A program whose only action rejects asynchronously, outside any try. */
  function programWithRejectingAction(): Command {
    const program = createProgram();
    program.command('boom').action(async () => {
      await Promise.resolve();
      throw new LateFailure('kaboom');
    });
    return program;
  }

  it('envelopes an action rejection no command handled itself', async () => {
    await expect(
      runCli(programWithRejectingAction(), ['node', 'wafflebase', 'boom']),
    ).resolves.toBeUndefined();

    expect(stderrSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(String(stderrSpy.mock.calls[0]?.[0])) as {
      error: { code: string; message: string };
    };
    expect(body.error).toEqual({ code: 'LATE_FAILURE', message: 'kaboom' });
    expect(process.exitCode).toBe(1);
  });

  it('leaves a successful run untouched', async () => {
    const program = createProgram();
    program.command('ok').action(async () => {
      await Promise.resolve();
      output({ ok: true }, 'json');
    });

    await runCli(program, ['node', 'wafflebase', 'ok']);

    expect(stderrSpy).not.toHaveBeenCalled();
    expect(String(stdoutSpy.mock.calls[0]?.[0])).toBe('{\n  "ok": true\n}');
    expect(process.exitCode).toBe(0);
  });

  // Regression guard for #654. Commander exits during parsing, before any
  // action handler runs, so its own failures used to print bare prose
  // ("error: missing required argument 'doc-id'") and skip the documented
  // envelope entirely — the one error an agent driver is most likely to hit
  // was the one it could not parse. These drive the entrypoint with the
  // issue's four reproductions and assert both halves: the envelope is on
  // stderr, and commander's prose is not.
  describe('commander parse failures', () => {
    let writtenOut: string[];
    let writtenErr: string[];

    beforeEach(() => {
      writtenOut = [];
      writtenErr = [];
    });

    async function runArgv(...argv: string[]): Promise<void> {
      const program = buildProgram();
      // Children share the root's output-configuration object by reference,
      // so this captures every stream write the whole tree makes.
      program.configureOutput({
        writeOut: (s) => void writtenOut.push(s),
        writeErr: (s) => void writtenErr.push(s),
      });
      await runCli(program, ['node', 'wafflebase', ...argv]);
    }

    function envelope(): { error: { code: string; message: string } } {
      expect(stderrSpy).toHaveBeenCalledOnce();
      return JSON.parse(String(stderrSpy.mock.calls[0]?.[0])) as {
        error: { code: string; message: string };
      };
    }

    it('envelopes a missing required argument', async () => {
      await runArgv('docs', 'content');

      const body = envelope();
      expect(body.error.code).toBe('USAGE');
      expect(body.error.message).toBe("missing required argument 'doc-id'");
      expect(process.exitCode).toBe(1);
      // Commander's own prose must not reach stderr alongside the envelope.
      expect(writtenErr).toEqual([]);
      expect(writtenOut).toEqual([]);
    });

    it('envelopes an unknown option', async () => {
      await runArgv('docs', 'content', '--bogus-flag');

      const body = envelope();
      expect(body.error.code).toBe('USAGE');
      expect(body.error.message).toContain("unknown option '--bogus-flag'");
      expect(process.exitCode).toBe(1);
      expect(writtenErr).toEqual([]);
    });

    it('envelopes an unknown command', async () => {
      await runArgv('sheets', 'get');

      const body = envelope();
      expect(body.error.code).toBe('USAGE');
      expect(body.error.message).toContain("unknown command 'get'");
      expect(process.exitCode).toBe(1);
      expect(writtenErr).toEqual([]);
    });

    it('envelopes a missing argument on a binary-output command', async () => {
      await runArgv('docs', 'export');

      const body = envelope();
      expect(body.error.code).toBe('USAGE');
      expect(body.error.message).toBe("missing required argument 'doc-id'");
      expect(process.exitCode).toBe(1);
    });

    // `--version`/`--help` exit through the same CommanderError path. They
    // have already written their body, so enveloping them would report
    // `wafflebase --help` as a USAGE failure.
    it('leaves --version as stdout output with exit 0', async () => {
      await runArgv('--version');

      expect(stderrSpy).not.toHaveBeenCalled();
      expect(writtenOut.join('')).toMatch(/\d+\.\d+\.\d+/);
      expect(process.exitCode).toBe(0);
    });

    it('leaves --help as stdout output with exit 0', async () => {
      await runArgv('--help');

      expect(stderrSpy).not.toHaveBeenCalled();
      expect(writtenOut.join('')).toContain('Usage: wafflebase');
      expect(process.exitCode).toBe(0);
    });

    it('keeps bare `wafflebase` printing usage to stderr with exit 1', async () => {
      await runArgv();

      expect(stderrSpy).not.toHaveBeenCalled();
      expect(writtenErr.join('')).toContain('Usage: wafflebase');
      expect(process.exitCode).toBe(1);
    });
  });

  it('wires every namespace onto the default program', () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining([
        'login',
        'logout',
        'status',
        'ctx',
        'docs',
        'sheets',
        'slides',
        'notes',
        'api-keys',
        'schema',
      ]),
    );
  });
});
