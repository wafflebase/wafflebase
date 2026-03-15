import { Command } from 'commander';
import { clearSession } from '../config/session.js';

export function registerLogoutCommand(program: Command): void {
  program
    .command('logout')
    .description('Log out and clear session')
    .action(() => {
      clearSession();
      console.log('Logged out.');
    });
}
