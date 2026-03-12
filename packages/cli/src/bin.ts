#!/usr/bin/env node
import { createProgram } from './commands/root.js';
import { registerDocumentCommand } from './commands/document.js';
import { registerTabCommand } from './commands/tab.js';
import { registerCellCommand } from './commands/cell.js';
import { registerApiKeyCommand } from './commands/api-key.js';
import { registerSchemaCommand } from './commands/schema.js';

const program = createProgram();

registerDocumentCommand(program);
registerTabCommand(program);
registerCellCommand(program);
registerApiKeyCommand(program);
registerSchemaCommand(program);

program.parse();
