import type { Command } from 'commander';
import { createProgram } from './commands/root.js';
import { registerDocsCommand } from './commands/docs.js';
import { registerSheetsCommand } from './commands/sheets.js';
import { registerSlidesCommand } from './commands/slides.js';
import { registerNotesCommand } from './commands/notes.js';
import { registerFilesCommand } from './commands/files.js';
import { registerApiKeysCommand } from './commands/api-keys.js';
import { registerSchemaCommand } from './commands/schema.js';
import { registerLoginCommand } from './commands/login.js';
import { registerLogoutCommand } from './commands/logout.js';
import { registerStatusCommand } from './commands/status.js';
import { registerCtxCommand } from './commands/ctx.js';
import { outputError } from './output/formatter.js';

/** Build the fully wired root program with every namespace registered. */
export function buildProgram(): Command {
  const program = createProgram();

  registerLoginCommand(program);
  registerLogoutCommand(program);
  registerStatusCommand(program);
  registerCtxCommand(program);
  registerDocsCommand(program);
  registerSheetsCommand(program);
  registerSlidesCommand(program);
  registerNotesCommand(program);
  registerFilesCommand(program);
  registerApiKeysCommand(program);
  registerSchemaCommand(program);

  return program;
}

/**
 * Run the CLI: parse `argv` and emit the error envelope for anything a
 * command did not handle itself.
 *
 * `parseAsync`, not `parse`: every registered action handler is `async`, and
 * commander only awaits the promise an action returns under `parseAsync`.
 * With `parse()` the promise is dropped, so anything that rejects outside a
 * command's own try/catch surfaced as an unhandled rejection instead of the
 * `{ error: { code, message } }` envelope, and `process.exitCode = 1` set by
 * `outputError` after the synchronous return could be missed. The catch is
 * the last-resort envelope for throws no command handled itself.
 *
 * Lives here rather than in `bin.ts` so it is reachable from tests: a
 * module-scope side effect in the shebang entrypoint cannot be driven with a
 * rejecting action, which is exactly the path that needs a regression guard.
 *
 * The `preAction` hook records which subcommand is running so that envelope
 * can carry `command` too. The root program alone cannot say — and this is
 * the path where attribution matters most, since the throw is by definition
 * one no command handled itself.
 */
export async function runCli(
  program: Command = buildProgram(),
  argv?: readonly string[],
): Promise<void> {
  let acting: Command | undefined;
  program.hook('preAction', (_thisCommand, actionCommand) => {
    acting = actionCommand;
  });
  try {
    await program.parseAsync(argv as string[] | undefined);
  } catch (e: unknown) {
    outputError(e, acting);
  }
}
