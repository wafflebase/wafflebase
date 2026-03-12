import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';

export interface CliConfig {
  server: string;
  apiKey: string;
  workspace: string;
}

interface ProfileConfig {
  server?: string;
  'api-key'?: string;
  workspace?: string;
}

interface ConfigFile {
  profiles?: Record<string, ProfileConfig>;
}

/**
 * Resolve CLI configuration from flags > env > config file.
 */
export function resolveConfig(flags: {
  server?: string;
  apiKey?: string;
  workspace?: string;
  profile?: string;
}): CliConfig {
  const profile = loadProfile(flags.profile ?? 'default');

  return {
    server:
      flags.server ??
      process.env.WAFFLEBASE_SERVER ??
      profile.server ??
      'http://localhost:3000',
    apiKey:
      flags.apiKey ??
      process.env.WAFFLEBASE_API_KEY ??
      profile['api-key'] ??
      '',
    workspace:
      flags.workspace ??
      process.env.WAFFLEBASE_WORKSPACE ??
      profile.workspace ??
      '',
  };
}

function getConfigPath(): string {
  return (
    process.env.WAFFLEBASE_CONFIG ??
    join(homedir(), '.config', 'wafflebase', 'config.yaml')
  );
}

function loadProfile(name: string): ProfileConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = parseYaml(raw) as ConfigFile;
    return config?.profiles?.[name] ?? {};
  } catch {
    return {};
  }
}
