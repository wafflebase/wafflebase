import { Command } from 'commander';
import { getGlobalOpts } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
} from '../output/formatter.js';
import { getCommandSchema, getAllCommandSchemas } from '../schema/registry.js';

export function registerSchemaCommand(program: Command) {
  program
    .command('schema [command]')
    .description('Describe command parameters and response shape')
    .action(function (this: Command, commandName?: string) {
      const opts = getGlobalOpts(this);

      // Wrapped like every other `output()` call site so a rejected
      // `--format` surfaces as the documented JSON error body instead of
      // an uncaught exception — `bin.ts` has no top-level handler.
      try {
        const fmt = parseOutputFormat(opts.format);

        if (commandName) {
          const schema = getCommandSchema(commandName);
          if (!schema) {
            console.error(
              JSON.stringify(
                { error: { code: 'NOT_FOUND', message: `Unknown command: ${commandName}` } },
                null,
                2,
              ),
            );
            process.exitCode = 1;
            return;
          }
          output(schema, fmt, opts.quiet);
        } else {
          const commands = getAllCommandSchemas().map((c) => ({
            name: c.name,
            description: c.description,
            safety: c.safety,
          }));
          output({ commands }, fmt, opts.quiet);
        }
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });
}
