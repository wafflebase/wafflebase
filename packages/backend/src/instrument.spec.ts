import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('@sentry/nestjs', () => ({ init: jest.fn() }));

const SENTRY_KEYS = [
  'SENTRY_DSN',
  'SENTRY_ENVIRONMENT',
  'SENTRY_RELEASE',
  'SENTRY_TRACES_SAMPLE_RATE',
] as const;

type InitOptions = {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
  sendDefaultPii?: boolean;
};

/**
 * `instrument.ts` does its work as a module side effect — that is the whole
 * point of it, since `main.ts` imports it for the effect before anything else
 * loads. So it is exercised by re-importing it under a given environment,
 * which needs the module registry reset each time.
 *
 * Returns the options `Sentry.init` was called with, or `undefined` when it
 * was never called at all.
 */
async function loadWith(
  env: Record<string, string | undefined>,
): Promise<InitOptions | undefined> {
  jest.resetModules();
  for (const key of SENTRY_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const Sentry = (await import('@sentry/nestjs')) as unknown as {
    init: jest.Mock<void, [InitOptions]>;
  };
  Sentry.init.mockClear();
  await import('./instrument');
  return Sentry.init.mock.calls[0]?.[0];
}

const DSN = 'https://key@o1.ingest.us.sentry.io/1';
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as {
    version: string;
  }
).version;
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('instrument', () => {
  /**
   * Unset must mean `init` is never CALLED. Calling it with a falsy dsn still
   * installs global handlers and patches `http`, so "off" would not be off.
   */
  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('does not initialize when SENTRY_DSN is %s', async (_label, dsn) => {
    await expect(loadWith({ SENTRY_DSN: dsn })).resolves.toBeUndefined();
  });

  it('initializes with the DSN and never enables PII', async () => {
    const options = await loadWith({ SENTRY_DSN: DSN });
    expect(options).toMatchObject({ dsn: DSN, sendDefaultPii: false });
  });

  /**
   * `value: ""` in a k8s manifest and a bare `SENTRY_ENVIRONMENT=` line are how
   * "unset" actually arrives. `??` would pass the empty string to the SDK.
   */
  it('treats an empty SENTRY_ENVIRONMENT as unset, falling back to NODE_ENV', async () => {
    const options = await loadWith({
      SENTRY_DSN: DSN,
      SENTRY_ENVIRONMENT: '',
      NODE_ENV: 'production',
    });
    expect(options?.environment).toBe('production');
  });

  it('prefers an explicit SENTRY_ENVIRONMENT', async () => {
    const options = await loadWith({
      SENTRY_DSN: DSN,
      SENTRY_ENVIRONMENT: 'staging',
      NODE_ENV: 'production',
    });
    expect(options?.environment).toBe('staging');
  });

  /**
   * The frontend bakes in the root package version. This package's version is
   * kept in lockstep with it, so with neither side configured both halves
   * report the same release and one deploy's events line up.
   */
  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])(
    'falls back to the package version when SENTRY_RELEASE is %s',
    async (_label, value) => {
      const options = await loadWith({
        SENTRY_DSN: DSN,
        SENTRY_RELEASE: value,
      });
      expect(options?.release).toBe(PACKAGE_VERSION);
    },
  );

  it('prefers an explicit SENTRY_RELEASE', async () => {
    const options = await loadWith({
      SENTRY_DSN: DSN,
      SENTRY_RELEASE: 'abc123',
    });
    expect(options?.release).toBe('abc123');
  });

  /**
   * A typo must not become "sample everything" — that is the direction that
   * costs money.
   */
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['out of range', '100'],
    ['negative', '-1'],
    ['not a number', 'yes please'],
  ])(
    'uses the default sample rate when the value is %s',
    async (_label, raw) => {
      const options = await loadWith({
        SENTRY_DSN: DSN,
        SENTRY_TRACES_SAMPLE_RATE: raw,
      });
      expect(options?.tracesSampleRate).toBe(0.1);
    },
  );

  it.each([
    ['0', 0],
    ['1', 1],
    ['0.25', 0.25],
  ])('honors a valid sample rate of %s', async (raw, expected) => {
    const options = await loadWith({
      SENTRY_DSN: DSN,
      SENTRY_TRACES_SAMPLE_RATE: raw,
    });
    expect(options?.tracesSampleRate).toBe(expected);
  });
});
