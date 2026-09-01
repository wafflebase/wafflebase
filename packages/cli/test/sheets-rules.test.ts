import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { createProgram } from '../src/commands/root.js';
import { registerSheetsRulesCommand } from '../src/commands/sheets-rules.js';

/**
 * Drives the REAL commands through commander rather than a stand-in, because
 * the behaviours worth guarding here — which client method each subcommand
 * reaches for, where the payload-shape check sits relative to the dry-run
 * branch, and where `--format` validation sits relative to the request — live
 * in the action handler's wiring, not in any function it calls.
 */

const getConditionalFormats = vi.fn();
const setConditionalFormats = vi.fn();
const getDataValidations = vi.fn();
const setDataValidations = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    getConditionalFormats = (...a: unknown[]) => getConditionalFormats(...a);
    setConditionalFormats = (...a: unknown[]) => setConditionalFormats(...a);
    getDataValidations = (...a: unknown[]) => getDataValidations(...a);
    setDataValidations = (...a: unknown[]) => setDataValidations(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const DOC_BASE = `${SERVER}/api/v1/workspaces/${WORKSPACE}/documents/doc-1`;

// Engine-shaped rules (`ConditionalFormatRule` / `DataValidationRule` in
// `@wafflebase/sheets`). The CLI treats a rule as opaque JSON — the server
// runs each one through the engine normalizer — but the fixtures are written
// in the real shape so they double as the payload documentation.
const CF_RULE = {
  id: 'cf-1',
  ranges: [
    [
      { r: 1, c: 1 },
      { r: 10, c: 3 },
    ],
  ],
  op: 'greaterThan',
  value: '5',
  style: { bg: '#ff0000' },
};

const DV_RULE = {
  id: 'dv-1',
  ranges: [
    [
      { r: 1, c: 1 },
      { r: 10, c: 1 },
    ],
  ],
  kind: 'list',
  list: ['a', 'b'],
  onInvalid: 'reject',
};

function run(argv: string[]) {
  const program = createProgram();
  // Both groups hang off `sheets` in the real CLI; the parent is irrelevant to
  // these assertions, so mount them on a bare namespace.
  registerSheetsRulesCommand(program.command('sheets'));
  return program.parseAsync(
    [
      '--server',
      SERVER,
      '--workspace',
      WORKSPACE,
      '--api-key',
      'wfb_test',
      ...argv,
    ],
    { from: 'user' },
  );
}

describe('sheets worksheet-rule commands', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    getConditionalFormats.mockReset();
    setConditionalFormats.mockReset();
    getDataValidations.mockReset();
    setDataValidations.mockReset();
    vi.spyOn(console, 'log').mockImplementation((v) => {
      stdout.push(String(v));
    });
    vi.spyOn(console, 'error').mockImplementation((v) => {
      stderr.push(String(v));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  describe('conditional-formats get', () => {
    it('reads the conditional-formats endpoint of the default tab', async () => {
      getConditionalFormats.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rules: [CF_RULE] },
      });

      await run(['sheets', 'conditional-formats', 'get', 'doc-1']);

      expect(getConditionalFormats).toHaveBeenCalledWith('doc-1', 'tab-1');
      expect(JSON.parse(stdout.join('\n'))).toEqual({ rules: [CF_RULE] });
      expect(process.exitCode).toBeUndefined();
    });

    it('targets the tab named by --tab', async () => {
      getConditionalFormats.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rules: [] },
      });

      await run([
        'sheets',
        'conditional-formats',
        'get',
        'doc-1',
        '--tab',
        'tab-7',
      ]);

      expect(getConditionalFormats).toHaveBeenCalledWith('doc-1', 'tab-7');
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['sheets', 'conditional-formats', 'get', 'doc-1', '--dry-run']);

      expect(getConditionalFormats).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${DOC_BASE}/tabs/tab-1/conditional-formats`,
      });
    });

    it('envelopes an upstream failure instead of printing a body', async () => {
      // A non-sheet document comes back 400; the CLI must surface that as the
      // error envelope, not as a success payload.
      getConditionalFormats.mockResolvedValue({
        ok: false,
        status: 400,
        data: {},
      });

      await run(['sheets', 'conditional-formats', 'get', 'doc-1']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });
  });

  describe('conditional-formats set', () => {
    it('PUTs the rule array from --data', async () => {
      setConditionalFormats.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rules: [CF_RULE] },
      });

      await run([
        'sheets',
        'conditional-formats',
        'set',
        'doc-1',
        '--data',
        JSON.stringify([CF_RULE]),
      ]);

      expect(setConditionalFormats).toHaveBeenCalledWith('doc-1', 'tab-1', [
        CF_RULE,
      ]);
      expect(JSON.parse(stdout.join('\n'))).toEqual({ rules: [CF_RULE] });
    });

    it('accepts the { rules } envelope `get` prints, so the two round-trip', async () => {
      setConditionalFormats.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rules: [CF_RULE] },
      });

      await run([
        'sheets',
        'conditional-formats',
        'set',
        'doc-1',
        '--data',
        JSON.stringify({ rules: [CF_RULE] }),
      ]);

      expect(setConditionalFormats).toHaveBeenCalledWith('doc-1', 'tab-1', [
        CF_RULE,
      ]);
    });

    it('sends an empty array as the way to clear every rule', async () => {
      setConditionalFormats.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rules: [] },
      });

      await run([
        'sheets',
        'conditional-formats',
        'set',
        'doc-1',
        '--data',
        '[]',
      ]);

      expect(setConditionalFormats).toHaveBeenCalledWith('doc-1', 'tab-1', []);
    });

    it('prints the wire body without sending it under --dry-run', async () => {
      await run([
        'sheets',
        'conditional-formats',
        'set',
        'doc-1',
        '--tab',
        'tab-2',
        '--data',
        JSON.stringify([CF_RULE]),
        '--dry-run',
      ]);

      expect(setConditionalFormats).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${DOC_BASE}/tabs/tab-2/conditional-formats`,
        body: { rules: [CF_RULE] },
      });
    });

    it('names --data as the source of a malformed payload', async () => {
      await run([
        'sheets',
        'conditional-formats',
        'set',
        'doc-1',
        '--data',
        '{not json',
      ]);

      expect(setConditionalFormats).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const err = JSON.parse(stderr.join('\n')) as {
        error: { message: string; command: string };
      };
      expect(err.error.message).toMatch(/Invalid JSON rule data in --data/);
      expect(err.error.command).toBe('sheets.conditional-formats.set');
    });

    it('rejects a payload that is neither an array nor { rules } — before the dry-run branch', async () => {
      // A dry run whose printed body the server would 400 is worse than no dry
      // run at all: the point of the flag is to show what would happen.
      await run([
        'sheets',
        'conditional-formats',
        'set',
        'doc-1',
        '--data',
        '{"conditionalFormats":[]}',
        '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(setConditionalFormats).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/expected an array of rules/);
    });

    it('envelopes an upstream rejection of an invalid rule', async () => {
      // The server validates each rule with the engine normalizer and answers
      // 400 for one it cannot normalize.
      setConditionalFormats.mockResolvedValue({
        ok: false,
        status: 400,
        data: {
          error: {
            code: 'BAD_REQUEST',
            message: 'rules[0] is not a valid conditional format rule',
          },
        },
      });

      await run([
        'sheets',
        'conditional-formats',
        'set',
        'doc-1',
        '--data',
        '[{"id":"x"}]',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/not a valid conditional format rule/);
    });
  });

  describe('data-validations', () => {
    it('reads the data-validations endpoint', async () => {
      getDataValidations.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rules: [DV_RULE] },
      });

      await run(['sheets', 'data-validations', 'get', 'doc-1']);

      expect(getDataValidations).toHaveBeenCalledWith('doc-1', 'tab-1');
      expect(JSON.parse(stdout.join('\n'))).toEqual({ rules: [DV_RULE] });
    });

    it('PUTs the rule array from --data', async () => {
      setDataValidations.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rules: [DV_RULE] },
      });

      await run([
        'sheets',
        'data-validations',
        'set',
        'doc-1',
        '--data',
        JSON.stringify({ rules: [DV_RULE] }),
      ]);

      expect(setDataValidations).toHaveBeenCalledWith('doc-1', 'tab-1', [
        DV_RULE,
      ]);
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run([
        'sheets',
        'data-validations',
        'set',
        'doc-1',
        '--data',
        JSON.stringify([DV_RULE]),
        '--dry-run',
      ]);

      expect(setDataValidations).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${DOC_BASE}/tabs/tab-1/data-validations`,
        body: { rules: [DV_RULE] },
      });
    });

    it('envelopes a missing tab instead of printing a body', async () => {
      getDataValidations.mockResolvedValue({
        ok: false,
        status: 404,
        data: {},
      });

      await run([
        'sheets',
        'data-validations',
        'get',
        'doc-1',
        '--tab',
        'nope',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/404/);
    });

    it('answers the singular alias', async () => {
      getDataValidations.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rules: [] },
      });

      await run(['sheets', 'data-validation', 'get', 'doc-1']);

      expect(getDataValidations).toHaveBeenCalledWith('doc-1', 'tab-1');
    });
  });

  // `format()` throws on an unsupported `--format`. If that throw fires after
  // the request, a completed write reports exit 1 / INVALID_FORMAT with the
  // server's response discarded — so the guard has to run first, for the same
  // reason the payload-shape check precedes the dry-run branch.
  describe('--format validation ordering', () => {
    it('rejects a bad --format before reading the rules', async () => {
      await run([
        'sheets',
        'conditional-formats',
        'get',
        'doc-1',
        '--format',
        'bogus',
      ]);

      expect(getConditionalFormats).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('rejects a bad --format before replacing the rules', async () => {
      await run([
        'sheets',
        'data-validations',
        'set',
        'doc-1',
        '--data',
        JSON.stringify([DV_RULE]),
        '--format',
        'bogus',
      ]);

      expect(setDataValidations).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('previews under --dry-run regardless of --format', async () => {
      // A dry run sends nothing, so an unsupported `--format` must not stop it
      // — the branch runs ahead of the format guard by design.
      await run([
        'sheets',
        'conditional-formats',
        'get',
        'doc-1',
        '--dry-run',
        '--format',
        'bogus',
      ]);

      expect(JSON.parse(stdout.join('\n'))).toMatchObject({ dry_run: true });
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('identifier encoding', () => {
    it('refuses a dot-segment tab id as an error envelope, not a rejected promise', async () => {
      await expect(
        run([
          'sheets',
          'conditional-formats',
          'set',
          'doc-1',
          '--tab',
          '..',
          '--data',
          '[]',
          '--dry-run',
        ]),
      ).resolves.toBeDefined();

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/Invalid path segment/);
    });
  });
});

describe('worksheet-rule command registration', () => {
  it('mounts both groups with get/set and singular aliases', () => {
    const sheets = new Command('sheets');
    registerSheetsRulesCommand(sheets);

    const cf = sheets.commands.find((c) => c.name() === 'conditional-formats');
    const dv = sheets.commands.find((c) => c.name() === 'data-validations');

    expect(cf?.aliases()).toContain('conditional-format');
    expect(dv?.aliases()).toContain('data-validation');
    expect(cf?.commands.map((c) => c.name()).sort()).toEqual(['get', 'set']);
    expect(dv?.commands.map((c) => c.name()).sort()).toEqual(['get', 'set']);
  });
});
