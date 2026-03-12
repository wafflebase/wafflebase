import { Command } from 'commander';
import { getGlobalOpts, getClient } from './root.js';
import { output, outputError } from '../output/formatter.js';

export function registerApiKeyCommand(program: Command) {
  const apiKey = program.command('api-key').description('Manage API keys');

  apiKey
    .command('create <name>')
    .description('Create a new API key')
    .action(async function (this: Command, name: string) {
      const opts = getGlobalOpts(this);
      try {
        const res = await getClient(opts).createApiKey(name);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  apiKey
    .command('list')
    .description('List API keys in workspace')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        const res = await getClient(opts).listApiKeys();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  apiKey
    .command('revoke <key-id>')
    .description('Revoke an API key')
    .action(async function (this: Command, keyId: string) {
      const opts = getGlobalOpts(this);
      try {
        const res = await getClient(opts).revokeApiKey(keyId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });
}
