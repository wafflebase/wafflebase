#!/usr/bin/env node
import { createProgram } from './commands/root.js';
import { registerDocsCommand } from './commands/docs.js';
import { registerSheetsCommand } from './commands/sheets.js';
import { registerSlidesCommand } from './commands/slides.js';
import { registerNotesCommand } from './commands/notes.js';
import { registerApiKeysCommand } from './commands/api-keys.js';
import { registerSchemaCommand } from './commands/schema.js';
import { registerLoginCommand } from './commands/login.js';
import { registerLogoutCommand } from './commands/logout.js';
import { registerStatusCommand } from './commands/status.js';
import { registerCtxCommand } from './commands/ctx.js';

const program = createProgram();

registerLoginCommand(program);
registerLogoutCommand(program);
registerStatusCommand(program);
registerCtxCommand(program);
registerDocsCommand(program);
registerSheetsCommand(program);
registerSlidesCommand(program);
registerNotesCommand(program);
registerApiKeysCommand(program);
registerSchemaCommand(program);

program.parse();
