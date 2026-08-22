import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Command } from 'commander';
import { formatJson } from '../src/output/json.js';
import { formatTable } from '../src/output/table.js';
import { formatCsv } from '../src/output/csv.js';
import { formatYaml } from '../src/output/yaml.js';
import {
  commandPath,
  errorEnvelope,
  format,
  output,
  outputError,
  parseOutputFormat,
  upstreamErrorJson,
  InvalidFormatError,
  type OutputFormat,
} from '../src/output/formatter.js';
import { SystemError, httpError } from '../src/errors.js';
import { InvalidDocxError } from '../src/docs/docx-import.js';
import { buildProgram, runCli } from '../src/cli.js';
import { createProgram } from '../src/commands/root.js';
import { registerDocsCommand } from '../src/commands/docs.js';
import { registerSheetsCommand } from '../src/commands/sheets.js';
import { registerSchemaCommand } from '../src/commands/schema.js';

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

  it('JSON-serializes a nested value in a row, not just in a record', () => {
    const lines = formatTable([{ id: '1', meta: { x: 1 } }]).split('\n');
    expect(lines[2]).toContain('{"x":1}');
    expect(lines[2]).not.toContain('[object Object]');
  });

  it('formats a single object as a key/value table', () => {
    const result = formatTable({ loggedIn: true, user: 'hackerwins' });
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^loggedIn\s+true$/);
    expect(lines[1]).toMatch(/^user\s+hackerwins$/);
  });

  it('returns no results for an object with no fields', () => {
    expect(formatTable({})).toBe('(no results)');
  });

  it('returns no results for scalars', () => {
    expect(formatTable('nope')).toBe('(no results)');
    expect(formatTable(null)).toBe('(no results)');
  });
});

describe('parseOutputFormat', () => {
  it('accepts the supported formats', () => {
    expect(parseOutputFormat('json')).toBe('json');
    expect(parseOutputFormat('table')).toBe('table');
    expect(parseOutputFormat('csv')).toBe('csv');
  });

  it('rejects an unsupported format with a structured code', () => {
    expect(() => parseOutputFormat('bogus')).toThrow(InvalidFormatError);
    try {
      parseOutputFormat('bogus');
    } catch (e) {
      expect((e as InvalidFormatError).code).toBe('INVALID_FORMAT');
      expect((e as Error).message).toContain('json, table, csv');
    }
  });
});

