import { Logger } from '@nestjs/common';
import type { TemplateListing } from '@prisma/client';
import { DOCUMENT_ROUTES } from '@wafflebase/core/document-link';
import { categoryLabel } from '@wafflebase/core/templates';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { AuthService } from '../../auth/auth.service';
import { sessionCookieName } from '../../auth/oauth-state';
import { PrismaService } from '../../database/prisma.service';
import { assertYorkieAuthEnforced, parseReviewerIds } from '../template-review';
import { TemplateService } from '../template.service';
import { TEMPLATE_CATALOG } from './catalog';
import { seedDocumentId } from './seed-hash';
import { registerRefusal } from './seed-routing';
import { cardDrift } from './template-sync';
import type { TemplateSeed } from './types';

/**
 * TEMPORARY — the operator path for the seed types `sync:templates` cannot
 * publish yet (docs/design/template-catalog-scaling.md §3).
 *
 * `sync:templates` publishes slides and note seeds headlessly, with
 * thumbnails rendered offline. Sheet, doc and board seeds have no offline
 * thumbnail renderer until Phase 2, and sync refuses to publish an icon-only
 * card, so this Playwright command remains their only path. It refuses slides
 * and note seeds outright, pointing at `sync:templates`. Delete this file, its
 * package.json scripts and the backend Playwright devDependency once the
 * Phase 2 renderers land.
 *
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
 * Approval is **not** driven through the queue page. The page identifies a
 * row only by its title — no listing id reaches the DOM — and shows the 100
 * oldest submissions, so a seed's own row can be cut off while a stranger's
 * identically titled submission is the one match. The operator already holds
 * the database, so it approves in-process the way `sync:templates` does:
 * through `TemplateService.review()`, by the listing id it just published,
 * echoing the content watermark it read — the same `contentAt` check the
 * queue's Approve button feeds, with no title in the loop.
 */

const logger = new Logger('RegisterTemplates');

/** The editor route the Share dialog lives on, as the frontend mounts it. */
export function documentPath(
  id: string,
  kind: TemplateSeed['content']['kind'],
): string {
  return `/${DOCUMENT_ROUTES[kind]}/${id}`;
}

type ListingState = Pick<
  TemplateListing,
  | 'id'
  | 'status'
  | 'visibility'
  | 'contentChangedAt'
  | 'reviewedContentAt'
  | 'title'
  | 'description'
  | 'category'
  | 'tags'
>;

/**
 * The `review()` call that approves this seed's own listing — by its id, and
 * echoing the watermark this command read, so an edit landing in between
 * makes `review()` refuse (`contentAt` CAS) rather than approve content
 * nobody looked at. Refuses anything not awaiting review: approving is the
 * only decision this command makes, and only on a submission it just made.
 */
export function approvalFor(listing: ListingState): {
  id: string;
  dto: { decision: 'approve'; contentAt?: string };
} {
  if (listing.status !== 'pending') {
    throw new Error(
      `listing ${listing.id} is ${listing.status}, not pending; not approving`,
    );
  }
  return {
    id: listing.id,
    dto: {
      decision: 'approve',
      // `null` is a version too: `review()` compares the two as an ETag.
      ...(listing.contentChangedAt
        ? { contentAt: listing.contentChangedAt.toISOString() }
        : {}),
    },
  };
}

/**
 * What to do with a seed that already has a listing, short of `--reset`.
 *
 * The catalogue's card can move after a listing was registered — the v2
 * taxonomy re-filed every seed under a leaf category — and `--reset` is the
 * wrong tool for that: it unpublishes, which revokes the preview link, and
 * re-registers through the browser. A card change needs neither. So a
 * drifted card is applied through `TemplateService.update()` (which returns a
 * public listing to review, exactly as a person's edit would) and re-approved
 * in-process.
 *
 * Only when re-approving attests to nothing new: the listing must be public
 * and listed, and its content must still be the content a reviewer approved
 * (`reviewedContentAt === contentChangedAt`). Anything else is left for a
 * person — this command never approves content it did not watch land.
 */
