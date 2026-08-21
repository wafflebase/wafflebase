'use strict';

// Downloads the DuckDB extensions the lakehouse connector needs into a fixed
// directory, at image build time, for the platform the image will run on.
//
// Design §6 lists extension auto-download as a limitation and says
// "locked-down networks must pre-bundle the extensions"; the risk table asks
// for the same. Running this in the runtime stage means the shipped image
// carries `httpfs`/`iceberg`/`delta`/`azure` and never has to reach
// extensions.duckdb.org to serve a read.
//
// Usage: node scripts/bundle-duckdb-extensions.cjs <directory>

const { DuckDBInstance } = require('@duckdb/node-api');

const REQUIRED_EXTENSIONS = ['httpfs', 'iceberg', 'delta', 'azure'];

async function main() {
  const directory = process.argv[2];
  if (!directory) {
    throw new Error('Usage: bundle-duckdb-extensions.cjs <directory>');
  }

  const instance = await DuckDBInstance.create(':memory:', {
    threads: '1',
    extension_directory: directory,
  });
  const connection = await instance.connect();
  try {
    for (const extension of REQUIRED_EXTENSIONS) {
      await connection.run(`INSTALL ${extension}`);
      // Loading here is the proof: a downloaded file that this platform
      // cannot load is a broken image, and better to fail the build than to
      // fail the first request in production.
      await connection.run(`LOAD ${extension}`);
    }
    process.stdout.write(
      `Bundled DuckDB extensions into ${directory}: ${REQUIRED_EXTENSIONS.join(', ')}\n`,
    );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to bundle DuckDB extensions: ${message}\n`);
  process.exitCode = 1;
});
