import { execFileSync } from 'node:child_process';
import { Client as PgClient } from 'pg';
import yorkie, { Client, SyncMode } from '@yorkie-js/sdk';

type CliOptions = {
  databaseUrl: string;
  mongoUrl: string;
  projectPublicKey: string;
  sourceRpcAddr: string;
  sourceApiKey: string;
  targetRpcAddr: string;
  limit?: number;
  documentIds: string[];
};

type YorkieRoot = Record<string, unknown>;

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

function normalizeSnapshot(value: unknown): YorkieRoot {
  let current = value;

  while (typeof current === 'string') {
    current = parseJsonSnapshot(current);
  }

  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new Error('Yorkie document root snapshot is not an object');
  }

  return current as YorkieRoot;
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

function usage(): string {
  return `Usage:
  pnpm --filter @wafflebase/backend exec tsx scripts/copy-yorkie-documents.ts \\
    --database-url <postgres-url> \\
    --mongo-url <mongo-url> \\
    --project-public-key <public-key> \\
    --source-rpc-addr <source-rpc-addr> \\
    --source-api-key <source-api-key> \\
    --target-rpc-addr <target-rpc-addr> \\
    [--limit <count>] [--document <id> ...]`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    documentIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--help':
      case '-h':
        console.log(usage());
        process.exit(0);
      case '--database-url':
        options.databaseUrl = next;
        index += 1;
        break;
      case '--mongo-url':
        options.mongoUrl = next;
        index += 1;
        break;
      case '--project-public-key':
        options.projectPublicKey = next;
        index += 1;
        break;
      case '--source-rpc-addr':
        options.sourceRpcAddr = next;
        index += 1;
        break;
      case '--source-api-key':
        options.sourceApiKey = next;
        index += 1;
        break;
      case '--target-rpc-addr':
        options.targetRpcAddr = next;
        index += 1;
        break;
      case '--limit': {
        const limit = Number(next);
        if (!Number.isInteger(limit) || limit <= 0) {
          throw new Error('Expected a positive integer after --limit');
        }
        options.limit = limit;
        index += 1;
        break;
      }
      case '--document':
        if (!next) {
          throw new Error('Missing value after --document');
        }
        options.documentIds?.push(next);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (
    !options.databaseUrl ||
    !options.mongoUrl ||
    !options.projectPublicKey ||
    !options.sourceRpcAddr ||
    !options.sourceApiKey ||
    !options.targetRpcAddr
  ) {
    throw new Error(usage());
  }

  return options as CliOptions;
}

async function fetchLocalDocumentIds(options: CliOptions): Promise<string[]> {
  if (options.documentIds.length > 0) {
    return options.documentIds;
  }

  const client = new PgClient({
    connectionString: options.databaseUrl,
  });

  await client.connect();
  try {
    const result = await client.query<{ id: string }>(
      `
        select id
        from "Document"
        order by "createdAt" asc
        ${options.limit ? 'limit $1' : ''}
      `,
      options.limit ? [options.limit] : [],
    );
    return result.rows.map((row) => row.id);
  } finally {
    await client.end();
  }
}

function fetchExistingYorkieKeys(
  mongoUrl: string,
  projectPublicKey: string,
  candidateKeys: string[],
): string[] {
  if (candidateKeys.length === 0) {
    return [];
  }

  const evalScript = `
    const project = db.projects.findOne(
      { public_key: ${JSON.stringify(projectPublicKey)} },
      { _id: 1 },
    );
    if (!project) {
      throw new Error('Project not found for public key');
    }
    const docs = db.documents.find(
      { project_id: project._id, key: { $in: ${JSON.stringify(candidateKeys)} } },
      { _id: 0, key: 1 },
    ).toArray();
    print(JSON.stringify(docs.map(doc => doc.key)));
  `;

  const stdout = execFileSync(
    'mongosh',
    ['--quiet', mongoUrl, '--eval', evalScript],
    {
      encoding: 'utf8',
    },
  );

  return JSON.parse(stdout.trim()) as string[];
}

function replaceRoot(root: YorkieRoot, next: YorkieRoot): void {
  for (const key of Object.keys(root)) {
    delete root[key];
  }

  for (const [key, value] of Object.entries(next)) {
    root[key] = value;
  }
}

async function copyDocument(
  sourceClient: Client,
  targetClient: Client,
  documentKey: string,
): Promise<void> {
  const sourceDoc = new yorkie.Document<YorkieRoot>(documentKey);
  const targetDoc = new yorkie.Document<YorkieRoot>(documentKey);

  await sourceClient.attach(sourceDoc, { syncMode: SyncMode.Manual });
  await targetClient.attach(targetDoc, { syncMode: SyncMode.Manual });

  try {
    let snapshot: YorkieRoot;
    try {
      snapshot = normalizeSnapshot(JSON.parse(sourceDoc.toJSON()));
    } catch {
      try {
        // Some documents contain control characters that Yorkie's raw JSON
        // string path does not escape correctly, but JSON.stringify(root)
        // still produces a valid detached snapshot for most cases.
        snapshot = normalizeSnapshot(
          JSON.parse(JSON.stringify(sourceDoc.getRoot())),
        );
      } catch {
        snapshot = normalizeSnapshot(detachYorkieValue(sourceDoc.getRoot()));
      }
    }

    targetDoc.update((root) => {
      replaceRoot(root as YorkieRoot, snapshot);
    }, `Copy ${documentKey} from source Yorkie`);

    await targetClient.sync(targetDoc);
  } finally {
    await sourceClient.detach(sourceDoc);
    await targetClient.detach(targetDoc);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sourceClient = new yorkie.Client({
    rpcAddr: options.sourceRpcAddr,
    apiKey: options.sourceApiKey,
  });
  const targetClient = new yorkie.Client({
    rpcAddr: options.targetRpcAddr,
  });

  await sourceClient.activate();
  await targetClient.activate();

  try {
    const documentIds = await fetchLocalDocumentIds(options);
    const candidateKeys = documentIds.map((id) => `sheet-${id}`);
    const existingKeys = fetchExistingYorkieKeys(
      options.mongoUrl,
      options.projectPublicKey,
      candidateKeys,
    );
    const missingKeys = candidateKeys.filter((key) => !existingKeys.includes(key));

    console.log(`Local Postgres documents: ${documentIds.length}`);
    console.log(`Existing source Yorkie docs: ${existingKeys.length}`);
    if (missingKeys.length > 0) {
      console.log(`Missing source Yorkie docs: ${missingKeys.length}`);
    }

    for (const key of existingKeys) {
      await copyDocument(sourceClient, targetClient, key);
      console.log(`copied ${key}`);
    }

    if (missingKeys.length > 0) {
      console.log('Skipped keys without source Yorkie documents:');
      for (const key of missingKeys) {
        console.log(`  - ${key}`);
      }
    }
  } finally {
    await sourceClient.deactivate();
    await targetClient.deactivate();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
