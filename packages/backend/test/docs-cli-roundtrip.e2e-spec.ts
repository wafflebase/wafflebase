/**
 * End-to-end docs CLI round-trip against a live backend + Yorkie.
 *
 * Walks the scenario from `docs/tasks/active/20260502-docs-cli-todo.md`
 * Phase 10:
 *   docs import sample.docx → docs content --format md →
 *   docs export <id> /tmp/out.pdf (`%PDF-` header) →
 *   docs export <id> /tmp/out.docx (`PK` header) →
 *   docs import /tmp/out.docx --replace <id> --yes → re-read content,
 *   confirm the heading text survives the round-trip.
 *
 * Gated on the same `RUN_YORKIE_INTEGRATION_TESTS=true` switch as
 * `docs-tree-attached.e2e-spec.ts`. Requires both Postgres and a
 * running Yorkie locally — `docker compose up -d` is enough. CI does
 * not enable this gate; this test exists as a local pre-commit
 * confidence check that the CLI talks to a real server end-to-end.
 *
 * The CLI is spawned via `tsx` from this repository's checkout so the
 * test exercises the same code paths the user runs (no separate built
 * binary). Auth is API-key only — JWT cookies don't survive a
 * cross-process spawn cleanly, and the design's auth contract for
 * `wafflebase` already covers the API-key path.
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

const HEADING_TEXT = 'Integration Test Heading';

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn the CLI through `tsx` so the test exercises the in-tree
 * source. `tsx` is already a CLI devDep; we resolve it from
 * `packages/cli/node_modules/.bin/tsx` to avoid relying on a global
 * install on the dev machine.
 */
function runCli(
  args: string[],
  env: Record<string, string>,
  stdin?: Buffer,
): Promise<CliResult> {
  return new Promise((resolveResult) => {
    const tsxBin = resolve(
      REPO_ROOT,
      'packages/cli/node_modules/.bin/tsx',
    );
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
      resolveResult({
        exitCode: signal ? 1 : (code ?? 1),
        stdout,
        stderr,
      });
    });
    if (stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

// Pre-generated docx fixture. Built by
// `pnpm --filter @wafflebase/cli exec tsx scripts/gen-sample-docx.mjs`.
// Pre-generation matters because importing `@wafflebase/docs` from
// inside ts-jest pulls in `JSZip` through a CJS interop path that
// `ts-jest` (with `module: commonjs`) compiles to `jszip_1.default()`,
// which crashes since `jszip` doesn't export a `default` field. The
// CLI's `tsx`-based execution doesn't have that problem, so we
// pre-build the bytes there and commit the result.
const SAMPLE_DOCX_PATH = resolve(
  __dirname,
  'fixtures/docs-cli-sample.docx',
);

describeFull('docs CLI round-trip', () => {
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
    await app.init();
    // Bind to a random port so the CLI can hit the server over real HTTP.
    await app.listen(0);
    const server = app.getHttpServer();
    const addr = server.address() as AddressInfo;
    port = addr.port;

    prisma = moduleRef.get(PrismaService);
    createUser = createUserFactory(prisma, 'docs-cli');
    await prisma.$connect();

    tempDir = mkdtempSync(join(tmpdir(), 'wfb-docs-cli-'));
  }, 30_000);

  beforeEach(async () => {
    await clearDatabase(prisma);
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    workspaceId = workspace.id;

    // Create an API key so the CLI can authenticate over HTTP. We seed
    // the row directly so we can capture the raw key without going
    // through the (cookie-authenticated) /workspaces endpoint.
    const { ApiKeyService } = await import('src/api-key/api-key.service');
    const service = moduleRef.get(ApiKeyService);
    const created = await service.create(
      owner.id,
      workspaceId,
      'docs-cli-roundtrip',
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
      // Pin a per-test config path so the spawned CLI doesn't read the
      // developer's real ~/.wafflebase/config.yaml.
      WAFFLEBASE_CONFIG: join(tempDir, 'config.yaml'),
    };
  }

  it('imports → reads content → exports pdf/docx → re-imports with --replace', async () => {
    // 1. Stream the pre-generated fixture through the CLI's stdin
    //    reader so we exercise the `-` path end-to-end.
    const docxBytes = readFileSync(SAMPLE_DOCX_PATH);

    const importResult = await runCli(
      ['docs', 'import', '-', '--title', 'IT'],
      cliEnv(),
      docxBytes,
    );
    expect(importResult.exitCode).toBe(0);
    const importBody = JSON.parse(importResult.stdout);
    expect(importBody.id).toBeTruthy();
    expect(importBody.title).toBe('IT');
    const docId = importBody.id as string;

    // 2. `docs content --format md` should contain the heading.
    const contentResult = await runCli(
      ['docs', 'content', docId, '--format', 'md'],
      cliEnv(),
    );
    expect(contentResult.exitCode).toBe(0);
    expect(contentResult.stdout).toContain(`# ${HEADING_TEXT}`);

    // 3. PDF export — `%PDF-` header.
    const pdfPath = join(tempDir, `out-${docId}.pdf`);
    const pdfResult = await runCli(
      ['docs', 'export', docId, pdfPath],
      cliEnv(),
    );
    expect(pdfResult.exitCode).toBe(0);
    expect(existsSync(pdfPath)).toBe(true);
    const pdfBytes = readFileSync(pdfPath);
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');

    // 4. DOCX export — ZIP (PK\x03\x04) header.
    const docxPath = join(tempDir, `out-${docId}.docx`);
    const docxResult = await runCli(
      ['docs', 'export', docId, docxPath],
      cliEnv(),
    );
    expect(docxResult.exitCode).toBe(0);
    expect(existsSync(docxPath)).toBe(true);
    const exportedDocxBytes = readFileSync(docxPath);
    expect(exportedDocxBytes[0]).toBe(0x50); // 'P'
    expect(exportedDocxBytes[1]).toBe(0x4b); // 'K'

    // 5. `docs import --replace` round-trips the same docx back into
    //    the existing document. After the replace, the markdown view
    //    should still surface the heading text.
    const replaceResult = await runCli(
      ['docs', 'import', docxPath, '--replace', docId, '--yes'],
      cliEnv(),
    );
    expect(replaceResult.exitCode).toBe(0);
    const replaceBody = JSON.parse(replaceResult.stdout);
    expect(replaceBody).toEqual({ id: docId, replaced: true });

    const reReadResult = await runCli(
      ['docs', 'content', docId, '--format', 'md'],
      cliEnv(),
    );
    expect(reReadResult.exitCode).toBe(0);
    expect(reReadResult.stdout).toContain(`# ${HEADING_TEXT}`);
  }, 60_000);
});
