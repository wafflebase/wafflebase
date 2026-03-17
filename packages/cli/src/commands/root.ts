import { createRequire } from 'node:module';
import { Command } from 'commander';
import { resolveConfig, type CliConfig } from '../config/config.js';
import { HttpClient } from '../client/http-client.js';
import type { OutputFormat } from '../output/formatter.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

export interface GlobalOpts {
  server?: string;
  apiKey?: string;
  workspace?: string;
  profile?: string;
  format: OutputFormat;
  quiet: boolean;
  verbose: boolean;
  dryRun: boolean;
}

export function getGlobalOpts(cmd: Command): GlobalOpts {
  const root = cmd.optsWithGlobals<GlobalOpts>();
  return root;
}

export function getConfig(opts: GlobalOpts): CliConfig {
  return resolveConfig({
    server: opts.server,
    apiKey: opts.apiKey,
    workspace: opts.workspace,
    profile: opts.profile,
  });
}

export function getClient(opts: GlobalOpts): HttpClient {
  return new HttpClient(getConfig(opts));
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('wafflebase')
    .description('CLI for Wafflebase spreadsheet API')
    .version(version)
    .option('--server <url>', 'Server URL')
    .option('--api-key <key>', 'API key')
    .option('--workspace <id>', 'Workspace ID')
    .option('--profile <name>', 'Config profile', 'default')
    .option('--format <fmt>', 'Output format (json, table, csv)', 'json')
    .option('--quiet', 'Suppress output', false)
    .option('--verbose', 'Verbose output', false)
    .option('--dry-run', 'Show request without executing', false);

  return program;
}
