import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

interface ProfileConfig {
  server?: string;
  'api-key'?: string;
  workspace?: string;
}

interface ConfigFile {
  profiles?: Record<string, ProfileConfig>;
}

function getConfigPath(): string {
  return (
    process.env.WAFFLEBASE_CONFIG ??
    join(homedir(), '.config', 'wafflebase', 'config.yaml')
  );
}

function loadConfigFile(path: string): ConfigFile {
  if (!existsSync(path)) return {};
  try {
    return (parseYaml(readFileSync(path, 'utf-8')) as ConfigFile) ?? {};
  } catch {
    return {};
  }
}

function saveConfigFile(path: string, config: ConfigFile): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, stringifyYaml(config), 'utf-8');
}

export function registerAuthCommand(program: Command) {
  const auth = program.command('auth').description('Authentication management');

  auth
    .command('login')
    .description('Set up API key and server configuration')
    .option('--profile <name>', 'Profile name to configure', 'default')
    .option('--server <url>', 'Server URL')
    .option('--api-key <key>', 'API key')
    .option('--workspace <id>', 'Workspace ID')
    .action(async function (this: Command) {
      const opts = this.opts<{
        profile: string;
        server?: string;
        apiKey?: string;
        workspace?: string;
      }>();

      const profileName = opts.profile;
      const configPath = getConfigPath();
      const config = loadConfigFile(configPath);

      const existing = config.profiles?.[profileName] ?? {};

      let server = opts.server;
      let apiKey = opts.apiKey;
      let workspace = opts.workspace;

      // If any value is missing, prompt interactively
      if (!server || !apiKey || !workspace) {
        const rl = createInterface({
          input: process.stdin,
          output: process.stderr,
        });

        try {
          if (!server) {
            server = await rl.question(
              `Server URL [${existing.server ?? 'http://localhost:3000'}]: `,
            );
            if (!server) server = existing.server ?? 'http://localhost:3000';
          }

          if (!apiKey) {
            apiKey = await rl.question(
              `API key${existing['api-key'] ? ` [${existing['api-key'].slice(0, 12)}...]` : ''}: `,
            );
            if (!apiKey) apiKey = existing['api-key'] ?? '';
          }

          if (!workspace) {
            workspace = await rl.question(
              `Workspace ID${existing.workspace ? ` [${existing.workspace}]` : ''}: `,
            );
            if (!workspace) workspace = existing.workspace ?? '';
          }
        } finally {
          rl.close();
        }
      }

      config.profiles = config.profiles ?? {};
      config.profiles[profileName] = {
        server,
        'api-key': apiKey,
        workspace,
      };

      saveConfigFile(configPath, config);
      console.log(`Profile "${profileName}" saved to ${configPath}`);
    });
}
