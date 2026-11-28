import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { Command } from 'commander';
import { getGlobalOpts, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRun, printDryRunUrl } from '../client/dry-run.js';
import { agentTasksPath, pairUrl } from '../client/url.js';
import { HttpClient } from '../client/http-client.js';
import type { CliConfig } from '../config/config.js';
import {
  BOT_NAME,
  agentConfig,
  findAgentFile,
  isSameBot,
  listAgentFiles,
  loadAgentFile,
  saveAgentFile,
} from '../config/agents.js';
import { SystemError, UserError } from '../errors.js';

/**
 * `agent` — run as a bot on this host (docs/design/agent-runner.md § 4–5).
 *
 * `pair` trades a pairing code for a bot key and stores it in
 * `~/.wafflebase/agents/<bot>.json`. Every other subcommand authenticates
 * from that file alone: `--api-key`, `WAFFLEBASE_API_KEY`, `--server`,
 * `--workspace` and the login session are all ignored, so a member's own
 * credential can never be what answers a bot's task, and the bot key never
 * leaks into the member's other commands.
 */

/** The longest long-poll the server holds (`GET agent/tasks/next?wait=`). */
const MAX_WAIT_SECONDS = 240;

function parseWait(raw: string): number {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n > MAX_WAIT_SECONDS) {
    throw new UserError(
      'INVALID_ARGUMENT',
      `--wait must be a whole number of seconds from 0 to ${MAX_WAIT_SECONDS}`,
    );
  }
  return n;
}

/**
 * One task-queue request as the bot: the `--dry-run` preview or the call,
 * then the response. The preview prints the URL and body, never the key.
 */
async function sendAsBot(
  cmd: Command,
  botName: string,
  method: string,
  segments: string[],
  body?: unknown,
  query?: URLSearchParams,
) {
  const opts = getGlobalOpts(cmd);
  const fmt = parseOutputFormat(opts.format);
  const agent = loadAgentFile(botName);
  const config = agentConfig(agent);
  if (opts.dryRun) {
    printDryRun(config, method, agentTasksPath(segments, query), body);
    return;
  }
  const res = await new HttpClient(config).agentRequest(
    method,
    segments,
    body,
    query,
  );
  if (!res.ok) {
    // The generic 401 hint says `wafflebase login`, which cannot fix a
    // bot key: only a new pairing can.
    if (res.status === 401) {
      throw new SystemError(
        'AUTH_ERROR',
        `The key for bot "${botName}" was rejected: the host was ` +
          'disconnected or the bot was deleted. Get a new code and run ' +
          '`wafflebase agent pair <code>`.',
      );
    }
    return forwardUpstreamError(res, cmd);
  }
  // `complete` answers 204 with no body.
  output(res.data ?? { ok: true }, fmt);
}

interface PairResponse {
  botId: number;
  botName: string;
  workspaceId: string;
  apiKey: string;
}

function isPairResponse(data: unknown): data is PairResponse {
  const d = data as Partial<PairResponse> | null;
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof d.botId === 'number' &&
    typeof d.botName === 'string' &&
    BOT_NAME.test(d.botName) &&
    typeof d.workspaceId === 'string' &&
    d.workspaceId !== '' &&
    typeof d.apiKey === 'string' &&
    d.apiKey !== ''
  );
}

/** `<body>` or `--body-file <path>` (`-` for stdin) — exactly one. */
function replyBody(body: string | undefined, bodyFile: string | undefined) {
  if ((body === undefined) === (bodyFile === undefined)) {
    throw new UserError(
      'INVALID_ARGUMENT',
      'Give exactly one of <body> or --body-file <path>.',
    );
  }
  const text =
    body ?? readFileSync(bodyFile === '-' ? 0 : (bodyFile as string), 'utf-8');
  if (text.trim() === '') {
    throw new UserError('INVALID_ARGUMENT', 'The reply body is empty.');
  }
  return text;
}

