import { Command } from 'commander';
import { getGlobalOpts } from './root.js';
import { output } from '../output/formatter.js';
import { getCommandSchema, getAllCommandSchemas } from '../schema/registry.js';

export function registerSchemaCommand(program: Command) {
  program
    .command('schema [command]')
    .description('Describe command parameters and response shape')
    .action(function (this: Command, commandName?: string) {
      const opts = getGlobalOpts(this);

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
        output(schema, opts.format, opts.quiet);
      } else {
        const commands = getAllCommandSchemas().map((c) => ({
          name: c.name,
          description: c.description,
          safety: c.safety,
        }));
        output({ commands }, opts.format, opts.quiet);
      }
    });
}
