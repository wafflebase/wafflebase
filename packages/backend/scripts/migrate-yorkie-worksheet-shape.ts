import { PrismaClient } from '@prisma/client';
import yorkie, { Client, Document, SyncMode } from '@yorkie-js/sdk';
import type { SpreadsheetDocument, Worksheet } from '@wafflebase/sheet';
import {
  migrateYorkieWorksheetShape,
  type WorksheetShapeMigrationKind,
  type WorksheetShapeMigrationResult,
} from '../src/yorkie/worksheet-shape-migration';

type DbDocument = {
  id: string;
  title: string;
};

type CliOptions = {
  documentIds: string[];
  processAll: boolean;
  limit?: number;
};

type MigrationSummary = {
  processed: number;
  changed: number;
  unchanged: number;
  byKind: Record<WorksheetShapeMigrationKind, number>;
  failures: string[];
};

function escapeControlCharsInJson(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;

  for (const char of input) {
    if (!inString) {
      output += char;
      if (char === '"') {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      output += char;
      inString = false;
      continue;
    }

    const code = char.charCodeAt(0);
    if (code < 0x20) {
      switch (char) {
        case '\b':
          output += '\\b';
          break;
        case '\f':
          output += '\\f';
          break;
        case '\n':
          output += '\\n';
          break;
        case '\r':
          output += '\\r';
          break;
        case '\t':
          output += '\\t';
          break;
        default:
          output += `\\u${code.toString(16).padStart(4, '0')}`;
          break;
      }
      continue;
    }

    output += char;
  }

  return output;
}

function parseJsonSnapshot(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (
      !(error instanceof SyntaxError) ||
      !error.message.includes('control character')
    ) {
      throw error;
    }

    return JSON.parse(escapeControlCharsInJson(value));
  }
}

function normalizeSnapshot(value: unknown): Record<string, unknown> {
  let current = value;

  while (typeof current === 'string') {
    current = parseJsonSnapshot(current);
  }

  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new Error('Yorkie document root snapshot is not an object');
  }

  return current as Record<string, unknown>;
}

function detachYorkieValue(value: unknown): unknown {
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }

  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => detachYorkieValue(item));
  }

  if (typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  return Object.fromEntries(
    entries.flatMap(([key, child]) => {
      const detached = detachYorkieValue(child);
      return detached === undefined ? [] : [[key, detached]];
    }),
  );
}

