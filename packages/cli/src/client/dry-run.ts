import type { CliConfig } from '../config/config.js';

/**
 * Print the request that would be sent without executing it.
 */
export function printDryRun(
  config: CliConfig,
  method: string,
  path: string,
  body?: unknown,
) {
  const server = config.server.replace(/\/$/, '');
  const url = `${server}/api/v1/workspaces/${config.workspace}${path}`;

  const output: Record<string, unknown> = {
    dry_run: true,
    method,
    url,
  };
  if (body !== undefined) {
    output.body = body;
  }

  console.log(JSON.stringify(output, null, 2));
}
