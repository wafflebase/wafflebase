import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { AuthService } from '../../auth/auth.service';
import { sessionCookieName } from '../../auth/oauth-state';
import { PrismaService } from '../../database/prisma.service';
import { parseReviewerIds } from '../template-review';
import { TemplateService } from '../template.service';
import { TEMPLATE_CATALOG } from './catalog';
import { seedDocumentId } from './seed-templates';
import type { TemplateSeed } from './types';

/**
 * Register the seeded documents as public templates **through the product's
 * own UI** (docs/design/template-gallery.md).
 *
 *   pnpm backend register:templates \
 *     --author 1 --frontend http://localhost:5173 [--reset]
 *
 * Why a browser rather than the service calls `seed-templates.ts` used to
 * make: the thumbnail. Every renderer we have is in the browser, and a
 * template's picture is taken by whichever editor is mounted when the Share
 * dialog publishes it (`lib/thumbnail-capture.ts`). A headless publish has no
 * editor, so it has no picture — which is why the first pass at this seeded
 * ten cards that all fell back to a document-type icon.
 *
 * Driving the real dialog also means the seeded listings take exactly the
 * state transitions a person's would, including the ones that are easy to get
 * wrong from the outside: `thumbnailId` is a `CARD_FIELD`, so attaching it
 * after approval would send the listing back to review. Publishing through the
 * UI attaches it in the one window where that is not true — after the listing
 * exists, before it is submitted.
 *
 * The reviewer queue is driven the same way, and gets the content-watermark
 * handling for free: the queue row carries `contentAt` and the Approve button
 * echoes it, which is the whole of the check `review()` performs.
 */

const logger = new Logger('RegisterTemplates');

