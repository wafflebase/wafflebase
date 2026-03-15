import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { loadSession, isSessionExpired } from './session.js';

export const DEFAULT_SERVER = 'https://wafflebase-api.yorkie.dev';

export interface CliConfig {
  server: string;
  apiKey: string;
  workspace: string;
  authMode: 'api-key' | 'jwt' | 'none';
  accessToken?: string;
  refreshToken?: string;
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
    process.stderr.write(
      `[wafflebase] Config migrated from ${oldPath} to ${newPath}\n`,
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
 * Resolve CLI configuration from flags > env > session > config file.
 *
 * Auth resolution order:
 * 1. Flag/env `--api-key` or `WAFFLEBASE_API_KEY` → API key auth
 * 2. Session `~/.wafflebase/session.json` exists and token valid → JWT auth
 * 3. Config profile `api-key` → API key auth
 * 4. None → empty (commands will fail)
 */
export function resolveConfig(flags: {
  server?: string;
  apiKey?: string;
  workspace?: string;
  profile?: string;
}): CliConfig {
  const profile = loadProfile(flags.profile ?? 'default');

  // Step 1: Check flags/env for API key
  const flagOrEnvApiKey =
    flags.apiKey ?? process.env.WAFFLEBASE_API_KEY ?? undefined;
  if (flagOrEnvApiKey) {
    return {
      server:
        flags.server ??
        process.env.WAFFLEBASE_SERVER ??
        profile.server ??
        DEFAULT_SERVER,
      apiKey: flagOrEnvApiKey,
      workspace:
        flags.workspace ??
        process.env.WAFFLEBASE_WORKSPACE ??
        profile.workspace ??
        '',
      authMode: 'api-key',
    };
  }

  // Step 2: Try session
  const session = loadSession();
  if (session && !isSessionExpired(session)) {
    return {
      server:
        flags.server ??
        process.env.WAFFLEBASE_SERVER ??
        session.server ??
        profile.server ??
        DEFAULT_SERVER,
      apiKey: '',
      workspace:
        flags.workspace ??
        process.env.WAFFLEBASE_WORKSPACE ??
        session.activeWorkspace ??
        profile.workspace ??
        '',
      authMode: 'jwt',
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    };
  }

  // Step 3: Fallback to config profile API key
  const profileApiKey = profile['api-key'];
  if (profileApiKey) {
    return {
      server:
        flags.server ??
        process.env.WAFFLEBASE_SERVER ??
        profile.server ??
        DEFAULT_SERVER,
      apiKey: profileApiKey,
      workspace:
        flags.workspace ??
        process.env.WAFFLEBASE_WORKSPACE ??
        profile.workspace ??
        '',
      authMode: 'api-key',
    };
  }

  // Step 4: Nothing available
  return {
    server:
      flags.server ??
      process.env.WAFFLEBASE_SERVER ??
      profile.server ??
      DEFAULT_SERVER,
    apiKey: '',
    workspace:
      flags.workspace ??
      process.env.WAFFLEBASE_WORKSPACE ??
      profile.workspace ??
      '',
    authMode: 'none',
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
