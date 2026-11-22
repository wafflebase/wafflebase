import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRunUrl } from '../client/dry-run.js';
import { webhooksUrl } from '../client/url.js';
import { UserError } from '../errors.js';
import type { GlobalOpts } from './root.js';

/**
 * `webhooks` — outbound workspace webhooks (docs/design/webhooks.md).
 *
 * Like `api-keys`, these are the JWT-only workspace routes the browser uses
 * (`/workspaces/:id/webhooks/…`), never `/api/v1`: a leaked API key must not
 * be able to register an exfiltration endpoint, so the commands need a
 * `wafflebase login` session and an API key is refused by the server. Every
 * request URL comes from `webhooksUrl()`, which the `--dry-run` preview
 * prints, so the preview is the request.
 *
 * Everything but `list` is owner-only; a member's `list` shows hosts only.
 */

/** Collect a repeatable option, leaving it absent when never passed. */
function collect(value: string, previous?: string[]): string[] {
  return [...(previous ?? []), value];
}

/** A positive integer flag, refused locally rather than sent as `NaN`. */
function parseIntFlag(flag: string, value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new UserError('INVALID_ARGUMENT', `${flag} must be a whole number`);
  }
  return Number(value);
}

interface FilterOpts {
  event?: string[];
  documentType?: string[];
  folder?: string[];
  allEvents?: boolean;
  allDocumentTypes?: boolean;
  allFolders?: boolean;
}

/**
 * The three filters of a create or update body. An empty list means "all",
 * so an update can only widen a filter back to everything through the
 * explicit `--all-*` flag; an option never passed is left out entirely.
 */
function filterBody(o: FilterOpts): Record<string, string[]> {
  const body: Record<string, string[]> = {};
  const pick = (
    key: string,
    values: string[] | undefined,
    all: boolean | undefined,
    flag: string,
  ) => {
    if (all && values) {
      throw new UserError(
        'INVALID_ARGUMENT',
        `--all-${flag} cannot be combined with --${flag.replace(/s$/, '')}`,
      );
    }
    if (all) body[key] = [];
    else if (values) body[key] = values;
  };
  pick('events', o.event, o.allEvents, 'events');
  pick('documentTypes', o.documentType, o.allDocumentTypes, 'document-types');
  pick('folderIds', o.folder, o.allFolders, 'folders');
  return body;
}

/**
 * One request: the `--dry-run` preview or the call, then the response. Kept
 * in one place so every subcommand honours `--dry-run` and validates
 * `--format` before anything is sent — `reveal-secret` and `rotate-secret`
 * answer with a secret, and a bad flag must not be what throws it away.
 */
async function send(
  cmd: Command,
  method: string,
  segments: string[],
  body?: unknown,
  query?: URLSearchParams,
) {
  const opts: GlobalOpts = getGlobalOpts(cmd);
  const fmt = parseOutputFormat(opts.format);
  if (opts.dryRun) {
    printDryRunUrl(webhooksUrl(getConfig(opts), segments, query), method, body);
    return;
  }
  const res = await getClient(opts).webhookRequest(
    method,
    segments,
    body,
    query,
  );
  if (!res.ok) return forwardUpstreamError(res, cmd);
  // `DELETE` answers 204 with no body.
  output(res.data ?? { ok: true }, fmt);
}

function withFilters(command: Command): Command {
  return command
    .option(
      '--event <type>',
      'Subscribe to an event type (repeatable; default: every event)',
      collect,
    )
    .option(
      '--document-type <type>',
      'Only documents of this type (repeatable; sheet|doc|slides|note|board|pdf|image|file)',
      collect,
    )
    .option(
      '--folder <folder-id>',
      'Only documents filed directly in this folder (repeatable)',
      collect,
    );
}

