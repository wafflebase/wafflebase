'use strict';

// Cold-start smoke for the production backend image (CI: verify-backend-image).
//
// It drives the compiled `DuckDbService` from `dist/` rather than the DuckDB
// client directly, so it exercises the exact initialization the server runs
// on its first lakehouse request: INSTALL on a throwaway instance, LOAD on the
// pooled instance, then the hardening `SET`s. Run against a fresh container
// filesystem this is the only place that reproduces "first request after a
// cold start" — a developer machine already has the extensions cached, which
// hides the class of failure this guards against (extension download marking
// DuckDB's Secret Manager as used before `SET allow_persistent_secrets`).
//
// Usage (from /app/packages/backend inside the image):
//   node test/smoke-duckdb-runtime.cjs

require('reflect-metadata');

const REQUIRED_EXTENSIONS = ['httpfs', 'iceberg', 'delta', 'azure'];

async function main() {
  const { DuckDbService } = require('../dist/lakehouse/duckdb.service.js');
  const service = new DuckDbService();

  try {
    // First call on a cold filesystem: downloads + hardening. Second call
    // proves the pooled instance is reusable rather than rebuilt per request:
    // both calls must be served by the same pooled connection object.
    const servedBy = new Set();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const rows = await service.withConnection(async (connection) => {
        servedBy.add(connection);
        const reader = await connection.runAndReadAll(
          "SELECT extension_name, loaded FROM duckdb_extensions() WHERE extension_name IN ('httpfs', 'iceberg', 'delta', 'azure') ORDER BY extension_name",
        );
        return reader.getRowObjectsJson();
      });
      const loaded = new Set(
        rows
          .filter(({ loaded: isLoaded }) => isLoaded === true)
          .map(({ extension_name: extensionName }) => extensionName),
      );
      const missing = REQUIRED_EXTENSIONS.filter(
        (extension) => !loaded.has(extension),
      );
      if (missing.length > 0) {
        throw new Error(
          `attempt ${attempt}: DuckDB extensions failed to load: ${missing.join(', ')}`,
        );
      }
    }

    if (servedBy.size !== 1) {
      throw new Error(
        `expected one pooled connection to serve both attempts, saw ${servedBy.size}`,
      );
    }

    process.stdout.write(
      `DuckDB runtime initialized: ${REQUIRED_EXTENSIONS.join(', ')}\n`,
    );
  } finally {
    await service.onModuleDestroy();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`DuckDB runtime smoke failed: ${message}\n`);
  process.exitCode = 1;
});
