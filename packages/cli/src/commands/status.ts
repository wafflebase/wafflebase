import { Command } from 'commander';
import { loadSession, isSessionExpired } from '../config/session.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show current auth state')
    .action(() => {
      const session = loadSession();
      if (!session) {
        console.log('Not logged in. Run `wafflebase login`.');
        return;
      }

      console.log(
        `Logged in as ${session.user.username} (${session.user.email})`,
      );
      console.log(`Server:    ${session.server}`);

      const ws = session.workspaces.find(
        (w) => w.id === session.activeWorkspace,
      );
      const wsLabel = ws
        ? `${ws.name} (${session.activeWorkspace.slice(0, 8)}...)`
        : session.activeWorkspace;
      console.log(`Workspace: ${wsLabel}`);

      const expired = isSessionExpired(session);
      console.log(
        `Session:   ${expired ? 'expired' : 'valid'} (expires ${session.expiresAt})`,
      );
    });
}
