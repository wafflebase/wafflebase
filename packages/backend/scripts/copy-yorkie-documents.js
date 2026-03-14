"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_child_process_1 = require("node:child_process");
const pg_1 = require("pg");
const sdk_1 = require("@yorkie-js/sdk");
function usage() {
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
function parseArgs(argv) {
    const options = {
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
    if (!options.databaseUrl ||
        !options.mongoUrl ||
        !options.projectPublicKey ||
        !options.sourceRpcAddr ||
        !options.sourceApiKey ||
        !options.targetRpcAddr) {
        throw new Error(usage());
    }
    return options;
}
async function fetchLocalDocumentIds(options) {
    if (options.documentIds.length > 0) {
        return options.documentIds;
    }
    const client = new pg_1.Client({
        connectionString: options.databaseUrl,
    });
    await client.connect();
    try {
        const result = await client.query(`
        select id
        from "Document"
        order by "createdAt" asc
        ${options.limit ? 'limit $1' : ''}
      `, options.limit ? [options.limit] : []);
        return result.rows.map((row) => row.id);
    }
    finally {
        await client.end();
    }
}
function fetchExistingYorkieKeys(mongoUrl, projectPublicKey, candidateKeys) {
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
    const stdout = (0, node_child_process_1.execFileSync)('mongosh', ['--quiet', mongoUrl, '--eval', evalScript], {
        encoding: 'utf8',
    });
    return JSON.parse(stdout.trim());
}
function replaceRoot(root, next) {
    for (const key of Object.keys(root)) {
        delete root[key];
    }
    for (const [key, value] of Object.entries(next)) {
        root[key] = value;
    }
}
async function copyDocument(sourceClient, targetClient, documentKey) {
    const sourceDoc = new sdk_1.default.Document(documentKey);
    const targetDoc = new sdk_1.default.Document(documentKey);
    await sourceClient.attach(sourceDoc, { syncMode: sdk_1.SyncMode.Manual });
    await targetClient.attach(targetDoc, { syncMode: sdk_1.SyncMode.Manual });
    try {
        let snapshot;
        try {
            snapshot = JSON.parse(sourceDoc.toJSON());
        }
        catch {
            snapshot = JSON.parse(JSON.stringify(sourceDoc.getRoot()));
        }
        targetDoc.update((root) => {
            replaceRoot(root, snapshot);
        }, `Copy ${documentKey} from source Yorkie`);
        await targetClient.sync(targetDoc);
    }
    finally {
        await sourceClient.detach(sourceDoc);
        await targetClient.detach(targetDoc);
    }
}
async function main() {
    const options = parseArgs(process.argv.slice(2));
    const sourceClient = new sdk_1.default.Client({
        rpcAddr: options.sourceRpcAddr,
        apiKey: options.sourceApiKey,
    });
    const targetClient = new sdk_1.default.Client({
        rpcAddr: options.targetRpcAddr,
    });
    await sourceClient.activate();
    await targetClient.activate();
    try {
        const documentIds = await fetchLocalDocumentIds(options);
        const candidateKeys = documentIds.map((id) => `sheet-${id}`);
        const existingKeys = fetchExistingYorkieKeys(options.mongoUrl, options.projectPublicKey, candidateKeys);
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
    }
    finally {
        await sourceClient.deactivate();
        await targetClient.deactivate();
    }
}
void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
//# sourceMappingURL=copy-yorkie-documents.js.map