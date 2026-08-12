import { Command } from 'commander';
import { getGlobalOpts } from './root.js';
import {
  commandPath,
  errorEnvelope,
  output,
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

      if (commandName) {
        const schema = getCommandSchema(commandName);
        if (!schema) {
          // Not thrown through `outputError`: an unknown name is a lookup
          // miss, not an exception. It still has to leave stderr in the
          // documented one-line, attributed shape.
          console.error(
            errorEnvelope(
              'NOT_FOUND',
              `Unknown command: ${commandName}`,
              commandPath(this),
            ),
          );
          process.exitCode = 1;
          return;
        }
        output(schema, opts.format);
      } else {
        const commands = getAllCommandSchemas().map((c) => ({
          name: c.name,
          description: c.description,
          safety: c.safety,
        }));
        output(toSchemaListPayload(commands, opts.format), opts.format);
      }
    });
}