describe('formatCsv', () => {
  it('formats array of objects as CSV', () => {
    const data = [
      { name: 'Alice', score: 95 },
      { name: 'Bob', score: 87 },
    ];
    const result = formatCsv(data, { neutralizeFormulas: true });
    const lines = result.split('\n');
    expect(lines[0]).toBe('name,score');
    expect(lines[1]).toBe('Alice,95');
    expect(lines[2]).toBe('Bob,87');
  });

  it('escapes commas and quotes', () => {
    const data = [{ value: 'has, comma' }, { value: 'has "quotes"' }];
    const result = formatCsv(data, { neutralizeFormulas: true });
    const lines = result.split('\n');
    expect(lines[1]).toBe('"has, comma"');
    expect(lines[2]).toBe('"has ""quotes"""');
  });

  it('returns empty string for empty array', () => {
    expect(formatCsv([], { neutralizeFormulas: true })).toBe('');
  });

  it('formats a single object as one-row CSV', () => {
    const result = formatCsv({ id: '1', title: 'Doc' }, { neutralizeFormulas: true });
    const lines = result.split('\n');
    expect(lines[0]).toBe('id,title');
    expect(lines[1]).toBe('1,Doc');
  });

  it('serializes nested objects as JSON', () => {
    const data = [{ name: 'a', meta: { x: 1 } }];
    const result = formatCsv(data, { neutralizeFormulas: true });
    const lines = result.split('\n');
    // JSON is CSV-escaped: {"x":1} → "{""x"":1}"
    expect(lines[1]).toBe('a,"{""x"":1}"');
  });

  // Every value here is server-supplied and settable by another
  // workspace member, so a formula prefix must land as text rather than
  // execute when the export is opened in a spreadsheet app.
  it('neutralizes spreadsheet formula prefixes', () => {
    const data = [
      { v: '=HYPERLINK("http://evil","click")' },
      { v: '+1+1' },
      { v: '-1+1' },
      { v: '@SUM(A1)' },
      { v: '\t=cmd' },
      { v: '\r=cmd' },
    ];
    const lines = formatCsv(data, { neutralizeFormulas: true }).split('\n');
    expect(lines[1]).toBe('"\'=HYPERLINK(""http://evil"",""click"")"');
    expect(lines[2]).toBe("'+1+1");
    expect(lines[3]).toBe("'-1+1");
    expect(lines[4]).toBe("'@SUM(A1)");
    // Quoted, not bare: a control character inside an unquoted field
    // would let the importer end the record early (see below).
    expect(lines[5]).toBe('"\'\t=cmd"');
    expect(lines[6]).toBe('"\'\r=cmd"');
  });

  // A bare CR terminates a record in importers that honour classic-Mac
  // line endings, so an unquoted `\r` lets a value smuggle a whole new
  // row past the neutralizer: only the *start* of the value is
  // inspected, and after the split the payload sits at column 0.
  it('quotes control characters so a value cannot forge a new record', () => {
    const data = [{ v: 'ok\r=cmd|/C calc!A0' }, { v: 'a\tb' }];
    const lines = formatCsv(data, { neutralizeFormulas: true }).split('\n');
    expect(lines[1]).toBe('"ok\r=cmd|/C calc!A0"');
    expect(lines[2]).toBe('"a\tb"');
  });

  it('neutralizes a formula in a header key too', () => {
    expect(formatCsv([{ '=evil()': 1 }], { neutralizeFormulas: true }).split('\n')[0]).toBe("'=evil()");
  });

  it('leaves plain signed numbers untouched', () => {
    const data = [{ v: -3 }, { v: '+1.5' }, { v: '-2e10' }, { v: '.5' }];
    const lines = formatCsv(data, { neutralizeFormulas: true }).split('\n');
    expect(lines.slice(1)).toEqual(['-3', '+1.5', '-2e10', '.5']);
  });

  // A plain leading space hides a formula just as a tab does: importers
  // that trim on the way in (LibreOffice's "Trim spaces", and several
  // CSV-to-sheet tools) strip it and evaluate what is left. Nothing else
  // catches it — a leading space is not quoted either.
  it('neutralizes a formula hidden behind leading whitespace', () => {
    const data = [
      { v: ' =HYPERLINK("http://evil","x")' },
      { v: ' =cmd' },
      { v: '\ufeff@SUM(A1)' },
    ];
    const lines = formatCsv(data, { neutralizeFormulas: true }).split('\n');
    expect(lines[1]).toBe('"\' =HYPERLINK(""http://evil"",""x"")"');
    expect(lines[2]).toBe("' =cmd");
    expect(lines[3]).toBe("'\ufeff@SUM(A1)");
  });

  it('leaves a padded plain number and ordinary padded text alone', () => {
    const data = [{ v: ' -3' }, { v: ' hello' }];
    const lines = formatCsv(data, { neutralizeFormulas: true }).split('\n');
    expect(lines.slice(1)).toEqual([' -3', ' hello']);
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

  it('throws instead of printing "undefined" for an unknown format', () => {
    expect(() => format(data, 'xml' as OutputFormat)).toThrow(
      InvalidFormatError,
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

  function getEmittedBody(): {
    error: { code: string; message: string; command?: string };
  } {
    expect(stderrSpy).toHaveBeenCalledOnce();
    const raw = String(stderrSpy.mock.calls[0]?.[0]);
    // The documented envelope is one line on stderr, so a caller can read it
    // with a line-delimited parser and tell two errors apart (#661).
    expect(raw).not.toContain('\n');
    return JSON.parse(raw) as {
      error: { code: string; message: string; command?: string };
    };
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

  it('omits `command` when no command is known', () => {
    outputError(new Error('boom'));
    expect(getEmittedBody().error).not.toHaveProperty('command');
  });

  it('reports the dotted command name of a nested command', () => {
    const program = createProgram();
    const nested = program.command('sheets').command('cells').command('get');
    outputError(new Error('boom'), nested);
    expect(getEmittedBody().error.command).toBe('sheets.cells.get');
  });

  // Reaching the command *through* the alias is the point: commander hands
  // the action the same `Command` object either way, so a test that calls
  // `outputError` with the canonical object asserts nothing about aliases.
  // This one parses `doc content` — the alias — and reads what the action
  // actually emitted.
  it('reports the canonical name when the command was reached by alias', async () => {
    const program = createProgram();
    program
      .command('docs')
      .alias('doc')
      .command('content')
      .action(function (this: Command) {
        outputError(new Error('boom'), this);
      });

    await program.parseAsync(['node', 'wafflebase', 'doc', 'content']);

    expect(getEmittedBody().error.command).toBe('docs.content');
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

// #661: `outputError` is not the only emitter. The import / upload /
// download orchestrators own their own IO seam and exit code, and `schema`
// reports a miss without throwing — they all have to produce the same
// one-line, attributed envelope, so they share these builders.
describe('errorEnvelope', () => {
  it('emits one line carrying the command', () => {
    const line = errorEnvelope('CONFIRMATION_REQ', 'Pass --yes.', 'docs.import');
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      error: {
        code: 'CONFIRMATION_REQ',
        message: 'Pass --yes.',
        command: 'docs.import',
      },
    });
  });

  it('omits `command` when the caller has none', () => {
    expect(JSON.parse(errorEnvelope('ERROR', 'boom')).error).not.toHaveProperty(
      'command',
    );
  });
});

// The orchestrators' shared emitter. It answers the same question
// `forwardUpstreamError` does for the throwing commands, so the two must
// agree line for line — attribution included.
describe('upstreamErrorJson', () => {
  it('keeps a backend `code` and extra context so agents can branch on it', () => {
    const line = upstreamErrorJson(
      {
        status: 400,
        data: {
          error: { code: 'TYPE_MISMATCH', message: 'not a doc', type: 'sheet' },
        },
      },
      'docs.content',
    );
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      error: {
        code: 'TYPE_MISMATCH',
        message: 'not a doc',
        type: 'sheet',
        command: 'docs.content',
      },
    });
  });

  it('falls back to a status-derived code for a bodyless failure', () => {
    expect(JSON.parse(upstreamErrorJson({ status: 500, data: null }))).toEqual({
      error: { code: 'SERVER_ERROR', message: 'HTTP 500' },
    });
  });

  // The backend has no global exception filter, so most failures arrive in
  // Nest's default shape — the reason at the top level, `error` a bare
  // reason phrase. These paths used to print the body verbatim, so dropping
  // the top-level `message` would silently lose the server's text.
  it("keeps the server's message from Nest's default error shape", () => {
    expect(
      JSON.parse(
        upstreamErrorJson(
          {
            status: 404,
            data: {
              statusCode: 404,
              message: 'Document not found',
              error: 'Not Found',
            },
          },
          'docs.content',
        ),
      ),
    ).toEqual({
      error: {
        code: 'HTTP_ERROR',
        message: 'HTTP 404: Document not found',
        command: 'docs.content',
      },
    });
  });

  it('joins a validation `message` array instead of dropping it', () => {
    expect(
      JSON.parse(
        upstreamErrorJson({
          status: 400,
          data: {
            statusCode: 400,
            message: ['title must be a string', 'title should not be empty'],
            error: 'Bad Request',
          },
        }),
      ).error.message,
    ).toBe('HTTP 400: title must be a string; title should not be empty');
  });

  // A rejected credential reads the same here as it does from `httpError()`:
  // the message an agent sees must not depend on which throw site reported it.
  it('names an auth failure a 403 body left unexplained', () => {
    expect(
      JSON.parse(
        upstreamErrorJson({ status: 403, data: { statusCode: 403 } }),
      ).error,
    ).toEqual({
      code: 'AUTH_ERROR',
      message: 'Authentication failed. Run `wafflebase login`.',
    });
  });

  // Attribution is the CLI's own statement about which command it ran. A
  // server that echoes a `command` must not be able to relabel the failure.
  it('never lets the server dictate `command`', () => {
    const forged = {
      status: 400,
      data: { error: { code: 'X', message: 'y', command: 'sheets.wipe' } },
    };
    expect(JSON.parse(upstreamErrorJson(forged, 'docs.content')).error.command).toBe(
      'docs.content',
    );
    expect(JSON.parse(upstreamErrorJson(forged)).error).not.toHaveProperty(
      'command',
    );
  });
});

describe('commandPath', () => {
  it('excludes the root program', () => {
    const program = createProgram();
    expect(commandPath(program.command('status'))).toBe('status');
    expect(commandPath(program)).toBe('');
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
    const raw = String(stderrSpy.mock.calls[0]?.[0]);
    expect(raw).not.toContain('\n');
    const body = JSON.parse(raw) as {
      error: { code: string; message: string; command?: string };
    };
    expect(body.error).toEqual({
      code: 'SERVER_ERROR',
      message: 'HTTP 500',
      command: 'docs.get',
    });
    expect(process.exitCode).toBe(2);
  });

  // #661: an agent driving several calls needs to know *which* one failed.
  it('attributes the envelope to the command that emitted it', async () => {
    stubFetch(500, null);
    await run('sheets', 'cells', 'get', 'doc-1', 'A1');
    const body = JSON.parse(String(stderrSpy.mock.calls[0]?.[0])) as {
      error: { command?: string };
    };
    expect(body.error.command).toBe('sheets.cells.get');
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

// End-to-end guards for the emitters that never reach `outputError`: the
// backend-error passthrough (`docs content` on a non-doc) and `schema`'s
// lookup miss. Both used to print pretty-printed, unattributed JSON, which
// broke a line-delimited stderr reader (#661).
describe('error envelopes emitted outside `outputError`', () => {
  const ENV_KEYS = [
    'WAFFLEBASE_CONFIG',
    'WAFFLEBASE_API_KEY',
    'WAFFLEBASE_SERVER',
    'WAFFLEBASE_WORKSPACE',
  ] as const;

  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let savedEnv: Record<string, string | undefined>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.WAFFLEBASE_CONFIG = '/nonexistent/wafflebase-test.yaml';
    process.env.WAFFLEBASE_API_KEY = 'wfb_test';
    process.env.WAFFLEBASE_SERVER = 'https://api.test';
    process.env.WAFFLEBASE_WORKSPACE = 'ws-1';
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow */
    });
    vi.spyOn(console, 'log').mockImplementation(() => {
      /* swallow */
    });
    process.exitCode = 0;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.exitCode = originalExitCode;
  });

  function emitted(): { code: string; message: string; command?: string } {
    expect(stderrSpy).toHaveBeenCalledOnce();
    const raw = String(stderrSpy.mock.calls[0]?.[0]);
    expect(raw).not.toContain('\n');
    return (
      JSON.parse(raw) as {
        error: { code: string; message: string; command?: string };
      }
    ).error;
  }

  it('re-emits a backend-shaped error as one attributed line', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: 'TYPE_MISMATCH', message: 'Not a doc document' },
        }),
      }),
    );
    const program = createProgram();
    registerDocsCommand(program);
    await program.parseAsync(['node', 'wafflebase', 'docs', 'content', 'd-1']);

    expect(emitted()).toEqual({
      code: 'TYPE_MISMATCH',
      message: 'Not a doc document',
      command: 'docs.content',
    });
    expect(process.exitCode).toBe(1);
  });

  it('envelopes an unknown `schema` name', async () => {
    const program = createProgram();
    registerSchemaCommand(program);
    await program.parseAsync(['node', 'wafflebase', 'schema', 'bogus.thing']);

    expect(emitted()).toEqual({
      code: 'NOT_FOUND',
      message: 'Unknown command: bogus.thing',
      command: 'schema',
    });
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
      error: { code: string; message: string; command?: string };
    };
    // The command name comes from the `preAction` hook: the root program
    // alone cannot say which subcommand was running when the throw escaped.
    expect(body.error).toEqual({
      code: 'LATE_FAILURE',
      message: 'kaboom',
      command: 'boom',
    });
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
