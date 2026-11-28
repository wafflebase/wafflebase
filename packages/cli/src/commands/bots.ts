import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRunUrl } from '../client/dry-run.js';
import { botsUrl } from '../client/url.js';
import { assertBotName } from '../config/agents.js';
import { UserError } from '../errors.js';
import type { HttpClient } from '../client/http-client.js';

/**
 * `bots` — workspace bot members (docs/design/chat.md § Bot Members,
 * docs/design/agent-runner.md § 1). The JWT workspace routes Settings → Bots
 * uses (`/workspaces/:id/bots/…`), so they need a `wafflebase login` session.
 * A bot's own key is never used here: that is what `agent` commands are for.
 */

interface BotSummary {
  id: number;
  username: string;
}

/**
 * The id of the bot `query` names: its exact name first, then its id.
 * Resolved from the listing even under `--dry-run` — a read changes nothing,
 * and a preview that could only take ids would not preview what was typed.
 */
async function resolveBotId(
  client: HttpClient,
  cmd: Command,
  query: string,
): Promise<string | undefined> {
  const res = await client.botRequest<BotSummary[]>('GET');
  if (!res.ok) {
    forwardUpstreamError(res, cmd);
    return undefined;
  }
  const bots = Array.isArray(res.data) ? res.data : [];
  const bot =
    bots.find((b) => b.username === query) ??
    bots.find((b) => String(b.id) === query);
  if (!bot) throw new UserError('NOT_FOUND', `Bot not found: ${query}`);
  return String(bot.id);
}

/**
 * One request: the `--dry-run` preview or the call, then the response.
 * `--format` is validated before anything is sent, as everywhere else.
 */
async function send(
  cmd: Command,
  method: string,
  target: { query?: string; suffix?: string[] },
  body?: unknown,
) {
  const opts = getGlobalOpts(cmd);
  const fmt = parseOutputFormat(opts.format);
  const client = getClient(opts);
  const segments: string[] = [];
  if (target.query !== undefined) {
    const id = await resolveBotId(client, cmd, target.query);
    if (id === undefined) return;
    segments.push(id, ...(target.suffix ?? []));
  }
  if (opts.dryRun) {
    printDryRunUrl(botsUrl(getConfig(opts), segments), method, body);
    return;
  }
  const res = await client.botRequest(method, segments, body);
  if (!res.ok) return forwardUpstreamError(res, cmd);
  // `DELETE` answers 204 with no body.
  output(res.data ?? { ok: true }, fmt);
}

export function registerBotsCommand(program: Command) {
  const bots = program
    .command('bots')
    .alias('bot')
    .description('Manage workspace bots (needs `wafflebase login`)');

  bots
    .command('list')
    .description('List bots in workspace, with their hosts')
    .action(async function (this: Command) {
      try {
        await send(this, 'GET', {});
      } catch (e) {
        outputError(e, this);
      }
    });

  bots
    .command('create <name>')
    .description('Create a bot you manage; only you can mention it for now')
    .action(async function (this: Command, name: string) {
      try {
        assertBotName(name);
        await send(this, 'POST', {}, { name });
      } catch (e) {
        outputError(e, this);
      }
    });

  bots
    .command('delete <name-or-id>')
    .description('Delete a bot: revokes its host keys and removes it from the workspace')
    .action(async function (this: Command, query: string) {
      try {
        await send(this, 'DELETE', { query });
      } catch (e) {
        outputError(e, this);
      }
    });

  bots
    .command('pair-code <name-or-id>')
    .description('Get a single-use code (10 min) to connect a host with `agent pair`')
    .action(async function (this: Command, query: string) {
      try {
        await send(this, 'POST', { query, suffix: ['pairing-codes'] });
      } catch (e) {
        outputError(e, this);
      }
    });
}
