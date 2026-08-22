import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRunUrl } from '../client/dry-run.js';
import { apiKeysUrl } from '../client/url.js';
import type { GlobalOpts } from './root.js';

/**
 * The API-key management endpoints do not hang off the v1 API base
 * (`/api/v1/workspaces/:id`) that `printDryRun` builds — they are the
 * workspace routes the browser uses. The preview goes through `apiKeysUrl()`,
 * the very builder `HttpClient` fetches with, so a route change cannot leave
 * the preview describing a request nobody sends.
 */
function previewUrl(opts: GlobalOpts, keyId?: string): string {
  return apiKeysUrl(getConfig(opts), keyId);
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
        // Validate before the key is minted: a bad `--format` must not
        // discard a raw key that the server will never show again.
        const fmt = parseOutputFormat(opts.format);
        // Credential mutations honour --dry-run like every other write: a
        // preview must not mint a live key (and print its secret).
        if (opts.dryRun) {
          printDryRunUrl(previewUrl(opts), 'POST', { name });
          return;
        }
        const res = await getClient(opts).createApiKey(name);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  apiKey
    .command('list')
    .description('List API keys in workspace')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        if (opts.dryRun) {
          printDryRunUrl(previewUrl(opts), 'GET');
          return;
        }
        const res = await getClient(opts).listApiKeys();
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  apiKey
    .command('revoke <key-id>')
    .description('Revoke an API key')
    .action(async function (this: Command, keyId: string) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        // Revocation is irreversible, so this is the one command where a
        // preview that executed anyway could not be undone.
        if (opts.dryRun) {
          printDryRunUrl(previewUrl(opts, keyId), 'DELETE');
          return;
        }
        const res = await getClient(opts).revokeApiKey(keyId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
