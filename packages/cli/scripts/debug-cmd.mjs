import { Command } from 'commander';
const program = new Command();
program
  .name('wafflebase')
  .option('--format <fmt>', 'global', 'global-default');

const sub = program.command('content');
sub
  .option('--format <fmt>', 'local', 'local-default')
  .action(function action() {
    console.log('local opts:', this.opts());
    console.log('global merged:', this.optsWithGlobals());
  });

await program.parseAsync(['node', 'cli', 'content', '--format', 'md']);
