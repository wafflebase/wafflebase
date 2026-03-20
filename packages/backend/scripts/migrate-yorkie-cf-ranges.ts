import { PrismaClient } from '@prisma/client';
import yorkie, { Client, SyncMode } from '@yorkie-js/sdk';

type DbDocument = {
  id: string;
  title: string;
};

type CliOptions = {
  documentIds: string[];
  yorkieKeys: string[];
  processAll: boolean;
  limit?: number;
};

type MigrationSummary = {
  processed: number;
  changed: number;
  unchanged: number;
  failures: string[];
};

function printUsage(): void {
  console.log(`Usage:
  pnpm --filter @wafflebase/backend migrate:yorkie:cf-ranges --document <id> [--document <id> ...]
  pnpm --filter @wafflebase/backend migrate:yorkie:cf-ranges --yorkie-key <key> [--yorkie-key <key> ...]
  pnpm --filter @wafflebase/backend migrate:yorkie:cf-ranges --all [--limit <count>]

Migrates conditional format rules from single 'range' field to 'ranges' array.

Options:
  --document <id>    Migrate by database document ID (prefixes with "sheet-")
  --yorkie-key <key> Migrate by raw Yorkie document key (e.g. "sheet-xxx")
  --all              Migrate all documents in the database

Notes:
  - This command attaches Yorkie documents directly. It does not provide a side-effect-free dry-run.
  - Use --document first for sampling, then --all during the maintenance window.`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    documentIds: [],
    yorkieKeys: [],
    processAll: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--document') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value after --document');
      }
      options.documentIds.push(value);
      index += 1;
      continue;
    }

    if (arg === '--yorkie-key') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value after --yorkie-key');
      }
      options.yorkieKeys.push(value);
      index += 1;
      continue;
    }

    if (arg === '--all') {
      options.processAll = true;
      continue;
    }

    if (arg === '--limit') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('Expected a positive integer after --limit');
      }
      options.limit = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.processAll && options.documentIds.length === 0 && options.yorkieKeys.length === 0) {
    throw new Error('Pass --document <id>, --yorkie-key <key>, or --all to select documents');
  }

  if (options.processAll && (options.documentIds.length > 0 || options.yorkieKeys.length > 0)) {
    throw new Error('Use either --document/--yorkie-key or --all, not both');
  }

  return options;
}

async function loadDocuments(
  prisma: PrismaClient,
  options: CliOptions,
): Promise<DbDocument[]> {
  if (options.documentIds.length > 0) {
    return prisma.document.findMany({
      where: { id: { in: options.documentIds } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true },
    });
  }

  return prisma.document.findMany({
    orderBy: { createdAt: 'asc' },
    take: options.limit,
    select: { id: true, title: true },
  });
}

function migrateConditionalFormatRanges(
  root: Record<string, unknown>,
): boolean {
  const sheets = root.sheets as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!sheets) {
    return false;
  }

  let changed = false;
  for (const worksheet of Object.values(sheets)) {
    const rules = worksheet.conditionalFormats as
      | { length: number; [index: number]: Record<string, unknown> }
      | undefined;
    if (!rules || typeof rules.length !== 'number') {
      continue;
    }

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      // Yorkie CRDT proxy: 'in' operator doesn't work, use direct access
      if (rule.ranges) {
        continue;
      }
      const range = rule.range;
      if (range) {
        // Unwrap CRDT proxy to plain JS, then wrap as ranges array
        const plainRange = JSON.parse(JSON.stringify(range));
        rule.ranges = [plainRange];
        delete rule.range;
        changed = true;
      }
    }
  }

  return changed;
}

async function migrateDocumentByKey(
  client: Client,
  yorkieKey: string,
): Promise<{ changed: boolean }> {
  const doc = new yorkie.Document<Record<string, unknown>>(yorkieKey);
  await client.attach(doc, { syncMode: SyncMode.Manual });

  try {
    let changed = false;
    doc.update((root) => {
      changed = migrateConditionalFormatRanges(
        root as Record<string, unknown>,
      );
    }, 'Migrate conditional format range to ranges array');

    if (changed) {
      await client.sync(doc);
    }

    return { changed };
  } finally {
    await client.detach(doc);
  }
}

async function processYorkieKey(
  client: Client,
  yorkieKey: string,
  summary: MigrationSummary,
): Promise<void> {
  try {
    const result = await migrateDocumentByKey(client, yorkieKey);
    summary.processed += 1;
    if (result.changed) {
      summary.changed += 1;
      console.log(`migrated ${yorkieKey}`);
    } else {
      summary.unchanged += 1;
      console.log(`current ${yorkieKey}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.failures.push(`${yorkieKey}: ${message}`);
    console.error(`failed ${yorkieKey} ${message}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rpcAddr = process.env.YORKIE_RPC_ADDR ?? 'http://localhost:8080';
  const apiKey = process.env.YORKIE_API_KEY;
  const client = new yorkie.Client({ rpcAddr, apiKey });
  const summary: MigrationSummary = {
    processed: 0,
    changed: 0,
    unchanged: 0,
    failures: [],
  };

  await client.activate();

  try {
    // Collect all Yorkie keys to process
    const yorkieKeys: string[] = [...options.yorkieKeys];

    if (options.processAll || options.documentIds.length > 0) {
      const prisma = new PrismaClient();
      try {
        const documents = await loadDocuments(prisma, options);

        if (documents.length === 0 && options.yorkieKeys.length === 0) {
          console.log('No documents matched the requested scope.');
          return;
        }

        const foundIds = new Set(documents.map((document) => document.id));
        for (const requestedId of options.documentIds) {
          if (!foundIds.has(requestedId)) {
            console.warn(`Missing database document: ${requestedId}`);
          }
        }

        for (const document of documents) {
          yorkieKeys.push(`sheet-${document.id}`);
        }
      } finally {
        await prisma.$disconnect();
      }
    }

    if (yorkieKeys.length === 0) {
      console.log('No documents to process.');
      return;
    }

    console.log(`Processing ${yorkieKeys.length} document(s)...`);

    for (const yorkieKey of yorkieKeys) {
      await processYorkieKey(client, yorkieKey, summary);
    }

    console.log('');
    console.log('Migration summary');
    console.log(`  processed: ${summary.processed}`);
    console.log(`  changed: ${summary.changed}`);
    console.log(`  unchanged: ${summary.unchanged}`);

    if (summary.failures.length > 0) {
      console.log('  failures:');
      for (const failure of summary.failures) {
        console.log(`    - ${failure}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await client.deactivate();
  }
}

void main().catch((error) => {
  const message =
    error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
