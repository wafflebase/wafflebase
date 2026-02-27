import { PrismaService } from 'src/database/prisma.service';

export const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://wafflebase:wafflebase@localhost:5432/wafflebase';
export const TEST_JWT_SECRET = 'test-jwt-secret';

const runDbIntegrationTests =
  process.env.RUN_DB_INTEGRATION_TESTS === 'true';
export const describeDb = runDbIntegrationTests ? describe : describe.skip;

export function parseDatabaseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ''),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

export async function clearDatabase(prisma: PrismaService) {
  await prisma.shareLink.deleteMany();
  await prisma.dataSource.deleteMany();
  await prisma.document.deleteMany();
  await prisma.user.deleteMany();
}

export function createUserFactory(prisma: PrismaService, prefix = 'test') {
  let seq = 0;
  return () => {
    seq += 1;
    return prisma.user.create({
      data: {
        authProvider: 'github',
        username: `${prefix}-user-${seq}`,
        email: `${prefix}-user-${seq}@example.com`,
      },
    });
  };
}

export function setIntegrationEnvDefaults() {
  process.env.DATASOURCE_ENCRYPTION_KEY ??= TEST_ENCRYPTION_KEY;
  process.env.DATABASE_URL ??= DEFAULT_TEST_DATABASE_URL;
}

export function setAuthEnvDefaults() {
  process.env.JWT_SECRET ??= TEST_JWT_SECRET;
  process.env.FRONTEND_URL ??= 'http://localhost:5173';
  process.env.GITHUB_CLIENT_ID ??= 'test-client-id';
  process.env.GITHUB_CLIENT_SECRET ??= 'test-client-secret';
  process.env.GITHUB_CALLBACK_URL ??=
    'http://localhost:3000/auth/github/callback';
}
