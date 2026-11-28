import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  chmodSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentConfig,
  agentFilePath,
  getAgentsDir,
  listAgentFiles,
  loadAgentFile,
  saveAgentFile,
  type AgentCredential,
} from '../src/config/agents.js';

const AGENT: AgentCredential = {
  server: 'https://api.example.com',
  workspaceId: 'ws-1',
  botId: 42,
  botName: 'deck-bot',
  apiKey: 'wfb_bot_secret',
  pairedAt: '2026-11-28T00:00:00.000Z',
};

describe('agent file', () => {
  let home: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'wafflebase-agents-'));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('lives under ~/.wafflebase/agents', () => {
    expect(getAgentsDir()).toBe(join(home, '.wafflebase', 'agents'));
    expect(agentFilePath('deck-bot')).toBe(
      join(home, '.wafflebase', 'agents', 'deck-bot.json'),
    );
  });

  it('writes the file 0600 inside a 0700 directory', () => {
    const path = saveAgentFile(AGENT);

    expect(path).toBe(agentFilePath('deck-bot'));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(getAgentsDir()).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(AGENT);
    // Written through a temp file and a rename: nothing is left behind.
    expect(readdirSync(getAgentsDir())).toEqual(['deck-bot.json']);
  });

  it('tightens a directory and file that already exist with looser modes', () => {
    mkdirSync(getAgentsDir(), { recursive: true, mode: 0o755 });
    chmodSync(getAgentsDir(), 0o755);
    writeFileSync(agentFilePath('deck-bot'), '{}', { mode: 0o644 });

    const path = saveAgentFile(AGENT);

    expect(statSync(getAgentsDir()).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('reads back what it wrote', () => {
    saveAgentFile(AGENT);
    expect(loadAgentFile('deck-bot')).toEqual(AGENT);
  });

  it('reports a bot this machine has not paired as AGENT_NOT_PAIRED', () => {
    expect(() => loadAgentFile('deck-bot')).toThrow(
      expect.objectContaining({ code: 'AGENT_NOT_PAIRED' }),
    );
  });

  it('refuses a malformed file', () => {
    mkdirSync(getAgentsDir(), { recursive: true });
    writeFileSync(agentFilePath('deck-bot'), '{"botName":"deck-bot"}');
    expect(() => loadAgentFile('deck-bot')).toThrow(
      expect.objectContaining({ code: 'INVALID_AGENT_FILE' }),
    );
  });

  it('refuses a file whose bot is not the one asked for', () => {
    mkdirSync(getAgentsDir(), { recursive: true });
    writeFileSync(
      agentFilePath('deck-bot'),
      JSON.stringify({ ...AGENT, botName: 'other-bot' }),
    );
    expect(() => loadAgentFile('deck-bot')).toThrow(
      expect.objectContaining({ code: 'INVALID_AGENT_FILE' }),
    );
  });

  // The bot name becomes a file name, so it must not walk out of the dir.
  it.each(['../session', 'a/b', 'Deck', '', 'x'])(
    'refuses the bot name %j',
    (name) => {
      expect(() => agentFilePath(name)).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
    },
  );

  it('lists paired bots without their keys', () => {
    saveAgentFile(AGENT);
    saveAgentFile({ ...AGENT, botId: 7, botName: 'alpha' });
    writeFileSync(join(getAgentsDir(), 'notes.txt'), 'ignored');

    const rows = listAgentFiles();

    expect(rows.map((r) => r.botName)).toEqual(['alpha', 'deck-bot']);
    expect(JSON.stringify(rows)).not.toContain('wfb_bot_secret');
    expect(rows[1]).toEqual({
      botName: 'deck-bot',
      botId: 42,
      workspaceId: 'ws-1',
      server: 'https://api.example.com',
      pairedAt: '2026-11-28T00:00:00.000Z',
    });
  });

  it('lists nothing when no bot is paired', () => {
    expect(listAgentFiles()).toEqual([]);
  });

  it('turns a credential into an api-key config for its own workspace', () => {
    expect(agentConfig(AGENT)).toEqual({
      server: 'https://api.example.com',
      apiKey: 'wfb_bot_secret',
      workspace: 'ws-1',
      authMode: 'api-key',
    });
  });
});