export function refileFor(
  listing: ListingState,
  seed: TemplateSeed,
):
  | { action: 'none' }
  | { action: 'refile'; drift: ReturnType<typeof cardDrift> }
  | { action: 'skip'; reason: string } {
  const drift = cardDrift(listing, seed);
  if (Object.keys(drift).length === 0) return { action: 'none' };
  if (listing.visibility !== 'public' || listing.status !== 'listed') {
    return {
      action: 'skip',
      reason:
        `its card drifted, but it is ${listing.visibility}/${listing.status}, ` +
        'not public and listed; decide it at /admin/templates or pass --reset',
    };
  }
  const reviewed = listing.reviewedContentAt?.getTime() ?? null;
  const current = listing.contentChangedAt?.getTime() ?? null;
  if (reviewed !== current) {
    return {
      action: 'skip',
      reason:
        'its card drifted, but its content changed since it was approved, ' +
        'so re-approving would attest to content nobody reviewed',
    };
  }
  return { action: 'refile', drift };
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
    // The same explicit affirmation the server demands at submit/approve, run
    // through the same assertion rather than re-derived here: this script and
    // the endpoints it drives must not be able to disagree about what counts
    // as enforced. Checked up front so the run fails before publishing rather
    // than at the first submission. `main()`'s catch prints `err.message`, so
    // the `BadRequestException` reads as an ordinary CLI error.
    assertYorkieAuthEnforced(config.get<string>('YORKIE_AUTH_WEBHOOK_ENFORCE'));

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
      let refiled = 0;
      for (const seed of TEMPLATE_CATALOG) {
        const refusal = registerRefusal(seed);
        if (refusal) {
          logger.log(`${seed.slug}: skipped — ${refusal}`);
          continue;
        }
        // Registering is not idempotent and cannot be: the Share dialog shows
        // the listing form instead of the publish block once a listing exists,
        // and `submit` refuses a listing that is already public. Skipping is
        // the honest outcome — the alternative was a 30s selector timeout that
        // named nothing. The one change an existing listing does get is a
        // drifted card (a re-filed category), applied in-process by
        // `refileFor` / `refileOne` without touching the browser.
        const existing = await prisma.templateListing.findUnique({
          where: { documentId: seedDocumentId(seed.slug) },
        });
        if (existing && !reset) {
          const plan = refileFor(existing, seed);
          if (plan.action === 'refile') {
            await refileOne(prisma, templates, authorId, existing, plan.drift);
            refiled += 1;
            logger.log(`${seed.slug}: card re-filed and re-approved`);
            continue;
          }
          logger.log(
            plan.action === 'skip'
              ? `${seed.slug}: skipped — ${plan.reason}`
              : `${seed.slug}: already listed (${existing.visibility}/${existing.status}), card current — skipping. Pass --reset to re-register.`,
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
        const pending = await assertListingState(prisma, page, seed, {
          status: 'pending',
        });
        // By the id of the listing this run just published — never a title.
        const approval = approvalFor(pending);
        await templates.review(approval.id, authorId, approval.dto);
        await assertListingState(prisma, page, seed, {
          status: 'listed',
          visibility: 'public',
        });
        registered += 1;
        logger.log(`${seed.slug}: published, submitted and approved`);
      }

      logger.log(
        `${registered} template(s) registered, ${refiled} re-filed; all are public and listed.`,
      );
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
      // The picker shows labels, not slugs.
      .getByRole('option', { name: categoryLabel(seed.category), exact: true })
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
): Promise<TemplateListing> {
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
      return listing;
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
 * Apply a drifted card to an already-approved listing and re-approve it,
 * in-process and by listing id. See {@link refileFor} for when this is
 * allowed; the caller has already checked.
 */
async function refileOne(
  prisma: PrismaService,
  templates: TemplateService,
  authorId: number,
  existing: TemplateListing,
  drift: ReturnType<typeof cardDrift>,
): Promise<void> {
  await templates.update(existing.id, authorId, drift);
  const after = await prisma.templateListing.findUniqueOrThrow({
    where: { id: existing.id },
  });
  // A tags-only change is not a card change and leaves the listing listed.
  if (after.status === 'listed' && after.visibility === 'public') return;
  // The card went back to review. Re-approving is only an attestation to
  // content a reviewer already approved while the watermark `refileFor`
  // checked is still the current one; an edit since leaves it for a person.
  if (
    (after.contentChangedAt?.getTime() ?? null) !==
    (existing.contentChangedAt?.getTime() ?? null)
  ) {
    throw new Error(
      `listing ${existing.id}: its content changed while the card was re-filed; left pending for review`,
    );
  }
  const approval = approvalFor(after);
  await templates.review(approval.id, authorId, approval.dto);
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
