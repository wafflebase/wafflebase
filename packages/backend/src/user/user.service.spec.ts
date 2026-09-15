import { PrismaService } from '../database/prisma.service';
import { EmailProviderConflictError, UserService } from './user.service';

/**
 * Enough of Prisma to exercise sign-up: unique indexes on `User.email` and
 * `Workspace.slug`, and a `$transaction` that actually rolls back. The
 * rollback is the point of two of the assertions below — a failed workspace
 * insert used to leave the user row behind, and the next sign-in then found
 * that row and returned it without ever retrying the workspace.
 */
function makePrisma() {
  let users: Array<Record<string, unknown>> = [];
  let workspaces: Array<Record<string, unknown>> = [];
  let members: Array<Record<string, unknown>> = [];
  let nextUserId = 1;
  let nextWorkspaceId = 1;

  const unique = (target: string) =>
    Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: [target] },
    });

  const client = {
    user: {
      findUnique: ({ where }: { where: { email?: string; id?: number } }) =>
        Promise.resolve(
          users.find(
            (u) =>
              (where.email !== undefined && u.email === where.email) ||
              (where.id !== undefined && u.id === where.id),
          ) ?? null,
        ),
      create: ({ data }: { data: Record<string, unknown> }) => {
        if (users.some((u) => u.email === data.email)) {
          return Promise.reject(unique('email'));
        }
        const row = { id: nextUserId++, ...data };
        users.push(row);
        return Promise.resolve(row);
      },
      update: ({
        where,
        data,
      }: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        const row = users.find((u) => u.id === where.id)!;
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    },
    workspace: {
      findUnique: ({ where }: { where: { slug: string } }) =>
        Promise.resolve(workspaces.find((w) => w.slug === where.slug) ?? null),
      create: ({ data }: { data: Record<string, unknown> }) => {
        if (workspaces.some((w) => w.slug === data.slug)) {
          return Promise.reject(unique('slug'));
        }
        const row = { id: `ws-${nextWorkspaceId++}`, ...data };
        workspaces.push(row);
        return Promise.resolve(row);
      },
    },
    workspaceMember: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        members.push(data);
        return Promise.resolve(data);
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        users: [...users],
        workspaces: [...workspaces],
        members: [...members],
      };
      try {
        return await cb(client);
      } catch (error) {
        users = snapshot.users;
        workspaces = snapshot.workspaces;
        members = snapshot.members;
        throw error;
      }
    },
  };

  return {
    client: client as unknown as PrismaService,
    state: {
      users: () => users,
      workspaces: () => workspaces,
      members: () => members,
    },
  };
}

describe('UserService.findOrCreateUser', () => {
  function service() {
    const prisma = makePrisma();
    return { service: new UserService(prisma.client), ...prisma };
  }

  const google = (username: string, email: string) => ({
    authProvider: 'google',
    username,
    email,
  });

  it('creates the user, their workspace and their membership', async () => {
    const { service: users, state } = service();

    const user = await users.findOrCreateUser(google('Ada Lovelace', 'a@x.com'));

    expect(user!.email).toBe('a@x.com');
    expect(state.workspaces()[0].slug).toBe('ada-lovelace-s-workspace');
    expect(state.members()).toHaveLength(1);
    // Created from an address the strategy verified, so it is already in the
    // population a cross-provider sign-in may merge into.
    expect(user!.emailVerifiedAt).toBeInstanceOf(Date);
  });

  /**
   * Google's `username` is a `displayName`: not unique, and not restricted to
   * ASCII. Two people with the same name derived the same `@unique` slug, so
   * the second sign-up 500'd *after* writing the user row — leaving an
   * account with no workspace that no later attempt would repair.
   */
  it('gives a colliding display name its own workspace slug', async () => {
    const { service: users, state } = service();

    await users.findOrCreateUser(google('Ada Lovelace', 'a@x.com'));
    const second = await users.findOrCreateUser(
      google('Ada Lovelace', 'b@x.com'),
    );

    expect(second).not.toBeNull();
    const slugs = state.workspaces().map((w) => w.slug);
    expect(slugs).toHaveLength(2);
    expect(new Set(slugs).size).toBe(2);
    expect(slugs[1]).toMatch(/^ada-lovelace-s-workspace-[0-9a-f]{6}$/);
    expect(state.members()).toHaveLength(2);
  });

  // A name with no ASCII alphanumerics reduced to the *same* empty base for
  // everyone, which is both unroutable and a guaranteed collision.
  it('falls back to a neutral base for a name that slugs to nothing', async () => {
    const { service: users, state } = service();

    await users.findOrCreateUser(google('김철수', 'a@x.com'));
    await users.findOrCreateUser(google('🌊🧇', 'b@x.com'));

    const slugs = state.workspaces().map((w) => w.slug) as string[];
    expect(slugs[0]).toBe('workspace');
    expect(slugs[1]).toMatch(/^workspace-[0-9a-f]{6}$/);
  });

  it('leaves no user row behind when the workspace cannot be created', async () => {
    const { service: users, client, state } = service();
    const workspace = (client as unknown as {
      workspace: { create: (args: unknown) => Promise<unknown> };
    }).workspace;
    workspace.create = () => Promise.reject(new Error('database is down'));

    await expect(
      users.findOrCreateUser(google('Ada Lovelace', 'a@x.com')),
    ).rejects.toThrow('database is down');
    expect(state.users()).toHaveLength(0);
  });

  /**
   * The email is the identity both providers are matched on, so a row whose
   * address was never proven — every row created before the strategies read
   * the provider's verification flag — is not one a *different* provider may
   * be merged into. An unverified GitHub primary address could have squatted
   * somebody else's.
   */
  describe('cross-provider merge', () => {
    it('refuses an account this deployment never saw proven', async () => {
      const { service: users, state } = service();
      state.users().push({
        id: 1,
        authProvider: 'github',
        username: 'squatter',
        email: 'ada@example.com',
        emailVerifiedAt: null,
      });

      await expect(
        users.findOrCreateUser(google('Ada Lovelace', 'ada@example.com')),
      ).rejects.toBeInstanceOf(EmailProviderConflictError);
      expect(state.users()).toHaveLength(1);
    });

    // The legitimate owner opens it themselves: signing in again with the
    // provider the row was created under proves the address.
    it('stamps the row when its own provider signs in again', async () => {
      const { service: users, state } = service();
      state.users().push({
        id: 1,
        authProvider: 'github',
        username: 'ada',
        email: 'ada@example.com',
        emailVerifiedAt: null,
      });

      const stamped = await users.findOrCreateUser({
        authProvider: 'github',
        username: 'ada',
        email: 'ada@example.com',
      });
      expect(stamped!.emailVerifiedAt).toBeInstanceOf(Date);

      const merged = await users.findOrCreateUser(
        google('Ada Lovelace', 'ada@example.com'),
      );
      expect(merged!.id).toBe(1);
      // One account, one workspace — the merge is the point of matching on
      // email at all.
      expect(state.workspaces()).toHaveLength(0);
    });

    it('merges into an already proven account', async () => {
      const { service: users, state } = service();
      state.users().push({
        id: 1,
        authProvider: 'github',
        username: 'ada',
        email: 'ada@example.com',
        emailVerifiedAt: new Date(),
      });

      const merged = await users.findOrCreateUser(
        google('Ada Lovelace', 'ada@example.com'),
      );
      expect(merged!.id).toBe(1);
    });
  });
});
