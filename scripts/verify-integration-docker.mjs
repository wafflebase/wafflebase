import net from 'node:net';
import { spawn } from 'node:child_process';

const DEFAULT_MINIO_ENDPOINT = 'http://127.0.0.1:9000';
const DEFAULT_MINIO_ACCESS_KEY = 'minioadmin';
const DEFAULT_MINIO_SECRET_KEY = 'minioadmin';
const DEFAULT_MINIO_REGION = 'us-east-1';
const DEFAULT_AZURITE_ENDPOINT = 'http://127.0.0.1:10000/devstoreaccount1';

function parseDatabaseAddress() {
  const fallback = { host: 'localhost', port: 5432 };
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return fallback;

  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname || fallback.host;
    const port = parsed.port ? Number(parsed.port) : fallback.port;
    if (!Number.isFinite(port) || port <= 0) {
      return fallback;
    }
    return { host, port };
  } catch {
    return fallback;
  }
}

function run(command, args, { capture = false, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      stdio: capture ? 'pipe' : 'inherit',
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
    }

    child.once('error', (error) => {
      resolve({
        code: 1,
        stdout,
        stderr:
          stderr ||
          `[verify:integration:docker] Failed to run ${command}: ${error.message}`,
      });
    });

    child.once('exit', (code, signal) => {
      resolve({
        code: signal ? 1 : (code ?? 1),
        stdout,
        stderr,
      });
    });
  });
}

function isReachable(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finalize = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize(true));
    socket.once('timeout', () => finalize(false));
    socket.once('error', () => finalize(false));
    socket.connect(port, host);
  });
}

async function waitForDatabase(host, port, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const reachable = await isReachable(host, port);
    if (reachable) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

async function waitForHttpReady(
  url,
  timeoutMs = 30_000,
  isReady = (status) => status >= 200 && status < 300,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1_200),
      });
      if (isReady(response.status)) {
        return true;
      }
    } catch {
      // The service may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

const servicesStartedByScript = new Set();
let cleanupPromise = null;

function installSignalHandlers() {
  const handlers = new Map();
  const signals = ['SIGINT', 'SIGTERM'];

  for (const signal of signals) {
    const handler = () => {
      console.error(
        `[verify:integration:docker] Received ${signal}. ` +
          'Stopping locally started services before exit.',
      );
      void (async () => {
        const stopCode = await stopStartedServices(signal);
        const signalCode = signal === 'SIGINT' ? 130 : 143;
        process.exit(stopCode === 0 ? signalCode : 1);
      })();
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  };
}

async function stopStartedServices(reason) {
  if (servicesStartedByScript.size === 0) {
    return 0;
  }

  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      const services = [...servicesStartedByScript].reverse();
      const stopResult = await run('docker', ['compose', 'stop', ...services], {
        capture: true,
      });
      if (stopResult.code !== 0) {
        console.error(
          '[verify:integration:docker] Failed to stop locally started ' +
            `services (${services.join(', ')}) during cleanup (${reason}).`,
        );
        if (stopResult.stderr.trim()) {
          console.error(stopResult.stderr.trim());
        }
      }
      return stopResult.code;
    })();
  }

  return cleanupPromise;
}

async function isComposeServiceRunning(service) {
  const result = await run(
    'docker',
    ['compose', 'ps', '--status', 'running', '-q', service],
    { capture: true },
  );
  if (result.code !== 0) {
    console.error(
      `[verify:integration:docker] Could not inspect ${service} service state.`,
    );
    if (result.stderr.trim()) {
      console.error(result.stderr.trim());
    }
    return null;
  }
  return result.stdout.trim().length > 0;
}

async function startComposeServiceIfNeeded(service) {
  const wasRunning = await isComposeServiceRunning(service);
  if (wasRunning === null) {
    return false;
  }
  if (wasRunning) {
    console.log(
      `[verify:integration:docker] Reusing running ${service} service.`,
    );
    return true;
  }

  const upResult = await run('docker', ['compose', 'up', '-d', service]);
  if (upResult.code !== 0) {
    return false;
  }
  servicesStartedByScript.add(service);
  return true;
}

