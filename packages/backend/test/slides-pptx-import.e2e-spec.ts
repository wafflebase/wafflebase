/**
 * End-to-end slides CLI round-trip against a live backend + Yorkie.
 *
 *   wafflebase slides import sample.pptx  →
 *   GET /api/v1/.../documents/<id>/content (slides body) →
 *   assert slide count + element histogram.
 *
 * Mirrors `docs-cli-roundtrip.e2e-spec.ts`. Gated by the same env
 * switches and skipped together with the rest of the integration
 * suite when those are off.
 *
 * The .pptx fixture is generated in `beforeAll` using the same
 * builder the slides package's unit tests use — a tiny synthetic
 * deck with 1 blank slide. Avoids committing a binary fixture and
 * keeps the test runnable in CI without any external file.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/database/prisma.service';
// Pull the fixture builder from the slides package — same code the
// slides parser tests exercise. The relative path side-steps the
// public `@wafflebase/slides` export surface, which intentionally
// hides test-only utilities.
import { buildMinimalPptx } from '../../slides/src/import/pptx/__fixtures__/build-minimal-pptx';
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

describeFull('slides CLI round-trip', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let createUser: ReturnType<typeof createUserFactory>;
  let port: number;

  let workspaceId: string;
  let apiKey: string;
  let tempDir: string;
  let pptxBytes: Buffer;
  let pptxPath: string;

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
    await app.listen(0);
    const server = app.getHttpServer();
    const addr = server.address() as AddressInfo;
    port = addr.port;

    prisma = moduleRef.get(PrismaService);
    createUser = createUserFactory(prisma, 'slides-cli');
    await prisma.$connect();

    tempDir = mkdtempSync(join(tmpdir(), 'wfb-slides-cli-'));

    // Build a tiny synthetic .pptx once. The CLI re-parses it per test
    // so the data is fresh, but the bytes themselves don't change.
    const arrayBuf = await buildMinimalPptx();
    pptxBytes = Buffer.from(arrayBuf);
    pptxPath = join(tempDir, 'sample.pptx');
    writeFileSync(pptxPath, pptxBytes);
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
      'slides-cli-roundtrip',
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

  it('imports a .pptx → creates a slides deck → readable via GET', async () => {
    const importResult = await runCli(
      ['slides', 'import', '-', '--title', 'IT Slides'],
      cliEnv(),
      pptxBytes,
    );
    expect(importResult.exitCode).toBe(0);
    const importBody = JSON.parse(importResult.stdout) as {
      id: string;
      title: string;
      report: Record<string, number>;
    };
    expect(importBody.id).toBeTruthy();
    expect(importBody.title).toBe('IT Slides');
    expect(importBody.report).toBeDefined();
    const docId = importBody.id;

    // Verify the deck metadata was persisted with type='slides'.
    const meta = await prisma.document.findUnique({ where: { id: docId } });
    expect(meta?.type).toBe('slides');
    expect(meta?.title).toBe('IT Slides');

    // Read the content back through the public API — confirms the
    // writeSlidesRoot pipeline landed the parsed deck inside Yorkie.
    const contentRes = await fetch(
      `http://127.0.0.1:${port}/api/v1/workspaces/${workspaceId}/documents/${docId}/content`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    expect(contentRes.ok).toBe(true);
    const content = (await contentRes.json()) as {
      meta: { title: string };
      themes: unknown[];
      masters: unknown[];
      layouts: unknown[];
      slides: { id: string; elements: unknown[] }[];
    };
    expect(content.meta.title).toBe('IT Slides');
    // Minimal fixture: 1 imported theme/master/layout + 1 blank slide.
    expect(content.themes.length).toBeGreaterThan(0);
    expect(content.masters.length).toBeGreaterThan(0);
    expect(content.layouts.length).toBeGreaterThan(0);
    expect(content.slides.length).toBe(1);
    expect(content.slides[0].elements).toEqual([]);
  }, 60_000);

  it('--replace overwrites an existing slides deck', async () => {
    // First, import to create the deck.
    const first = await runCli(
      ['slides', 'import', '-', '--title', 'Original'],
      cliEnv(),
      pptxBytes,
    );
    expect(first.exitCode).toBe(0);
    const { id } = JSON.parse(first.stdout) as { id: string };

    // Then re-import with --replace --yes against the same id.
    const replace = await runCli(
      ['slides', 'import', pptxPath, '--replace', id, '--yes'],
      cliEnv(),
    );
    expect(replace.exitCode).toBe(0);
    const body = JSON.parse(replace.stdout) as {
      id: string;
      replaced: boolean;
    };
    expect(body).toMatchObject({ id, replaced: true });
  }, 60_000);

  it('rejects a body shape mismatch (docs body to slides deck)', async () => {
    // Create a slides deck via the CLI first.
    const importResult = await runCli(
      ['slides', 'import', '-', '--title', 'Mismatch'],
      cliEnv(),
      pptxBytes,
    );
    const { id } = JSON.parse(importResult.stdout) as { id: string };

    // Now PUT a docs-shaped body — the controller's sniffer routes to
    // the docs arm, finds the document is type='slides', and returns 400.
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/workspaces/${workspaceId}/documents/${id}/content`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ blocks: [] }),
      },
    );
    expect(res.status).toBe(400);
  }, 60_000);
});
