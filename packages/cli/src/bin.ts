#!/usr/bin/env node
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

// `parseAsync`, not `parse`: every registered action handler is `async`, and
// commander only awaits the promise an action returns under `parseAsync`.
// With `parse()` the promise is dropped, so anything that rejects outside a
// command's own try/catch surfaced as an unhandled rejection instead of the
// `{ error: { code, message } }` envelope, and `process.exitCode = 1` set by
// `outputError` after the synchronous return could be missed. The catch is
// the last-resort envelope for throws no command handled itself.
program.parseAsync().catch((e: unknown) => {
  outputError(e);
});
