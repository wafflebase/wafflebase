import { execFileSync } from 'node:child_process';
import { Client as PgClient } from 'pg';
import yorkie, { Client, SyncMode } from '@yorkie-js/sdk';
import { snapshotJsonRoot } from '../src/yorkie/yorkie-json';
import { yorkieServiceTokenInjector } from '../src/yorkie/yorkie-service-token';

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

/**
 * The auth-webhook token one side's attach carries, signed with the
 * `JWT_SECRET` of the backend that owns *that* side.
 *
 * Two rules, both deliberate:
 *
 * - **No fallback between the sides, and none to this process's own
 *   `JWT_SECRET`.** The source and target are different deployments with
 *   different secrets, and a service token grants read/write on *every*
 *   document of whichever deployment minted it. Defaulting the target to the
 *   secret in the running shell would therefore send deployment A's
 *   all-documents credential to deployment B's Yorkie server — silently, on
 *   the path an operator takes when they simply do not pass the flag.
 * - **Read from the environment, not argv.** A secret on the command line is
 *   readable by any local process through `/proc/<pid>/cmdline` and is echoed
 *   into shell history and CI logs.
 *
 * Warns rather than throws when a side's secret is missing: a copy between two
 * local Yorkies with no webhook methods registered has nothing to
 * authenticate to, and failing there would break a working workflow for a
 * token nobody reads.
 */
function sideTokenInjector(
  side: 'source' | 'target',
  envVar: 'SOURCE_JWT_SECRET' | 'TARGET_JWT_SECRET',
): (() => Promise<string>) | undefined {
  const secret = process.env[envVar];
  if (!secret) {
    console.warn(
      `${envVar} is unset, so the ${side} attach carries no auth token; it ` +
        'will be denied wherever the Yorkie auth webhook is registered. Set ' +
        `${envVar} to the ${side} deployment's own JWT_SECRET.`,
    );
    return undefined;
  }
  return yorkieServiceTokenInjector(secret);
}

type YorkieRoot = Record<string, unknown>;

function usage(): string {
  return `Usage:
  pnpm --filter @wafflebase/backend exec tsx scripts/copy-yorkie-documents.ts \\
    --database-url <postgres-url> \\
    --mongo-url <mongo-url> \\
    --project-public-key <public-key> \\
    --source-rpc-addr <source-rpc-addr> \\
    --source-api-key <source-api-key> \\
    --target-rpc-addr <target-rpc-addr> \\
    [--limit <count>] [--document <id> ...]

The auth-webhook token each attach carries is signed with that side's own
JWT_SECRET, read from the environment as SOURCE_JWT_SECRET and
TARGET_JWT_SECRET. There is no fallback between the two and none to this
process's JWT_SECRET: a service token grants read/write on every document of
the deployment that minted it, so a default would hand one side's credential
to the other side's server. A side whose variable is unset attaches
anonymously and is denied wherever the auth webhook is registered.`;
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
    // Three-tier snapshot (toJSON -> stringify(root) -> proxy walk), shared
    // with the backend's "Make a copy" service.
    const snapshot = snapshotJsonRoot(sourceDoc) as YorkieRoot;

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
  // Each attach authenticates to *its own* side's auth webhook as that
  // backend: enforcement is the default, so an anonymous attach is refused
  // wherever the methods are registered. The secrets never cross — see
  // `sideTokenInjector`.
  const sourceClient = new yorkie.Client({
    rpcAddr: options.sourceRpcAddr,
    apiKey: options.sourceApiKey,
    authTokenInjector: sideTokenInjector('source', 'SOURCE_JWT_SECRET'),
  });
  const targetClient = new yorkie.Client({
    rpcAddr: options.targetRpcAddr,
    authTokenInjector: sideTokenInjector('target', 'TARGET_JWT_SECRET'),
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
