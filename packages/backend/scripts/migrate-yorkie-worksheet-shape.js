"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const sdk_1 = require("@yorkie-js/sdk");
const worksheet_shape_migration_1 = require("../src/yorkie/worksheet-shape-migration");
function printUsage() {
    console.log(`Usage:
  pnpm --filter @wafflebase/backend migrate:yorkie:worksheet-shape --document <id> [--document <id> ...]
  pnpm --filter @wafflebase/backend migrate:yorkie:worksheet-shape --all [--limit <count>]

Notes:
  - This command attaches Yorkie documents directly. It does not provide a side-effect-free dry-run.
  - Use --document first for sampling, then --all during the maintenance window.`);
}
function parseArgs(argv) {
    const options = {
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
async function loadDocuments(prisma, options) {
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
function replaceYorkieRoot(root, next) {
    for (const key of Object.keys(root)) {
        delete root[key];
    }
    root.tabs = next.tabs;
    root.tabOrder = next.tabOrder;
    root.sheets = next.sheets;
}
async function migrateDocument(client, documentId) {
    const doc = new sdk_1.default.Document(`sheet-${documentId}`);
    await client.attach(doc, { syncMode: sdk_1.SyncMode.Manual });
    try {
        const rootSnapshot = JSON.parse(doc.toJSON());
        const result = (0, worksheet_shape_migration_1.migrateYorkieWorksheetShape)(rootSnapshot);
        if (result.changed) {
            doc.update((root) => {
                replaceYorkieRoot(root, result.document);
            }, 'Migrate worksheet document to canonical tabbed cells schema');
            await client.sync(doc);
        }
        return result;
    }
    finally {
        await client.detach(doc);
    }
}
function summarizeKinds(summary) {
    return [
        `current=${summary.byKind.current}`,
        `initialized-empty=${summary.byKind['initialized-empty']}`,
        `legacy-flat=${summary.byKind['legacy-flat']}`,
        `legacy-tabbed=${summary.byKind['legacy-tabbed']}`,
    ].join(', ');
}
async function main() {
    const options = parseArgs(process.argv.slice(2));
    const prisma = new client_1.PrismaClient();
    const rpcAddr = process.env.YORKIE_RPC_ADDR ?? 'http://localhost:8080';
    const apiKey = process.env.YORKIE_API_KEY;
    const client = new sdk_1.default.Client({ rpcAddr, apiKey });
    const summary = {
        processed: 0,
        changed: 0,
        unchanged: 0,
        byKind: {
            current: 0,
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
                }
                else {
                    summary.unchanged += 1;
                }
                console.log([
                    result.changed ? 'migrated' : 'current',
                    document.id,
                    JSON.stringify(document.title),
                    `kind=${result.kind}`,
                    `sheets=${result.summary.sheetCount}`,
                    `migratedSheets=${result.summary.migratedSheetCount}`,
                    `cells=${result.summary.cellCount}`,
                ].join(' '));
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
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
    }
    finally {
        await client.deactivate();
        await prisma.$disconnect();
    }
}
void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
//# sourceMappingURL=migrate-yorkie-worksheet-shape.js.map