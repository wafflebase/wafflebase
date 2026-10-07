import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  CLI_SKILLS_DIR,
  PLUGIN_DIR,
  PLUGIN_REFERENCES,
  generatePluginFiles,
  listCliSkillFiles,
} from '../src/plugin/build.js';
import {
  UnclassifiedCommandError,
  buildSafetyTable,
  type SafetyTable,
} from '../src/plugin/safety-table.js';
import { buildProgram } from '../src/cli.js';
// Plain ESM shipped in the plugin, exercised here because the plugin has
// no test runner of its own.
import * as guard from '../../../plugins/wafflebase/hooks/guard-lib.mjs';
import * as session from '../../../plugins/wafflebase/hooks/session-lib.mjs';

const table = buildSafetyTable(buildProgram(), '0.6.12') as SafetyTable;

describe('plugin generated files', () => {
  // The plugin restates facts the CLI owns. If this fails, run
  // `pnpm cli build:plugin` and commit the result.
  it.each([...generatePluginFiles()])('%s is up to date', (rel, content) => {
    let committed: string;
    try {
      committed = readFileSync(join(PLUGIN_DIR, rel), 'utf8');
    } catch {
      committed = '<missing>';
    }
    expect(committed, `stale: run \`pnpm cli build:plugin\``).toBe(content);
  });

  it('maps every CLI skill to exactly one plugin skill', () => {
    const mapped = Object.values(PLUGIN_REFERENCES).flat();
    expect([...mapped].sort()).toEqual(listCliSkillFiles());
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it('copies references byte for byte', () => {
    const [skill, refs] = Object.entries(PLUGIN_REFERENCES)[0];
    const files = generatePluginFiles();
    expect(files.get(join('skills', skill, 'references', refs[0]))).toBe(
      readFileSync(join(CLI_SKILLS_DIR, refs[0]), 'utf8'),
    );
  });
});

describe('buildSafetyTable', () => {
  it('refuses a leaf command the schema registry does not classify', () => {
    const program = new Command('wafflebase');
    program.command('frobnicate').action(() => {});
    expect(() => buildSafetyTable(program, '0')).toThrow(
      UnclassifiedCommandError,
    );
  });

  it('classifies every alias commander accepts', () => {
    const docs = table.root.children!.docs;
    expect(docs.aliases).toEqual(['doc', 'document', 'documents']);
    expect(docs.children!.delete.safety).toBe('destructive');
  });

  it('turns "--flag given" variants into flag rules and keeps the rest as conditions', () => {
    const docs = table.root.children!.docs.children!;
    expect(docs.import.flagSafety).toEqual({ '--replace': 'destructive' });
    const colStyles = table.root.children!.sheets.children!['column-styles'];
    expect(colStyles.children!.set.conditional).toEqual([
      { when: 'a value is null', safety: 'destructive' },
    ]);
  });

  it('marks local output paths on read-only commands only', () => {
    const docs = table.root.children!.docs.children!;
    expect(docs.export.localOutputArg).toBe(1);
    expect(docs.content.localOutputOptions).toEqual(['--out']);
    // `import <file>` names an input, and imports already ask.
    expect(docs.import.localOutputArg).toBeUndefined();
  });
});

type Decision = { decision: 'allow' | 'ask'; reason: string } | null;
const decide = (cmd: string, opts?: { autoApproveWrites?: boolean }) =>
  guard.decide(cmd, table, opts) as Decision;

describe('guard.decide', () => {
  it.each([
    'wafflebase docs list',
    'wafflebase --format json doc list',
    'wafflebase --workspace=ws-1 sheets cells get d A1:C3 --tab tab-2',
    'wafflebase docs content d --format md --out -',
    'wafflebase schema docs.content',
    'wafflebase --help',
    'wafflebase --version',
    'wafflebase sheets',
    'wafflebase help docs',
    'wafflebase help docs delete',
    "wafflebase docs content d --format 'md'",
  ])('allows the plain read %s', (cmd) => {
    expect(decide(cmd)?.decision).toBe('allow');
  });

  it.each([
    ['wafflebase sheets cells set d A1 5', 'write'],
    ['wafflebase docs import a.docx', 'write'],
    ['wafflebase docs delete d', 'destructive'],
    ['wafflebase docs import a.docx --replace d1', 'destructive'],
    ['wafflebase docs import a.docx --replace=d1', 'destructive'],
    ['wafflebase sheets column-styles set d --data "{}"', 'destructive'],
    ['wafflebase notes set-content d', 'destructive'],
  ])('asks on %s (%s)', (cmd, level) => {
    const d = decide(cmd);
    expect(d?.decision).toBe('ask');
    expect(d?.reason).toContain(`is ${level}`);
  });

  it('asks before a read writes a local file', () => {
    for (const cmd of [
      'wafflebase docs export d out.pdf',
      'wafflebase docs content d --out notes.md',
      'wafflebase files download d',
    ]) {
      const d = decide(cmd, { autoApproveWrites: true });
      expect(d?.decision, cmd).toBe('ask');
      expect(d?.reason, cmd).toContain('on this machine');
    }
  });

  it('auto-approves plain writes only when opted in, never destructive ones', () => {
    const write = 'wafflebase sheets cells set d A1 5';
    expect(decide(write, { autoApproveWrites: true })?.decision).toBe('allow');
    expect(
      decide('wafflebase docs delete d', { autoApproveWrites: true })?.decision,
    ).toBe('ask');
    expect(
      decide(`cd x && ${write}`, { autoApproveWrites: true })?.decision,
    ).toBe('ask');
  });

  it('asks on unknown wafflebase commands', () => {
    const d = decide('wafflebase frobnicate now');
    expect(d?.decision).toBe('ask');
    expect(d?.reason).toContain('not in the Wafflebase plugin');
  });

  it('never auto-allows a composed command, and still asks for its writes', () => {
    expect(decide('wafflebase docs list | jq .')).toBeNull();
    expect(decide('wafflebase docs list > list.json')).toBeNull();
    expect(decide('wafflebase docs list && wafflebase docs delete x')?.decision).toBe('ask');
    expect(decide('true; wafflebase docs delete x')?.decision).toBe('ask');
    expect(decide('echo "$(wafflebase docs delete x)"')?.decision).toBe('ask');
    expect(decide('echo `wafflebase docs delete x`')?.decision).toBe('ask');
  });

  it('does not auto-allow an invocation that may not be the installed CLI', () => {
    expect(decide('./wafflebase docs list')).toBeNull();
    expect(decide('PATH=/tmp wafflebase docs list')).toBeNull();
    expect(decide('PATH=/tmp wafflebase docs delete x')?.decision).toBe('ask');
  });

  // Self-review round 1: each of these was auto-allowed by the first
  // version of the guard, because it believed a token the shell rewrites.
  it.each([
    // The shell drops a comment; the guard used to read `--help` in it.
    ['wafflebase docs delete abc # --help', 'is destructive'],
    ['wafflebase files delete f # -V', 'is destructive'],
    // Inside "…", `\-` keeps its backslash, so commander sees `\--help`,
    // a positional — the rename runs.
    ['wafflebase docs rename D "\\--help"', 'is write'],
    // Brace / glob expansion can produce `--out=…` after the guard looked.
    ['wafflebase docs content {D,--out=.zshrc,--force}', 'shell expands'],
    ['wafflebase docs content D ?-out=x', 'shell expands'],
    ['wafflebase docs content D ~/x', 'shell expands'],
    // Help flags no longer short-circuit at all.
    ['wafflebase docs delete x --help', 'is destructive'],
  ])('asks on %s', (cmd, why) => {
    const d = decide(cmd, { autoApproveWrites: true });
    expect(d?.decision).toBe('ask');
    expect(d?.reason).toContain(why);
  });

  it('classifies wrapped invocations instead of ignoring them', () => {
    for (const cmd of [
      'time wafflebase docs delete x',
      'env FOO=1 wafflebase docs delete x',
      'nice -n 5 wafflebase docs delete x',
      'xargs wafflebase docs delete',
      'npx @wafflebase/cli docs delete x',
      'pnpm exec wafflebase docs delete x',
    ]) {
      expect(decide(cmd)?.decision, cmd).toBe('ask');
    }
    // …and never auto-allows them, even when read-only.
    expect(decide('time wafflebase docs list')).toBeNull();
  });

  it('asks when a wafflebase call hides in a substitution beside one it can see', () => {
    expect(
      decide('wafflebase docs list && echo $(wafflebase docs delete x)')?.decision,
    ).toBe('ask');
    expect(decide('echo $(/usr/local/bin/wafflebase docs delete x)')?.decision).toBe('ask');
  });

  it('treats `--` and consumed option values as the CLI does', () => {
    // After `--`, `--out` is a positional (and an excess one commander rejects).
    expect(decide('wafflebase docs content d -- --out x')?.decision).toBe('allow');
    // `--format` consumes `--help` as its value: no help shortcut either way.
    expect(decide('wafflebase --format --help docs delete x')?.decision).toBe('ask');
    expect(decide('wafflebase docs export d -')?.decision).toBe('allow');
  });

  it('leaves other commands to the user', () => {
    expect(decide('ls -la')).toBeNull();
    expect(decide('git commit -m "update wafflebase docs"')).toBeNull();
    expect(decide("echo 'wafflebase docs delete x'")).toBeNull();
    // The repository path contains the name; that is not an invocation.
    expect(decide('cd /src/wafflebase/waffledocs && git status')).toBeNull();
    expect(decide('wafflebase docs list # what is here')).toBeNull();
  });
});

describe('session context', () => {
  it.each([
    ['https://api.wafflebase.io', undefined, 'https://wafflebase.io'],
    ['http://localhost:3000', undefined, 'http://localhost:5173'],
    ['https://office.example.com', undefined, 'https://office.example.com'],
    ['https://api.example.com', 'https://docs.example.com/', 'https://docs.example.com'],
    [undefined, undefined, null],
  ])('webOrigin(%s, %s) = %s', (server, override, expected) => {
    expect(session.webOrigin(server, override)).toBe(expected);
  });

  it('tells Claude to have the user install the CLI when it is missing', () => {
    const ctx = session.buildContext({
      cliVersion: null,
      status: null,
      tableVersion: '0.6.12',
    });
    expect(ctx).toContain('npm install -g @wafflebase/cli');
    expect(ctx).toContain('Do not install it yourself');
  });

  it('reports the login, workspace and link origin', () => {
    const ctx = session.buildContext({
      cliVersion: '0.6.12',
      status: {
        loggedIn: true,
        user: 'ada',
        server: 'https://api.wafflebase.io',
        workspaceId: 'ws-1',
        workspaceName: 'Team',
        session: 'valid',
      },
      tableVersion: '0.6.12',
    });
    expect(ctx).toContain('Logged in as ada');
    expect(ctx).toContain('Team (ws-1)');
    expect(ctx).toContain('https://wafflebase.io/<route>/<id>');
    expect(ctx).not.toContain('permission table was generated');
  });

  it('does not call an API-key setup logged out', () => {
    const ctx = session.buildContext({
      cliVersion: '0.6.12',
      status: { loggedIn: false },
      tableVersion: '0.6.12',
      apiKeyInEnv: true,
      envServer: 'https://api.example.com',
    });
    expect(ctx).toContain('WAFFLEBASE_API_KEY');
    expect(ctx).not.toContain('No login session');
    expect(ctx).toContain('https://example.com/<route>/<id>');
  });

  it('follows the CLI: an env API key beats a session, env server/workspace override it', () => {
    const loggedIn = {
      loggedIn: true,
      user: 'ada',
      server: 'https://api.wafflebase.io',
      workspaceId: 'ws-1',
      workspaceName: 'Team',
      session: 'valid',
    };
    const withKey = session.buildContext({
      cliVersion: '0.6.12',
      status: loggedIn,
      tableVersion: '0.6.12',
      apiKeyInEnv: true,
    });
    expect(withKey).toContain('overrides the saved login session');
    expect(withKey).not.toContain('Logged in as ada');

    const overridden = session.buildContext({
      cliVersion: '0.6.12',
      status: loggedIn,
      tableVersion: '0.6.12',
      envServer: 'https://api.example.com',
      envWorkspace: 'ws-9',
    });
    expect(overridden).toContain('on https://api.example.com, workspace ws-9');
    expect(overridden).toContain('https://example.com/<route>/<id>');
  });

  it('warns when the CLI and the guard table disagree on major.minor', () => {
    const ctx = session.buildContext({
      cliVersion: '0.7.0',
      status: { loggedIn: false },
      tableVersion: '0.6.12',
    });
    expect(ctx).toContain('generated for CLI 0.6.12');
    expect(ctx).toContain('wafflebase login');
  });
});
