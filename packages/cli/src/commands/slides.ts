import { Command } from 'commander';
import { getGlobalOpts, getClient } from './root.js';
import { outputError } from '../output/formatter.js';
import { runSlidesImport } from '../slides/import.js';

interface SlidesImportOpts {
  title?: string;
  replace?: string;
  yes: boolean;
}

export function registerSlidesCommand(program: Command) {
  const slides = program
    .command('slides')
    .alias('slide')
    .alias('deck')
    .description('Manage slide decks');

  registerSlidesImportCommand(slides);
}

export function registerSlidesImportCommand(slides: Command) {
  slides
    .command('import <file>')
    .description(
      'Import a .pptx file as a new (or replacement) slides deck',
    )
    .option('--title <title>', 'Deck title (default: file basename)')
    .option('--replace <doc-id>', 'Replace content of an existing deck')
    .option('--yes', 'Skip --replace confirmation prompt', false)
    .action(async function (this: Command, file: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<SlidesImportOpts>();
      try {
        const result = await runSlidesImport(
          {
            file,
            title: local.title,
            replace: local.replace,
            yes: local.yes,
            quiet: opts.quiet,
            dryRun: opts.dryRun,
          },
          getClient(opts),
        );
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });
}
