import { Command } from 'commander';
import { registerCellsCommand } from './cells.js';
import { registerTabsCommand } from './tabs.js';
import { registerSheetsImportCommand } from './sheets-import.js';
import { registerSheetsExportCommand } from './sheets-export.js';

export function registerSheetsCommand(program: Command) {
  const sheets = program
    .command('sheets')
    .alias('sheet')
    .alias('spreadsheet')
    .alias('spreadsheets')
    .description('Spreadsheet commands');
  registerTabsCommand(sheets);
  registerCellsCommand(sheets);
  registerSheetsImportCommand(sheets);
  registerSheetsExportCommand(sheets);
  return sheets;
}
