import { Injectable } from '@nestjs/common';
import { User, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from 'src/database/prisma.service';

/**
 * A sign-in through one provider that would land in an account created by
 * another, back when the address behind it was never proven.
 *
 * Thrown by `findOrCreateUser` and turned into a refusal by the OAuth
 * callbacks (`?error=email_conflict`), never a 500. See `findOrCreateUser`
 * for why the merge is not simply allowed.
 */
export class EmailProviderConflictError extends Error {
  constructor(readonly existingProvider: string) {
    super(
      `This email already has a Wafflebase account created with ` +
        `${existingProvider}. Sign in with ${existingProvider} once to link ` +
        `it, then this provider will work too.`,
    );
    this.name = 'EmailProviderConflictError';
  }
}

/** How many times a taken slug is retried before the error is the caller's. */
const SLUG_ATTEMPTS = 5;

/**
 * The slug a new user's first workspace wants, before uniquification.
 *
 * A name with no ASCII alphanumerics (all-CJK, emoji, or an empty
 * `displayName`) reduces to nothing, which would produce the unroutable
 * `-s-workspace` — and produce it for *every* such name, so the second one
 * collides. `workspace` is the same neutral base `WorkspaceService` falls back
 * to.
 */
function workspaceSlugBase(username: string): string {
  const slug = username
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `${slug}-s-workspace` : 'workspace';
}

/** A slug no workspace holds yet. The first attempt may take the base itself. */
async function freeSlug(
  tx: Prisma.TransactionClient,
  base: string,
  attempt: number,
): Promise<string> {
  if (attempt === 0) {
    const taken = await tx.workspace.findUnique({ where: { slug: base } });
    if (!taken) return base;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

/** A unique-constraint violation on the workspace slug, and nothing else. */
function isSlugConflict(error: unknown): boolean {
  const { code, meta } = (error ?? {}) as {
    code?: unknown;
    meta?: { target?: unknown };
  };
  if (code !== 'P2002') return false;
  const target = meta?.target;
  const fields = Array.isArray(target) ? target : [target];
  return fields.some((field) => typeof field === 'string' && field.includes('slug'));
}

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async user(
    userWhereUniqueInput: Prisma.UserWhereUniqueInput,
  ): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: userWhereUniqueInput,
    });
  }

  async users(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.UserWhereUniqueInput;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<User[]> {
    const { skip, take, cursor, where, orderBy } = params;
    return this.prisma.user.findMany({
      skip,
      take,
      cursor,
      where,
      orderBy,
    });
  }

  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  /**
   * Sign in the user this verified email address belongs to, creating them
   * (and their first workspace) on first sight.
   *
   * **The caller must have verified the address with the provider.** The email
   * is the whole identity here — it is matched on alone, so the same person
   * signing in through GitHub and through Google reaches one account rather
   * than two — and a provider that hands over an address it never checked
   * would therefore be handing over somebody else's account.
   *
   * Both strategies check that now, but rows created *before* they did carry
   * no such proof: a GitHub primary address may be unverified, and by default
   * is, so an account squatted under an address its creator never owned is a
   * shape this database can already contain. `emailVerifiedAt` is what
   * separates the two populations — null means "created before the check, or
   * never re-proven since". A **cross-provider** sign-in into such a row is
   * refused rather than merged into: the legitimate owner signs in once with
   * the provider the row was created under, which stamps the column and opens
   * the merge, while a squatter who never owned the address cannot (the
   * verified-email check now stands in their way on that provider too).
   * Same-provider sign-in is unaffected, so nobody is locked out of their own
   * account.
   */
  async findOrCreateUser(data: Prisma.UserCreateInput): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        email: data.email,
      },
    });
    if (user) {
      if (user.emailVerifiedAt) return user;
      if (user.authProvider !== data.authProvider) {
        throw new EmailProviderConflictError(user.authProvider);
      }
      // The provider that created the row has now proven the address, so the
      // row joins the population a cross-provider sign-in may merge into.
      return this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }

    return this.createUserWithWorkspace(data);
  }

  /**
   * Create the user and their first workspace as one unit.
   *
   * The workspace slug is `@unique`, and it used to be derived straight from
   * the username with no collision handling at all — which was survivable
   * while usernames came from GitHub (themselves unique) and is not now that
   * Google supplies a `displayName`: two people called "Ada Lovelace" produce
   * the same slug, and any name with no ASCII alphanumerics (all-CJK, emoji)
   * produces the *same empty base* as every other such name. The second one
   * through hit a P2002 on the workspace insert after the user row had
   * already been written, so the login 500'd and left a user with no
   * workspace behind — permanently, since the next attempt finds that row and
   * returns it without ever retrying the workspace.
   *
   * So the two writes share a transaction (nothing survives a failure) and
   * the slug is uniquified the way `WorkspaceService.generateUniqueSlug`
   * already does it, retried on the unique-constraint race between the check
   * and the insert.
   */
  private async createUserWithWorkspace(
    data: Prisma.UserCreateInput,
  ): Promise<User> {
    const base = workspaceSlugBase(data.username);

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            // Every caller has verified the address (see `findOrCreateUser`),
            // so the row starts out in the mergeable population.
            data: { ...data, emailVerifiedAt: data.emailVerifiedAt ?? new Date() },
          });
          const slug = await freeSlug(tx, base, attempt);
          const workspace = await tx.workspace.create({
            data: { name: `${newUser.username}'s Workspace`, slug },
          });
          await tx.workspaceMember.create({
            data: {
              workspaceId: workspace.id,
              userId: newUser.id,
              role: 'owner',
            },
          });
          return newUser;
        });
      } catch (error) {
        // A slug taken between the lookup and the insert: retry with a fresh
        // suffix. Anything else — including a duplicate email, which means a
        // concurrent sign-in already created this user — is the caller's.
        if (!isSlugConflict(error) || attempt >= SLUG_ATTEMPTS) throw error;
      }
    }
  }

  async updateUser(params: {
    where: Prisma.UserWhereUniqueInput;
    data: Prisma.UserUpdateInput;
  }): Promise<User> {
    const { where, data } = params;
    return this.prisma.user.update({
      data,
      where,
    });
  }

  async deleteUser(where: Prisma.UserWhereUniqueInput): Promise<User> {
    return this.prisma.user.delete({
      where,
    });
  }
}