function printUsage(): void {
  console.log(`Usage:
  pnpm --filter @wafflebase/backend migrate:yorkie:worksheet-shape --document <id> [--document <id> ...]
  pnpm --filter @wafflebase/backend migrate:yorkie:worksheet-shape --all [--limit <count>]

Notes:
  - This command attaches Yorkie documents directly. It does not provide a side-effect-free dry-run.
  - Use --document first for sampling, then --all during the maintenance window.`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    documentIds: [],
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

  if (!options.processAll && options.documentIds.length === 0) {
    throw new Error('Pass --document <id> or --all to select documents');
  }

  if (options.processAll && options.documentIds.length > 0) {
    throw new Error('Use either --document or --all, not both');
  }

  return options;
}

async function loadDocuments(
  prisma: PrismaClient,
  options: CliOptions,
): Promise<DbDocument[]> {
  if (options.documentIds.length > 0) {
    return prisma.document.findMany({
      where: {
        id: {
          in: options.documentIds,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        title: true,
      },
    });
  }

  return prisma.document.findMany({
    orderBy: {
      createdAt: 'asc',
    },
    take: options.limit,
    select: {
      id: true,
      title: true,
    },
  });
}

function replaceYorkieWorksheet(
  targetSheets: Record<string, unknown>,
  tabId: string,
  worksheet: Worksheet,
): void {
  const { cells, ...rest } = worksheet;
  targetSheets[tabId] = structuredClone({
    ...rest,
    cells: {},
  });

  const targetWorksheet = targetSheets[tabId] as Record<string, unknown>;
  const targetCells = targetWorksheet.cells as Record<string, unknown>;

  for (const [cellKey, cell] of Object.entries(cells)) {
    targetCells[cellKey] = structuredClone(cell);
  }
}

function replaceYorkieRoot(
  root: Record<string, unknown>,
  next: SpreadsheetDocument,
): void {
  for (const key of Object.keys(root)) {
    delete root[key];
  }

  root.tabs = structuredClone(next.tabs);
  root.tabOrder = [...next.tabOrder];
  root.sheets = {};

  const targetSheets = root.sheets as Record<string, unknown>;
  for (const [tabId, worksheet] of Object.entries(next.sheets)) {
    replaceYorkieWorksheet(targetSheets, tabId, worksheet);
  }
}

async function migrateDocument(
  client: Client,
  documentId: string,
): Promise<WorksheetShapeMigrationResult> {
  const doc = new yorkie.Document<Record<string, unknown>>(`sheet-${documentId}`);
  await client.attach(doc, { syncMode: SyncMode.Manual });

  try {
    let rootSnapshot: unknown;
    try {
      rootSnapshot = normalizeSnapshot(JSON.parse(doc.toJSON()));
    } catch {
      try {
        rootSnapshot = normalizeSnapshot(
          JSON.parse(JSON.stringify(doc.getRoot())),
        );
      } catch {
        rootSnapshot = normalizeSnapshot(detachYorkieValue(doc.getRoot()));
      }
    }
    const result = migrateYorkieWorksheetShape(rootSnapshot);

    if (result.changed) {
      doc.update((root) => {
        replaceYorkieRoot(root as Record<string, unknown>, result.document);
      }, 'Migrate worksheet document to canonical tabbed cells schema');
      await client.sync(doc);
    }

    return result;
  } finally {
    await client.detach(doc);
  }
}

function summarizeKinds(summary: MigrationSummary): string {
  return [
    `current=${summary.byKind.current}`,
    `current-flat=${summary.byKind['current-flat']}`,
    `initialized-empty=${summary.byKind['initialized-empty']}`,
    `legacy-flat=${summary.byKind['legacy-flat']}`,
    `legacy-tabbed=${summary.byKind['legacy-tabbed']}`,
  ].join(', ');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const rpcAddr = process.env.YORKIE_RPC_ADDR ?? 'http://localhost:8080';
  const apiKey = process.env.YORKIE_API_KEY;
  const client = new yorkie.Client({ rpcAddr, apiKey });
  const summary: MigrationSummary = {
    processed: 0,
    changed: 0,
    unchanged: 0,
    byKind: {
      current: 0,
      'current-flat': 0,
      'initialized-empty': 0,
      'legacy-flat': 0,
      'legacy-tabbed': 0,
    },
    failures: [],
  };

  await client.activate();

  try {
    const documents = await loadDocuments(prisma, options);

    if (documents.length === 0) {
      console.log('No documents matched the requested scope.');
      return;
    }

    const foundIds = new Set(documents.map((document) => document.id));
    for (const requestedId of options.documentIds) {
      if (!foundIds.has(requestedId)) {
        console.warn(`Missing database document: ${requestedId}`);
      }
    }

    console.log(`Processing ${documents.length} document(s)...`);

    for (const document of documents) {
      try {
        const result = await migrateDocument(client, document.id);
        summary.processed += 1;
        summary.byKind[result.kind] += 1;
        if (result.changed) {
          summary.changed += 1;
        } else {
          summary.unchanged += 1;
        }

        console.log(
          [
            result.changed ? 'migrated' : 'current',
            document.id,
            JSON.stringify(document.title),
            `kind=${result.kind}`,
            `sheets=${result.summary.sheetCount}`,
            `migratedSheets=${result.summary.migratedSheetCount}`,
            `cells=${result.summary.cellCount}`,
          ].join(' '),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        summary.failures.push(`${document.id}: ${message}`);
        console.error(`failed ${document.id} ${JSON.stringify(document.title)} ${message}`);
      }
    }

    console.log('');
    console.log('Migration summary');
    console.log(`  processed: ${summary.processed}`);
    console.log(`  changed: ${summary.changed}`);
    console.log(`  unchanged: ${summary.unchanged}`);
    console.log(`  by kind: ${summarizeKinds(summary)}`);

    if (summary.failures.length > 0) {
      console.log('  failures:');
      for (const failure of summary.failures) {
        console.log(`    - ${failure}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await client.deactivate();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
