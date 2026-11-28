import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UserError } from '../errors.js';
import type { CliConfig } from './config.js';

/**
 * A bot's credential on this host, written by `wafflebase agent pair`
 * (docs/design/agent-runner.md § 4).
 *
 * This file is the only place a bot key lives on the host. It is not a CLI
 * profile and not `WAFFLEBASE_API_KEY`: `resolveConfig` puts an env key ahead
 * of the login session, so an exported bot key would silently turn every
 * other command in that shell into the bot. Only `agent` commands read it,
 * and they read nothing else.
 */
export interface AgentCredential {
  server: string;
  workspaceId: string;
  botId: number;
  botName: string;
  apiKey: string;
  pairedAt: string; // ISO 8601
}

/** What `agent list` shows of a credential: everything but the key. */
export type AgentSummary = Omit<AgentCredential, 'apiKey'>;

/**
 * A bot name, as the backend accepts it on create. Checked here too because
 * the name becomes a file name: `../session` must not address the session
 * file next to the agents directory.
 */
export const BOT_NAME = /^[a-z0-9][a-z0-9-]{1,31}$/;

export function assertBotName(name: string): void {
  if (!BOT_NAME.test(name)) {
    throw new UserError(
      'INVALID_ARGUMENT',
      `Invalid bot name "${name}": use 2-32 lowercase letters, digits or ` +
        'hyphens, starting with a letter or digit.',
    );
  }
}

/**
 * `~/.wafflebase/agents`. The CLI has per-file overrides
 * (`WAFFLEBASE_SESSION`, `WAFFLEBASE_CONFIG`) but no home override, so this
 * follows the home directory alone — and deliberately gains no env override
 * of its own: one would let an environment variable choose which bot
 * credential a command sends.
 */
export function getAgentsDir(): string {
  return join(homedir(), '.wafflebase', 'agents');
}

export function agentFilePath(
  botName: string,
  dir: string = getAgentsDir(),
): string {
  assertBotName(botName);
  return join(dir, `${botName}.json`);
}

/**
 * Write the credential owner-only: the directory 0700 and the file 0600,
 * both tightened when they already exist. The file is written to a 0600 temp
 * file and renamed over the old one, so the key is never readable by others
 * for even the moment between a write and a `chmod`. Returns the path.
 */
export function saveAgentFile(
  agent: AgentCredential,
  dir: string = getAgentsDir(),
): string {
  const path = agentFilePath(agent.botName, dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(agent, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return path;
}

function isCredential(value: unknown): value is AgentCredential {
  const v = value as Partial<AgentCredential> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.server === 'string' &&
    v.server !== '' &&
    typeof v.workspaceId === 'string' &&
    v.workspaceId !== '' &&
    typeof v.botId === 'number' &&
    typeof v.botName === 'string' &&
    typeof v.apiKey === 'string' &&
    v.apiKey !== '' &&
    typeof v.pairedAt === 'string'
  );
}

/** The stored credential for `botName`, or a `UserError` saying how to get one. */
export function loadAgentFile(
  botName: string,
  dir: string = getAgentsDir(),
): AgentCredential {
  const path = agentFilePath(botName, dir);
  if (!existsSync(path)) {
    throw new UserError(
      'AGENT_NOT_PAIRED',
      `Bot "${botName}" is not paired on this machine. Get a code in ` +
        'Settings → Bots → Connect (or `wafflebase bots pair-code ' +
        `${botName}\`), then run \`wafflebase agent pair <code>\`.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    parsed = null;
  }
  if (!isCredential(parsed) || parsed.botName !== botName) {
    throw new UserError(
      'INVALID_AGENT_FILE',
      `${path} is not a pairing for bot "${botName}". Pair again with ` +
        '`wafflebase agent pair <code>`.',
    );
  }
  return parsed;
}

/**
 * The stored credential for `botName`, or null when there is none — or none
 * readable, which a new pairing may then replace.
 */
export function findAgentFile(
  botName: string,
  dir: string = getAgentsDir(),
): AgentCredential | null {
  if (!existsSync(agentFilePath(botName, dir))) return null;
  try {
    return loadAgentFile(botName, dir);
  } catch {
    return null;
  }
}

/**
 * Whether two pairings are of the same bot. Bot names are unique only
 * within a workspace, so the file name alone (`<botName>.json`) cannot tell
 * a re-pairing from a different bot that happens to share the name.
 */
export function isSameBot(
  a: Pick<AgentCredential, 'server' | 'workspaceId' | 'botId'>,
  b: Pick<AgentCredential, 'server' | 'workspaceId' | 'botId'>,
): boolean {
  return (
    a.server === b.server && a.workspaceId === b.workspaceId && a.botId === b.botId
  );
}

/** Every bot paired on this machine, by name, without keys. */
export function listAgentFiles(dir: string = getAgentsDir()): AgentSummary[] {
  if (!existsSync(dir)) return [];
  const rows: AgentSummary[] = [];
  for (const file of readdirSync(dir).sort()) {
    const name = file.endsWith('.json') ? file.slice(0, -5) : '';
    if (!BOT_NAME.test(name)) continue;
    try {
      const { apiKey: _key, ...summary } = loadAgentFile(name, dir);
      rows.push(summary);
    } catch {
      // A broken file is reported by the command that names its bot.
    }
  }
  return rows;
}

/**
 * The config an `agent` command talks to the server with: the bot's own key
 * against the workspace the pairing came with. Built from the file alone —
 * never from flags, env or the session.
 */
export function agentConfig(agent: AgentCredential): CliConfig {
  return {
    server: agent.server,
    apiKey: agent.apiKey,
    workspace: agent.workspaceId,
    authMode: 'api-key',
  };
}
