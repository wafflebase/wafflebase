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

    // `--reset` is cleanup, not part of the procedure being reproduced, so it
    // goes through the service directly. It exists because a listing that is
    // already public cannot be re-registered: `submit` refuses a public
    // listing, and changing its card sends it back to review instead.
    if (process.argv.includes('--reset')) {
      for (const seed of TEMPLATE_CATALOG) {
        const documentId = seedDocumentId(seed.slug);
        const listing = await prisma.templateListing.findUnique({
          where: { documentId },
        });
        if (!listing) continue;
        await templates.unpublish(listing.id, authorId);
        logger.log(`${seed.slug}: unpublished`);
      }
    }

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
      await context.addCookies([
        {
          name: sessionCookieName(),
          value: auth.createTokens(user).accessToken,
          // Cookies ignore the port, so one entry covers the frontend on 5173
          // and the API on 3000.
          domain: new URL(frontend).hostname,
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

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

      for (const seed of TEMPLATE_CATALOG) {
        await registerOne(page, frontend, seed);
        await assertListingState(prisma, page, seed, { status: 'pending' });
        logger.log(`${seed.slug}: published and submitted`);
      }

      const approved = await approveAll(page, frontend);
      for (const seed of TEMPLATE_CATALOG) {
        await assertListingState(prisma, page, seed, {
          status: 'listed',
          visibility: 'public',
        });
      }
      logger.log(`Approved ${approved} template(s); all are public and listed.`);
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
  await page
    .locator('img[alt=""]')
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

/** Approve everything sitting in the reviewer queue. */
async function approveAll(page: Page, frontend: string): Promise<number> {
  await page.goto(`${frontend}/admin/templates`, {
    waitUntil: 'domcontentloaded',
  });
  // The queue fetches after mount, so the page is briefly a spinner with no
  // rows. Querying straight away found nothing and reported "approved 0" —
  // wait for the heading the loaded page renders, whether or not it has rows.
  await page.getByRole('heading', { name: 'Template review' }).waitFor({
    timeout: 60_000,
  });

  let approved = 0;
  for (;;) {
    const button = page.getByRole('button', { name: 'Approve' }).first();
    if ((await button.count()) === 0) break;
    await button.click();
    // Each decision removes its row, so re-query rather than iterating a
    // snapshot of the list.
    await page.waitForTimeout(750);
    approved += 1;
    if (approved > TEMPLATE_CATALOG.length) {
      throw new Error('Approve loop did not terminate');
    }
  }
  return approved;
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
