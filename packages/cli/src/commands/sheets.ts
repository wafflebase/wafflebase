import { Command } from 'commander';
import { registerCellsCommand } from './cells.js';
import { registerTabsCommand } from './tabs.js';
import { registerSheetsImportCommand } from './sheets-import.js';
import { registerSheetsExportCommand } from './sheets-export.js';
import { registerSheetsStructureCommand } from './sheets-structure.js';
import { registerSheetsStylesCommand } from './sheets-styles.js';
import { registerSheetsDimensionsCommand } from './sheets-dimensions.js';
import { registerSheetsViewCommand } from './sheets-view.js';
import { registerSheetsRulesCommand } from './sheets-rules.js';
import { registerSheetsChartsCommand } from './sheets-charts.js';
import { registerSheetsImagesCommand } from './sheets-images.js';
import { registerSheetsAnalysisCommand } from './sheets-analysis.js';

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
  registerSheetsStructureCommand(sheets);
  registerSheetsStylesCommand(sheets);
  registerSheetsDimensionsCommand(sheets);
  registerSheetsViewCommand(sheets);
  registerSheetsRulesCommand(sheets);
  registerSheetsChartsCommand(sheets);
  registerSheetsImagesCommand(sheets);
  registerSheetsAnalysisCommand(sheets);
  return sheets;
}
