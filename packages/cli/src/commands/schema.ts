import { Command } from 'commander';
import { getGlobalOpts } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  type OutputFormat,
} from '../output/formatter.js';
import {
  getCommandSchema,
  getAllCommandSchemas,
  type CommandSchema,
} from '../schema/registry.js';

type SchemaListEntry = Pick<
  CommandSchema,
  'name' | 'description' | 'safety'
>;

export function toSchemaListPayload(
  commands: readonly SchemaListEntry[],
  format: OutputFormat,
): { commands: readonly SchemaListEntry[] } | readonly SchemaListEntry[] {
  return format === 'json' ? { commands } : commands;
}

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
          output(schema, fmt);
        } else {
          const commands = getAllCommandSchemas().map((c) => ({
            name: c.name,
            description: c.description,
            safety: c.safety,
          }));
          output(toSchemaListPayload(commands, fmt), fmt);
        }
      } catch (e) {
        outputError(e);
      }
    });
}
