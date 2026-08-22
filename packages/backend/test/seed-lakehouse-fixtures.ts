import {
  lakehouseMinioConfig,
  seedLakehouseFixtures,
} from './helpers/lakehouse-fixtures';

async function main(): Promise<void> {
  const config = lakehouseMinioConfig();
  const count = await seedLakehouseFixtures(config);
  process.stdout.write(
    `Seeded ${count} Lakehouse fixture objects into ` +
      `${config.endpoint}/${config.bucket}\n`,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to seed Lakehouse fixtures: ${message}\n`);
  process.exitCode = 1;
});
