/**
 * End-to-end notes CLI round-trip against a live backend + Yorkie.
 *
 * Exercises the note content path the unit tests cannot cover — in
 * particular `writeNoteRoot`'s create branch (fresh `new Text()` seeded and
 * edited inside a single `doc.update` for a brand-new note whose Yorkie
 * document does not yet exist):
 *
 *   notes import - (stdin markdown) → notes content --format md →
 *   notes export <id> /tmp/out.md → notes import /tmp/out.md --replace <id>
 *   --yes → re-read content, confirm the markdown survives the round-trip.
 *
 * Gated on the same `RUN_YORKIE_INTEGRATION_TESTS=true` switch as
 * `docs-cli-roundtrip.e2e-spec.ts`. Requires both Postgres and a running
 * Yorkie. Locally: `docker compose up -d`. In CI: the `verify-integration`
 * job runs Postgres as a service and starts the Yorkie container, with both
 * gates set, so this test runs there too.
 *
 * The CLI is spawned via `tsx` from this repository's checkout (API-key
 * auth), mirroring `docs-cli-roundtrip.e2e-spec.ts`.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/database/prisma.service';
import {
  applyGlobalBootstrap,
  clearDatabase,
  createUserFactory,
  createWorkspace,
  setIntegrationEnvDefaults,
  setAuthEnvDefaults,
} from './helpers/integration-helpers';

const runYorkieIntegrationTests =
  process.env.RUN_YORKIE_INTEGRATION_TESTS === 'true';
const runDbIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeFull =
  runYorkieIntegrationTests && runDbIntegrationTests
    ? describe
    : describe.skip;

const REPO_ROOT = resolve(__dirname, '../../..');
const CLI_BIN = resolve(REPO_ROOT, 'packages/cli/src/bin.ts');

const NOTE_MD = '# Integration Note\n\n- one\n- two\n\nBody paragraph.';

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(
  args: string[],
  env: Record<string, string>,
  stdin?: Buffer,
): Promise<CliResult> {
  return new Promise((resolveResult) => {
    const tsxBin = resolve(REPO_ROOT, 'packages/cli/node_modules/.bin/tsx');
    const child = spawn(tsxBin, [CLI_BIN, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', (err) => {
      resolveResult({ exitCode: 1, stdout, stderr: stderr + String(err) });
    });
    child.on('exit', (code, signal) => {
      resolveResult({ exitCode: signal ? 1 : (code ?? 1), stdout, stderr });
    });
    if (stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

describeFull('notes CLI round-trip', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let createUser: ReturnType<typeof createUserFactory>;
  let port: number;

  let workspaceId: string;
  let apiKey: string;
  let tempDir: string;

  beforeAll(async () => {
    setIntegrationEnvDefaults();
    setAuthEnvDefaults();
    process.env.YORKIE_RPC_ADDR ??= 'http://localhost:8080';

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    applyGlobalBootstrap(app);
    await app.init();
    await app.listen(0);
    const server = app.getHttpServer();
    const addr = server.address() as AddressInfo;
    port = addr.port;

    prisma = moduleRef.get(PrismaService);
    createUser = createUserFactory(prisma, 'notes-cli');
    await prisma.$connect();

    tempDir = mkdtempSync(join(tmpdir(), 'wfb-notes-cli-'));
  }, 30_000);

  beforeEach(async () => {
    await clearDatabase(prisma);
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    workspaceId = workspace.id;

    const { ApiKeyService } = await import('src/api-key/api-key.service');
    const service = moduleRef.get(ApiKeyService);
    const created = await service.create(
      owner.id,
      workspaceId,
      'notes-cli-roundtrip',
    );
    apiKey = created.key;
  });

  afterAll(async () => {
    await clearDatabase(prisma).catch(() => {});
    await app.close();
    await moduleRef.close();
  });

  function cliEnv(): Record<string, string> {
    return {
      WAFFLEBASE_SERVER: `http://127.0.0.1:${port}`,
      WAFFLEBASE_API_KEY: apiKey,
      WAFFLEBASE_WORKSPACE: workspaceId,
      WAFFLEBASE_CONFIG: join(tempDir, 'config.yaml'),
    };
  }

  it('imports (create branch) → reads content → exports md → re-imports with --replace', async () => {
    // 1. `notes import -` streams markdown through stdin, creating a brand-new
    //    note. This is the sole exercise of writeNoteRoot's create branch
    //    (fresh `new Text()` + edit for a not-yet-existing Yorkie document).
    const importResult = await runCli(
      ['notes', 'import', '-', '--title', 'NT'],
      cliEnv(),
      Buffer.from(NOTE_MD, 'utf-8'),
    );
    expect(importResult.exitCode).toBe(0);
    const importBody = JSON.parse(importResult.stdout);
    expect(importBody.id).toBeTruthy();
    expect(importBody.title).toBe('NT');
    const docId = importBody.id as string;

    // 2. `notes content --format md` should reproduce the markdown verbatim,
    //    proving the create-branch write actually persisted the Text.
    const contentResult = await runCli(
      ['notes', 'content', docId, '--format', 'md'],
      cliEnv(),
    );
    expect(contentResult.exitCode).toBe(0);
    expect(contentResult.stdout).toContain('# Integration Note');
    expect(contentResult.stdout).toContain('- one');

    // 3. `notes content --format json` returns the { content } envelope.
    const jsonResult = await runCli(
      ['notes', 'content', docId, '--format', 'json'],
      cliEnv(),
    );
    expect(jsonResult.exitCode).toBe(0);
    expect(JSON.parse(jsonResult.stdout).content).toBe(NOTE_MD);

    // 4. `notes export` writes the markdown to a file.
    const mdPath = join(tempDir, `out-${docId}.md`);
    const exportResult = await runCli(
      ['notes', 'export', docId, mdPath],
      cliEnv(),
    );
    expect(exportResult.exitCode).toBe(0);
    expect(existsSync(mdPath)).toBe(true);
    expect(readFileSync(mdPath, 'utf-8')).toContain('# Integration Note');

    // 5. `notes import --replace` round-trips the exported markdown back into
    //    the existing note (the edit branch), and the content survives.
    const replaceResult = await runCli(
      ['notes', 'import', mdPath, '--replace', docId, '--yes'],
      cliEnv(),
    );
    expect(replaceResult.exitCode).toBe(0);
    expect(JSON.parse(replaceResult.stdout)).toEqual({
      id: docId,
      replaced: true,
    });

    const reReadResult = await runCli(
      ['notes', 'content', docId, '--format', 'md'],
      cliEnv(),
    );
    expect(reReadResult.exitCode).toBe(0);
    expect(reReadResult.stdout).toContain('# Integration Note');
  }, 60_000);
});