export function registerWebhooksCommand(program: Command) {
  const webhooks = program
    .command('webhooks')
    .alias('webhook')
    .description('Manage outbound workspace webhooks (owner only)');

  webhooks
    .command('list')
    .description('List webhooks in workspace (members see hosts only)')
    .action(async function (this: Command) {
      try {
        await send(this, 'GET', []);
      } catch (e) {
        outputError(e, this);
      }
    });

  webhooks
    .command('get <webhook-id>')
    .description('Show a webhook')
    .action(async function (this: Command, id: string) {
      try {
        await send(this, 'GET', [id]);
      } catch (e) {
        outputError(e, this);
      }
    });

  withFilters(
    webhooks
      .command('create <name> <url>')
      .description('Register a webhook; a signed test event is sent at once'),
  ).action(async function (this: Command, name: string, url: string) {
    try {
      const body = {
        name,
        url,
        events: [],
        documentTypes: [],
        folderIds: [],
        ...filterBody(this.opts<FilterOpts>()),
      };
      await send(this, 'POST', [], body);
    } catch (e) {
      outputError(e, this);
    }
  });

  withFilters(
    webhooks
      .command('update <webhook-id>')
      .description(
        'Change a webhook; only the options given are sent, and a new URL is tested',
      )
      .option('--name <name>', 'New name')
      .option('--url <url>', 'New endpoint URL')
      .option('--all-events', 'Subscribe to every event again')
      .option('--all-document-types', 'Drop the document type filter')
      .option('--all-folders', 'Drop the folder filter'),
  ).action(async function (this: Command, id: string) {
    try {
      const o = this.opts<FilterOpts & { name?: string; url?: string }>();
      const body = {
        ...(o.name !== undefined ? { name: o.name } : {}),
        ...(o.url !== undefined ? { url: o.url } : {}),
        ...filterBody(o),
      };
      if (Object.keys(body).length === 0) {
        throw new UserError('INVALID_ARGUMENT', 'Nothing to update');
      }
      await send(this, 'PATCH', [id], body);
    } catch (e) {
      outputError(e, this);
    }
  });

  webhooks
    .command('delete <webhook-id>')
    .description('Delete a webhook and its delivery log')
    .action(async function (this: Command, id: string) {
      try {
        await send(this, 'DELETE', [id]);
      } catch (e) {
        outputError(e, this);
      }
    });

  webhooks
    .command('test <webhook-id>')
    .description('Send a signed webhook.test event and show the response')
    .action(async function (this: Command, id: string) {
      try {
        await send(this, 'POST', [id, 'test']);
      } catch (e) {
        outputError(e, this);
      }
    });

  webhooks
    .command('reveal-secret <webhook-id>')
    .description(
      'Show the signing secret (and the previous one during a rotation)',
    )
    .action(async function (this: Command, id: string) {
      try {
        await send(this, 'POST', [id, 'reveal-secret']);
      } catch (e) {
        outputError(e, this);
      }
    });

  webhooks
    .command('rotate-secret <webhook-id>')
    .description(
      'Issue a new signing secret; the old one keeps signing for the overlap',
    )
    .option('--overlap-hours <n>', 'Hours the old secret stays live (1-168)')
    .action(async function (this: Command, id: string) {
      try {
        const { overlapHours } = this.opts<{ overlapHours?: string }>();
        const hours = parseIntFlag('--overlap-hours', overlapHours);
        await send(
          this,
          'POST',
          [id, 'rotate-secret'],
          hours === undefined ? {} : { overlapHours: hours },
        );
      } catch (e) {
        outputError(e, this);
      }
    });

  webhooks
    .command('enable <webhook-id>')
    .description(
      'Turn a webhook back on and become its owner of record; --recover-since re-sends what failed',
    )
    .option(
      '--recover-since <iso>',
      'Re-queue failed deliveries created at or after this ISO 8601 instant',
    )
    .action(async function (this: Command, id: string) {
      try {
        const { recoverSince } = this.opts<{ recoverSince?: string }>();
        if (recoverSince !== undefined && Number.isNaN(Date.parse(recoverSince))) {
          throw new UserError(
            'INVALID_ARGUMENT',
            '--recover-since must be an ISO 8601 date',
          );
        }
        await send(this, 'POST', [id, 'enable'], {
          recoverSince: recoverSince ?? null,
        });
      } catch (e) {
        outputError(e, this);
      }
    });

  webhooks
    .command('disable <webhook-id>')
    .description('Turn a webhook off; nothing is sent until it is enabled')
    .action(async function (this: Command, id: string) {
      try {
        await send(this, 'POST', [id, 'disable']);
      } catch (e) {
        outputError(e, this);
      }
    });

  webhooks
    .command('deliveries <webhook-id> [delivery-id]')
    .description(
      'List recent deliveries, newest first, or show one with its payload and response',
    )
    .option('--status <status>', 'failed or all (default: all)')
    .option('--limit <n>', 'Page size (1-50)')
    .option('--before <iso>', 'Cursor: nextCursor.before of a prior page')
    .option('--before-id <id>', 'Cursor: nextCursor.beforeId of a prior page')
    .action(async function (
      this: Command,
      id: string,
      deliveryId: string | undefined,
    ) {
      try {
        if (deliveryId !== undefined) {
          await send(this, 'GET', [id, 'deliveries', deliveryId]);
          return;
        }
        const o = this.opts<{
          status?: string;
          limit?: string;
          before?: string;
          beforeId?: string;
        }>();
        const query = new URLSearchParams();
        if (o.status !== undefined) query.set('status', o.status);
        const limit = parseIntFlag('--limit', o.limit);
        if (limit !== undefined) query.set('limit', String(limit));
        if (o.before !== undefined) query.set('before', o.before);
        if (o.beforeId !== undefined) query.set('beforeId', o.beforeId);
        await send(this, 'GET', [id, 'deliveries'], undefined, query);
      } catch (e) {
        outputError(e, this);
      }
    });

  webhooks
    .command('redeliver <webhook-id> <delivery-id>')
    .description(
      'Send a delivery again now, under the same webhook-id header',
    )
    .action(async function (this: Command, id: string, deliveryId: string) {
      try {
        await send(this, 'POST', [id, 'deliveries', deliveryId, 'redeliver']);
      } catch (e) {
        outputError(e, this);
      }
    });
}