async function main() {
  const removeSignalHandlers = installSignalHandlers();
  let exitCode = 1;

  try {
    const composeCheck = await run('docker', ['compose', 'version'], {
      capture: true,
    });
    if (composeCheck.code !== 0) {
      console.error(
        '[verify:integration:docker] Docker Compose is required. ' +
          'Install/start Docker and retry.',
      );
      if (composeCheck.stderr.trim()) {
        console.error(composeCheck.stderr.trim());
      }
      return exitCode;
    }

    for (const service of ['postgres', 'minio', 'azurite']) {
      if (!(await startComposeServiceIfNeeded(service))) {
        return exitCode;
      }
    }

    const { host, port } = parseDatabaseAddress();
    const databaseReady = await waitForDatabase(host, port);
    if (!databaseReady) {
      console.error(
        '[verify:integration:docker] PostgreSQL did not become reachable at ' +
          `${host}:${port} within the timeout.`,
      );
      return exitCode;
    }

    const minioEndpoint =
      process.env.LAKEHOUSE_MINIO_ENDPOINT ?? DEFAULT_MINIO_ENDPOINT;
    const azuriteEndpoint =
      process.env.LAKEHOUSE_AZURITE_ENDPOINT ?? DEFAULT_AZURITE_ENDPOINT;
    const integrationEnv = {
      ...process.env,
      RUN_LAKEHOUSE_INTEGRATION_TESTS: 'true',
      LAKEHOUSE_MINIO_ENDPOINT: minioEndpoint,
      LAKEHOUSE_MINIO_ACCESS_KEY:
        process.env.LAKEHOUSE_MINIO_ACCESS_KEY ?? DEFAULT_MINIO_ACCESS_KEY,
      LAKEHOUSE_MINIO_SECRET_KEY:
        process.env.LAKEHOUSE_MINIO_SECRET_KEY ?? DEFAULT_MINIO_SECRET_KEY,
      LAKEHOUSE_MINIO_REGION:
        process.env.LAKEHOUSE_MINIO_REGION ?? DEFAULT_MINIO_REGION,
      LAKEHOUSE_AZURITE_ENDPOINT: azuriteEndpoint,
      LAKEHOUSE_ALLOWED_ENDPOINTS:
        process.env.LAKEHOUSE_ALLOWED_ENDPOINTS ??
        `${minioEndpoint},${azuriteEndpoint}`,
    };
    const readinessUrl = new URL(
      '/minio/health/ready',
      integrationEnv.LAKEHOUSE_MINIO_ENDPOINT,
    ).href;
    const minioReady = await waitForHttpReady(readinessUrl);
    if (!minioReady) {
      console.error(
        '[verify:integration:docker] MinIO did not become ready at ' +
          `${readinessUrl} within the timeout.`,
      );
      return exitCode;
    }

    // Azurite has no unauthenticated health route; any HTTP status below 500
    // (a 403 for the anonymous list call included) proves the listener is up.
    const azuriteReady = await waitForHttpReady(
      `${azuriteEndpoint}?comp=list`,
      30_000,
      (status) => status < 500,
    );
    if (!azuriteReady) {
      console.error(
        '[verify:integration:docker] Azurite did not become ready at ' +
          `${azuriteEndpoint} within the timeout.`,
      );
      return exitCode;
    }

    const integrationResult = await run('pnpm', ['verify:integration'], {
      env: integrationEnv,
    });
    exitCode = integrationResult.code;
  } finally {
    removeSignalHandlers();
    const stopCode = await stopStartedServices('finally');
    if (exitCode === 0 && stopCode !== 0) {
      exitCode = stopCode;
    }
  }

  return exitCode;
}

process.exit(await main());
