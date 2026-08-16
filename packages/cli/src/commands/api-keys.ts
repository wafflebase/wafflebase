import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import { output, outputError } from '../output/formatter.js';
import { printDryRunUrl, seg } from '../client/dry-run.js';
import type { GlobalOpts } from './root.js';

/**
 * The API-key management endpoints do not hang off the v1 API base
 * (`/api/v1/workspaces/:id`) that `printDryRun` builds — they are the
 * workspace routes the browser uses. Mirror `HttpClient`'s URL exactly,
 * including the segment encoding, so the preview is the request.
 */
function apiKeysUrl(opts: GlobalOpts, keyId?: string): string {
  const config = getConfig(opts);
  const server = config.server.replace(/\/$/, '');
  const base = `${server}/workspaces/${config.workspace}/api-keys`;
  return keyId === undefined ? base : `${base}/${seg(keyId)}`;
}

export function registerApiKeysCommand(program: Command) {
  const apiKey = program
    .command('api-keys')
    .alias('api-key')
    .description('Manage API keys');

  apiKey
    .command('create <name>')
    .description('Create a new API key')
    .action(async function (this: Command, name: string) {
      const opts = getGlobalOpts(this);
      try {
        // Credential mutations honour --dry-run like every other write: a
        // preview must not mint a live key (and print its secret).
        if (opts.dryRun) {
          printDryRunUrl(apiKeysUrl(opts), 'POST', { name });
          return;
        }
        const res = await getClient(opts).createApiKey(name);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format);
      } catch (e) {
        outputError(e);
      }
    });

  apiKey
    .command('list')
    .description('List API keys in workspace')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        if (opts.dryRun) {
          printDryRunUrl(apiKeysUrl(opts), 'GET');
          return;
        }
        const res = await getClient(opts).listApiKeys();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format);
      } catch (e) {
        outputError(e);
      }
    });

  apiKey
    .command('revoke <key-id>')
    .description('Revoke an API key')
    .action(async function (this: Command, keyId: string) {
      const opts = getGlobalOpts(this);
      try {
        // Revocation is irreversible, so this is the one command where a
        // preview that executed anyway could not be undone.
        if (opts.dryRun) {
          printDryRunUrl(apiKeysUrl(opts, keyId), 'DELETE');
          return;
        }
        const res = await getClient(opts).revokeApiKey(keyId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format);
      } catch (e) {
        outputError(e);
      }
    });
}
