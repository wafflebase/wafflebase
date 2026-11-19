#!/usr/bin/env node
/**
 * Before → After captures for a pull request that changes UI a phone renders.
 *
 *   shoot    Open a route signed in, in an iPhone-sized touch viewport, and
 *            save a PNG. Run it on `main` for "before", on the branch for
 *            "after".
 *   compose  Put each before/after pair side by side, one PNG per pair.
 *   publish  Push the composed PNGs to an `assets/pr-<n>` branch (never the
 *            PR branch) and print the Markdown to paste into the PR body.
 *
 *   node packages/frontend/scripts/capture-before-after.mjs shoot \
 *     --path /s/<id> --out before/share.png --user 1 [--steps steps.mjs]
 *   node packages/frontend/scripts/capture-before-after.mjs compose \
 *     --out pr-assets --pair "Share dialog|before/share.png|after/share.png"
 *   node packages/frontend/scripts/capture-before-after.mjs publish \
 *     --pr 1170 --dir pr-assets [--dry-run]
 *
 * The default viewport is 393×659: an iPhone 16 with Safari's toolbars
 * showing, which is what a visitor actually sees (the 852px screen height
 * never is). Pass `--height 400` for the soft keyboard being up. Pass
 * `--desktop` for a 1440×900 desktop window instead (the docs site's
 * screenshot size, see packages/documentation/STYLE.md); `--width` and
 * `--height` override either size. `compose` lays out phone-width pairs, so
 * desktop shots are for the docs site, not for a PR's before/after.
 *
 * Signing in mints the same access cookie the OAuth callback writes, signed
 * with the backend's `JWT_SECRET` for the user id given by `--user`, whose
 * name and email are read from `DATABASE_URL` (both from the environment,
 * else `packages/backend/.env`). Local development only.
 *
 * `--steps` names a module whose default export `async (page) => {}` runs
 * after the page settles — open the dialog or menu under test there. Open
 * context menus with a dispatched `contextmenu` event rather than a real
 * right-click: Playwright releases the button over the menu that just
 * opened, which picks an item and edits the document.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const requireFrontend = createRequire(path.join(here, "../package.json"));
const requireBackend = createRequire(
  path.join(repoRoot, "packages/backend/package.json"),
);

function parseArgs(argv) {
  const args = { pair: [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    const next = argv[i + 1];
    // A bare flag (`--dry-run`) is `true`; anything else takes the next word.
    const value = next === undefined || next.startsWith("--") ? true : next;
    if (value !== true) i++;
    if (key === "pair") args.pair.push(value);
    else args[key] = value;
  }
  return args;
}

/** A backend setting: the environment first, then `packages/backend/.env`. */
function backendEnv(name) {
  if (process.env[name]) return process.env[name];
  const envFile = path.join(repoRoot, "packages/backend/.env");
  const line = fs
    .readFileSync(envFile, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is set neither in env nor ${envFile}`);
  return line.slice(name.length + 1).trim();
}

/**
 * The session payload is what the app treats as the signed-in user (it is
 * not re-read from the database), and the editors stall on "Loading…"
 * with a placeholder name or empty email — so take the real row.
 */
async function loadUser(id) {
  const { PrismaClient } = requireBackend("@prisma/client");
  const prisma = new PrismaClient({
    datasources: { db: { url: backendEnv("DATABASE_URL") } },
  });
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new Error(`no user with id ${id}`);
    return user;
  } finally {
    await prisma.$disconnect();
  }
}

async function shoot(args) {
  if (!args.path || !args.out || !args.user) {
    throw new Error("shoot needs --path, --out and --user");
  }
  const base = args.base ?? "http://localhost:5173";
  const desktop = args.desktop === true;
  const size = (key, fallback) => {
    const value = Number(args[key] ?? fallback);
    // A bare `--width` parses as `true`, which Number() turns into 1.
    if (!Number.isInteger(value) || value < 100) {
      throw new Error(`--${key} needs a pixel size, got ${args[key]}`);
    }
    return value;
  };
  const width = size("width", desktop ? 1440 : 393);
  const height = size("height", desktop ? 900 : 659);
  const { chromium, devices } = requireFrontend("playwright");
  const jwt = requireBackend("jsonwebtoken");
  const user = await loadUser(Number(args.user));
  const token = jwt.sign(
    {
      sub: user.id,
      username: user.username,
      email: user.email,
      photo: user.photo,
      tokenType: "access",
    },
    backendEnv("JWT_SECRET"),
    { expiresIn: "1h" },
  );

  const browser = await chromium.launch();
  try {
    // The iPhone descriptor brings touch, `isMobile` and the user agent; its
    // `defaultBrowserType` is dropped so it runs on the bundled Chromium.
    const { defaultBrowserType: _, ...iphone } = devices["iPhone 15"];
    const context = await browser.newContext(
      desktop
        ? { viewport: { width, height }, deviceScaleFactor: 1 }
        : {
            ...iphone,
            viewport: { width, height },
            screen: { width, height: Math.max(852, height) },
          },
    );
    // Over https the backend names the cookie `__Host-…`, which a browser
    // only accepts with `Secure` and no domain.
    const secure = base.startsWith("https:");
    await context.addCookies([
      {
        name: secure ? "__Host-wafflebase_session" : "wafflebase_session",
        value: token,
        url: base,
        httpOnly: true,
        sameSite: "Lax",
        ...(secure ? { secure: true } : {}),
      },
    ]);
    const page = await context.newPage();
    await page
      .goto(base + args.path, { waitUntil: "networkidle" })
      .catch(() => {});
    await page.waitForTimeout(1500);
    if (args.steps) {
      const steps = await import(pathToFileURL(path.resolve(args.steps)).href);
      await steps.default(page);
      await page.waitForTimeout(500);
    }
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    await page.screenshot({ path: args.out });
    console.log(`wrote ${args.out} (${width}×${height})`);
  } finally {
    await browser.close();
  }
}

async function compose(args) {
  if (!args.out || args.pair.length === 0) {
    throw new Error('compose needs --out and at least one --pair "Title|before|after[|cropPx]"');
  }
  const { chromium } = requireFrontend("playwright");
  fs.mkdirSync(args.out, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 820, height: 100 },
      deviceScaleFactor: 1,
    });
    const dataUrl = (f) =>
      `data:image/png;base64,${fs.readFileSync(f).toString("base64")}`;
    for (const [index, spec] of args.pair.entries()) {
      const [title, before, after, crop] = spec.split("|");
      const frame = (label, file, color) => `
        <figure style="margin:0;width:393px">
          <figcaption style="color:${color};padding:0 0 6px">${label}</figcaption>
          <div style="border:1px solid #d4d4d8;overflow:hidden;${crop ? `height:${crop}px` : ""}">
            <img src="${dataUrl(file)}" style="width:393px;display:block">
          </div>
        </figure>`;
      await page.setContent(`
        <body style="margin:0;font:600 15px system-ui;background:#f4f4f5">
          <div style="display:flex;gap:12px;padding:12px">
            ${frame("Before", before, "#b91c1c")}${frame("After", after, "#15803d")}
          </div>
        </body>`);
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const out = path.join(args.out, `${String(index + 1).padStart(2, "0")}-${slug}.png`);
      await page.screenshot({ path: out, fullPage: true });
      fs.writeFileSync(`${out}.title`, title);
      console.log(`wrote ${out}`);
    }
  } finally {
    await browser.close();
  }
}

function publish(args) {
  if (!args.pr || !args.dir) throw new Error("publish needs --pr and --dir");
  const git = (...a) =>
    execFileSync("git", a, { cwd: repoRoot, encoding: "utf8" }).trim();
  const files = fs
    .readdirSync(args.dir)
    .filter((f) => f.endsWith(".png"))
    .sort();
  // Built with plumbing so nothing is checked out: an orphan commit holding
  // only `pr-<n>/*.png`, pushed to its own branch. The PR branch stays free
  // of binaries; the PR body links into this branch, so it outlives the merge.
  const entries = files
    .map((f) => {
      const blob = git("hash-object", "-w", path.resolve(args.dir, f));
      return `100644 blob ${blob}\t${f}`;
    })
    .join("\n");
  const mktree = (input) =>
    execFileSync("git", ["mktree"], { cwd: repoRoot, input, encoding: "utf8" }).trim();
  const tree = mktree(`040000 tree ${mktree(`${entries}\n`)}\tpr-${args.pr}\n`);
  const commit = git("commit-tree", tree, "-m", `Before/after screenshots for PR #${args.pr}`);
  const remote = args.remote ?? "origin";
  if (args["dry-run"]) console.error(`dry run: would push ${commit} to assets/pr-${args.pr}`);
  else git("push", "--force", remote, `${commit}:refs/heads/assets/pr-${args.pr}`);

  const slug = git("remote", "get-url", remote)
    .replace(/^.*github\.com[:/]/, "")
    .replace(/\.git$/, "");
  const raw = `https://raw.githubusercontent.com/${slug}/assets/pr-${args.pr}/pr-${args.pr}`;
  const lines = ["## Before → After", "", "iPhone 16 viewport, 393×659 (Safari with toolbars) unless noted.", ""];
  for (const f of files) {
    const titleFile = path.resolve(args.dir, `${f}.title`);
    const title = fs.existsSync(titleFile) ? fs.readFileSync(titleFile, "utf8") : f;
    lines.push(`### ${title}`, "", `<img src="${raw}/${f}" width="640" alt="${title}: before and after">`, "");
  }
  console.log(lines.join("\n"));
}

const [command, ...rest] = process.argv.slice(2);
const commands = { shoot, compose, publish };
if (!commands[command]) {
  console.error("usage: capture-before-after.mjs <shoot|compose|publish> [--options]");
  process.exit(2);
}
await commands[command](parseArgs(rest));
