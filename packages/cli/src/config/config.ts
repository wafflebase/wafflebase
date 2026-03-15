import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
 * Migrate config from old path (~/.config/wafflebase/config.yaml) to new path
 * (~/.wafflebase/config.yaml) if needed.
 */
export function migrateConfigIfNeeded(
  newPath: string,
  oldPath: string = join(homedir(), '.config', 'wafflebase', 'config.yaml'),
): void {
  if (existsSync(newPath)) return;
  if (!existsSync(oldPath)) return;

  try {
    mkdirSync(dirname(newPath), { recursive: true });
    copyFileSync(oldPath, newPath);
    console.log(
      `[wafflebase] Config migrated from ${oldPath} to ${newPath}`,
    );
  } catch {
    // Silent failure — migration is best-effort
  }
}

/**
 * Return the resolved config file path.
 * WAFFLEBASE_CONFIG env var overrides everything; otherwise defaults to
 * ~/.wafflebase/config.yaml (with migration from old ~/.config/wafflebase path).
 */
export function getConfigPath(): string {
  if (process.env.WAFFLEBASE_CONFIG) {
    return process.env.WAFFLEBASE_CONFIG;
  }

  const newPath = join(homedir(), '.wafflebase', 'config.yaml');
  migrateConfigIfNeeded(newPath);
  return newPath;
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