/** Mirrors `getDocumentPath` in the frontend. */
function documentPath(
  id: string,
  kind: TemplateSeed['content']['kind'],
): string {
  switch (kind) {
    case 'doc':
      return `/d/${id}`;
    case 'slides':
      return `/p/${id}`;
    case 'note':
      return `/n/${id}`;
    case 'board':
      return `/b/${id}`;
    default:
      return `/s/${id}`;
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Refuse to hand a real session token to a cleartext non-loopback origin.
 *
 * `--frontend` decides where the minted session cookie is installed and sent,
 * so a mistyped or pasted origin is a session token delivered somewhere it was
 * never meant to go — and over `http://` it also crosses the network in the
 * clear. The rule is the one this codebase already applies to its other
 * credential-bearing flow: `cliLoginAvailable()`
 * (`src/auth/github-auth.guard.ts`) allows a CLI sign-in only on a secure
 * origin or a loopback one, for the same reason.
 */
function assertTrustedFrontend(frontend: string): void {
  let url: URL;
  try {
    url = new URL(frontend);
  } catch {
    throw new Error(`--frontend is not a URL: ${frontend}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`--frontend must be http(s): ${frontend}`);
  }
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname === '::1';
  if (url.protocol === 'https:' || loopback) return;
  throw new Error(
    `Refusing to install a session cookie on ${url.origin}: it is neither ` +
      'https nor loopback, so the token would cross the network in the clear. ' +
      'Point --frontend at the https origin your users reach, or run the ' +
      'frontend on localhost.',
  );
}

/**
 * Playwright is a devDependency and only this command needs it, so it is
 * imported lazily — `seed:templates` and every runtime path stay free of it.
 */
async function loadPlaywright() {
  try {
    return (await import('playwright')) as typeof import('playwright');
  } catch {
    throw new Error(
      'This command drives a real browser and needs Playwright:\n' +
        '  pnpm --filter @wafflebase/frontend exec playwright install chromium',
    );
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const auth = app.get(AuthService);
    const templates = app.get(TemplateService);
    const config = app.get(ConfigService);

    const authorId = Number(arg('author') ?? process.env.SEED_AUTHOR_ID);
    const frontend = (
      arg('frontend') ??
      process.env.SEED_FRONTEND_URL ??
      'http://localhost:5173'
    ).replace(/\/$/, '');
    if (!Number.isSafeInteger(authorId) || authorId <= 0) {
      throw new Error(
        'Usage: pnpm backend register:templates --author <userId> [--frontend URL] [--reset]',
      );
    }
    assertTrustedFrontend(frontend);

    const user = await prisma.user.findUnique({ where: { id: authorId } });
    if (!user) throw new Error(`No such user: ${authorId}`);

    // Approving is reviewer-gated, and the queue page 403s for anyone else —
    // fail here rather than after publishing ten templates nobody can list.
    const reviewers = parseReviewerIds(
      config.get<string>('WAFFLEBASE_TEMPLATE_REVIEWER_IDS'),
    );
    if (!reviewers.has(authorId)) {
      throw new Error(
        `User ${authorId} is not in WAFFLEBASE_TEMPLATE_REVIEWER_IDS, so this run ` +
          'could publish templates but never approve them.',
      );
    }
    if (config.get<string>('YORKIE_AUTH_WEBHOOK_ENFORCE') !== 'true') {
      throw new Error(
        'The public tier requires YORKIE_AUTH_WEBHOOK_ENFORCE=true.',
      );
    }

    const reset = process.argv.includes('--reset');

    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      // The same cookie the OAuth callback writes. Minting it here is the one
      // step of the real flow this cannot reproduce — GitHub's consent screen
      // is not automatable — and it is the *only* one: everything after this
      // is the product's own UI, reached as a signed-in user.
      //
      // The shape follows the *name*. `sessionCookieName()` prefixes `__Host-`
      // on any deployment with secure cookies, and a `__Host-` cookie is only
      // accepted with `Secure`, `Path=/` and **no `Domain`** — so setting a
      // domain, as this first did, makes the browser silently discard it and
      // the run proceeds signed out. Deriving it from the prefix keeps the two
      // in step without exporting the backend's private `isSecureCookie()`.
      const name = sessionCookieName();
      const hostPrefixed = name.startsWith('__Host-');
      await context.addCookies([
        {
          name,
          value: auth.createTokens(user).accessToken,
          // `url` in both branches, so the cookie is **host-only** either way.
          // A `domain=` cookie is also sent to every subdomain, which is more
          // reach than a seeding run needs; `__Host-` forbids it outright and
          // the plain-name branch simply has no reason to want it.
          url: frontend,
          ...(hostPrefixed ? { secure: true } : {}),
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      // Asserted, because a rejected cookie is otherwise invisible until the
      // first page times out 60s later looking for a Share button that a
      // signed-out visitor never gets.
      const stored = await context.cookies(frontend);
      if (!stored.some((c) => c.name === name)) {
        throw new Error(
          `The browser rejected the session cookie '${name}'. ` +
            `A '__Host-' cookie needs an https origin; --frontend is ${frontend}.`,
        );
      }

      const page = await context.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error') logger.warn(`[page] ${m.text()}`);
      });
      // Every refusal in this flow is reported to the user as a toast and
      // swallowed otherwise, so a failed request is invisible from the outside
      // unless it is logged here. Worth keeping: when this script breaks, the
      // server's own message is the first thing anyone wants.
      page.on('response', (res) => {
        if (res.status() < 400) return;
        void res
          .text()
          .catch(() => '')
          .then((body) =>
            logger.warn(
              `[http ${res.status()}] ${res.request().method()} ${res.url()} ${body.slice(0, 400)}`,
            ),
          );
      });

      let registered = 0;
      for (const seed of TEMPLATE_CATALOG) {
        // Registering is not idempotent and cannot be: the Share dialog shows
        // the listing form instead of the publish block once a listing exists,
        // and `submit` refuses a listing that is already public. Skipping is
        // the honest outcome — the alternative was a 30s selector timeout that
        // named nothing.
        const existing = await prisma.templateListing.findUnique({
          where: { documentId: seedDocumentId(seed.slug) },
        });
        if (existing && !reset) {
          logger.log(
            `${seed.slug}: already listed (${existing.visibility}/${existing.status}) — skipping. Pass --reset to re-register.`,
          );
          continue;
        }
        if (existing) {
          // Unpublished here, one template at a time, rather than clearing the
          // whole catalogue before the browser starts. `unpublish` also revokes
          // the preview share link and nothing restores it, so a failure part
          // way through used to leave every *later* template withdrawn as well.
          // This bounds that to the one being re-registered.
          //
          // Not made transactional: `unpublish` deletes the row and destroys
          // the share link, and a republish mints a new token regardless — so a
          // "restored" listing would be a different capability to everyone
          // holding the old link. Bounding the blast radius is the honest fix;
          // pretending it can be rolled back is not.
          await templates.unpublish(existing.id, authorId);
          logger.log(`${seed.slug}: unpublished`);
        }
        // Publish, submit **and approve** before touching the next seed.
        //
        // Approving the whole batch at the end left every submitted listing
        // `pending` if approval failed — which is the same "one failure
        // withdraws templates it never touched" shape as the pre-browser
        // `--reset`, just moved to the other end of the run. Carrying each
        // template all the way to `public` first means a failure costs the one
        // in flight; everything before it is already live.
        await registerOne(page, frontend, seed);
        await assertListingState(prisma, page, seed, { status: 'pending' });
        await approveOne(page, frontend, seed.title);
        await assertListingState(prisma, page, seed, {
          status: 'listed',
          visibility: 'public',
        });
        registered += 1;
        logger.log(`${seed.slug}: published, submitted and approved`);
      }

      logger.log(`${registered} template(s) are public and listed.`);
    } finally {
      await browser.close();
    }
  } finally {
    await app.close();
  }
}

type Page = import('playwright').Page;

/** Publish one seeded document as a template and submit it for review. */
async function registerOne(
  page: Page,
  frontend: string,
  seed: TemplateSeed,
): Promise<void> {
  const documentId = seedDocumentId(seed.slug);
  // NOT `networkidle`: every editor route holds a Yorkie connection open, so
  // the network never goes idle and the wait times out at 30s on a page that
  // finished loading immediately. The Share button is the real readiness
  // signal anyway — it means the editor mounted.
  await page.goto(`${frontend}${documentPath(documentId, seed.content.kind)}`, {
    waitUntil: 'domcontentloaded',
  });

  // The editor has to be mounted before the Share dialog is opened, not just
  // the route: the thumbnail source is registered by the editor, and
  // "Publish as template" captures whatever is registered at that moment.
  await page.waitForSelector('[aria-label="Share"]', { timeout: 60_000 });
  await page.click('[aria-label="Share"]');

  const description = page.locator('#template-publish-description');
  await description.waitFor({ timeout: 30_000 });
  await description.fill(seed.description);

  await page.getByRole('button', { name: 'Publish as template' }).click();

  // Publishing is two requests — the listing, then the thumbnail — and the
  // editor form only replaces the publish block once the first has returned.
  // Waiting for the *thumbnail chip* instead waits for both.
  await page
    .locator('#template-description')
    .waitFor({ state: 'visible', timeout: 60_000 });
  // Scoped to the dialog. A bare `img[alt=""]` is page-wide, so the first
  // decorative image added to an editor shell would satisfy it and report a
  // thumbnail that was never captured.
  await page
    .locator('[role="dialog"] img[alt=""]')
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 })
    .catch(() => {
      // A thumbnail is decoration and its capture is best-effort in the
      // product too; say so rather than failing the registration.
      logger.warn(`${seed.slug}: no thumbnail was captured`);
    });

  // Category and tags live on the listing form, which only exists after the
  // publish above.
  if (seed.category) {
    await page.click('#template-category');
    await page
      .getByRole('option', { name: seed.category, exact: true })
      .click();
  }
  await page.fill('#template-tags', seed.tags.join(', '));
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await page
    .getByRole('button', { name: /Submit for review|Submit again/ })
    .click();
  // No sleep here: the caller polls for `status: 'pending'`, which is the
  // outcome this click is supposed to produce.
}

/**
 * Read back what the UI actually achieved.
 *
 * Clicking a button is not evidence the request behind it succeeded — the
 * product reports every one of these failures as a toast and carries on, so a
 * script that only clicks reports ten successes while the server refuses all
 * ten. (It did, the first time this ran: the public-tier gates are read by the
 * *server*, and the run had them set only in its own environment.)
 */
async function assertListingState(
  prisma: PrismaService,
  page: Page,
  seed: TemplateSeed,
  expected: { status: string; visibility?: string },
): Promise<void> {
  // Polled, not read once. A click returns as soon as the handler starts, and
  // the request behind it lands whenever it lands — an earlier version slept a
  // fixed 500ms instead and passed ten times, then failed on the first
  // template of the next run. Waiting for the outcome is the only version of
  // this that is not a race.
  const deadline = Date.now() + 20_000;
  let listing: Awaited<
    ReturnType<PrismaService['templateListing']['findUnique']>
  > = null;
  for (;;) {
    listing = await prisma.templateListing.findUnique({
      where: { documentId: seedDocumentId(seed.slug) },
    });
    if (
      listing &&
      listing.status === expected.status &&
      (!expected.visibility || listing.visibility === expected.visibility)
    ) {
      return;
    }
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  // The server's own sentence is more useful than anything reconstructed
  // here, and it is on screen.
  const toast = await page
    .locator('[data-sonner-toast]')
    .last()
    .innerText()
    .catch(() => '');
  throw new Error(
    `${seed.slug}: expected status=${expected.status}` +
      `${expected.visibility ? ` visibility=${expected.visibility}` : ''}, got ` +
      `${listing ? `status=${listing.status} visibility=${listing.visibility}` : 'no listing'}` +
      `${toast ? `\n  the page said: ${toast.replace(/\s+/g, ' ').trim()}` : ''}`,
  );
}

/**
 * Approve one listing, by the title its queue row shows.
 *
 * Targeted rather than "approve everything pending" for two reasons. A
 * deployment's queue can hold a real user's submission, which this command has
 * no business deciding; and approving per template is what keeps a failure
 * bounded — see the call site.
 */
async function approveOne(
  page: Page,
  frontend: string,
  title: string,
): Promise<void> {
  await page.goto(`${frontend}/admin/templates`, {
    waitUntil: 'domcontentloaded',
  });
  // The queue fetches after mount, so the page is briefly a spinner with no
  // rows. Querying straight away found nothing and reported "approved 0" —
  // wait for the heading the loaded page renders, whether or not it has rows.
  await page.getByRole('heading', { name: 'Template review' }).waitFor({
    timeout: 60_000,
  });

  const row = page.locator('li').filter({ hasText: title });
  await row
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {
      throw new Error(
        `"${title}" never appeared in the review queue. It was submitted, so ` +
          'either the queue is filtered differently or the submission was ' +
          'decided by someone else.',
      );
    });
  await row.first().getByRole('button', { name: 'Approve' }).click();
  // The caller polls for `public`/`listed`, which is the outcome this click is
  // supposed to produce.
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
