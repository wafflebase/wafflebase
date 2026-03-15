#!/usr/bin/env node
import { createProgram } from './commands/root.js';
import { registerDocumentCommand } from './commands/document.js';
import { registerTabCommand } from './commands/tab.js';
import { registerCellCommand } from './commands/cell.js';
import { registerApiKeyCommand } from './commands/api-key.js';
import { registerSchemaCommand } from './commands/schema.js';
import { registerLoginCommand } from './commands/login.js';
import { registerLogoutCommand } from './commands/logout.js';
import { registerStatusCommand } from './commands/status.js';
import { registerCtxCommand } from './commands/ctx.js';
import { registerImportCommand } from './commands/import.js';
import { registerExportCommand } from './commands/export.js';

const program = createProgram();

registerLoginCommand(program);
registerLogoutCommand(program);
registerStatusCommand(program);
registerCtxCommand(program);
registerDocumentCommand(program);
registerTabCommand(program);
registerCellCommand(program);
registerApiKeyCommand(program);
registerImportCommand(program);
registerExportCommand(program);
registerSchemaCommand(program);

program.parse();