export function registerAgentCommand(program: Command) {
  const agent = program
    .command('agent')
    .description(
      'Run as a bot on this host; authenticates only with the paired bot key',
    );

  agent
    .command('pair <code>')
    .description('Connect this host to a bot with a pairing code and store its key')
    .option('--host-name <name>', 'Name this host shows under the bot (default: this machine\'s hostname)')
    .option('--replace', 'Replace a different bot of the same name already paired here')
    .action(async function (this: Command, rawCode: string) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        const local = this.opts<{ hostName?: string; replace?: boolean }>();
        const hostName = local.hostName ?? hostname();
        const code = rawCode.trim().toUpperCase();
        // The server comes from the usual resolution; the credential does
        // not. A client with no auth keeps the member's session and any env
        // key off this unauthenticated request.
        const server = getConfig(opts).server.replace(/\/$/, '');
        const config: CliConfig = {
          server,
          apiKey: '',
          workspace: '',
          authMode: 'none',
        };
        if (opts.dryRun) {
          printDryRunUrl(pairUrl(config), 'POST', { code, hostName });
          return;
        }
        const res = await new HttpClient(config).pairHost(code, hostName);
        if (!res.ok) return forwardUpstreamError(res, this);
        if (!isPairResponse(res.data)) {
          throw new SystemError(
            'INVALID_RESPONSE',
            'The server answered the pairing without a usable bot key.',
          );
        }
        const { botId, botName, workspaceId, apiKey } = res.data;
        // The file is keyed by name, but a name is unique only within a
        // workspace: never let another workspace's (or server's) bot of the
        // same name silently take the first one's key off this host.
        const existing = findAgentFile(botName);
        if (
          existing &&
          !local.replace &&
          !isSameBot(existing, { server, workspaceId, botId })
        ) {
          throw new UserError(
            'AGENT_NAME_TAKEN',
            `A bot named "${botName}" from workspace ${existing.workspaceId} ` +
              `on ${existing.server} is already paired on this machine, so ` +
              `this pairing (workspace ${workspaceId}) was not saved. ` +
              'Disconnect the new host under the bot in Settings → Bots. To ' +
              'swap the stored bot for this one, get a new code and run ' +
              '`wafflebase agent pair <code> --replace`.',
          );
        }
        const pairedAt = new Date().toISOString();
        const file = saveAgentFile({
          server,
          workspaceId,
          botId,
          botName,
          apiKey,
          pairedAt,
        });
        // The key stays in the file: stdout is what an agent records.
        output({ botName, botId, workspaceId, server, pairedAt, file }, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  agent
    .command('list')
    .description('List bots paired on this host (never shows keys)')
    .action(function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        output(listAgentFiles(), fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  agent
    .command('next <bot>')
    .description('Claim the bot\'s next task, waiting up to --wait seconds; prints { task: null } when none came')
    .option('--wait <seconds>', `Seconds to wait for a task (0-${MAX_WAIT_SECONDS})`, '0')
    .action(async function (this: Command, bot: string) {
      try {
        const { wait } = this.opts<{ wait: string }>();
        const query = new URLSearchParams({ wait: String(parseWait(wait)) });
        await sendAsBot(this, bot, 'GET', ['next'], undefined, query);
      } catch (e) {
        outputError(e, this);
      }
    });

  agent
    .command('thread <bot> <task-id>')
    .description('Read the chat thread a task came from, oldest first')
    .action(async function (this: Command, bot: string, taskId: string) {
      try {
        await sendAsBot(this, bot, 'GET', [taskId, 'thread']);
      } catch (e) {
        outputError(e, this);
      }
    });

  agent
    .command('reply <bot> <task-id> [body]')
    .description('Post a reply as the bot in the task\'s thread')
    .option('--body-file <path>', 'Read the reply from a file (- for stdin)')
    .action(async function (
      this: Command,
      bot: string,
      taskId: string,
      body: string | undefined,
    ) {
      try {
        const { bodyFile } = this.opts<{ bodyFile?: string }>();
        const text = replyBody(body, bodyFile);
        await sendAsBot(this, bot, 'POST', [taskId, 'reply'], { body: text });
      } catch (e) {
        outputError(e, this);
      }
    });

  agent
    .command('complete <bot> <task-id>')
    .description('Close a task as done (or failed with --failed)')
    .option('--failed', 'Mark the task failed instead of done', false)
    .action(async function (this: Command, bot: string, taskId: string) {
      try {
        const { failed } = this.opts<{ failed: boolean }>();
        await sendAsBot(this, bot, 'POST', [taskId, 'complete'], {
          status: failed ? 'failed' : 'done',
        });
      } catch (e) {
        outputError(e, this);
      }
    });
}
