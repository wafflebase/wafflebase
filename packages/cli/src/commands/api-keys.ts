import { Command } from 'commander';
import { getGlobalOpts, getClient } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';

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
        const res = await getClient(opts).createApiKey(name);
        if (!res.ok) return forwardUpstreamError(res);
        output(res.data, fmt);
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
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).listApiKeys();
        if (!res.ok) return forwardUpstreamError(res);
        output(res.data, fmt);
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
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).revokeApiKey(keyId);
        if (!res.ok) return forwardUpstreamError(res);
        output(res.data, fmt);
      } catch (e) {
        outputError(e);
      }
    });
}
