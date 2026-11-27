/**
 * Render template gallery thumbnails offline, from the seed catalogue
 * (docs/design/template-catalog-scaling.md §3).
 *
 *   pnpm backend template:dump --out catalog.json
 *   pnpm frontend render:thumbnails catalog.json --out thumbs/
 *   pnpm backend sync:templates --author <userId> --thumbnails thumbs/
 *
 * Each seed is painted by the same model-driven renderer its editor registers
 * as a thumbnail source and encoded by `encodeThumbnail`, so the output is the
 * 1280 px WebP the Share dialog would have uploaded. Writes `<slug>.webp` and
 * `manifest.json` (sha256 per file plus the `contentHash` it was rendered
 * from, which `sync:templates` checks).
 *
 * Every non-loopback request is blocked: the browser is a rasterizer holding
 * no session, and a thumbnail must not depend on the network.
 *
 * Covered today: slides and note. Sheet, board and doc seeds are listed under
 * `skipped` (their renderers are Phase 2), and `sync:templates` does not
 * publish them rather than publish an icon-only card. A slides or note seed
 * that fails to render is listed under `failed` and fails the run.
 *
 * Fonts: Chromium paints with the fonts installed on this machine. Render in
 * the same image every time if thumbnail bytes are to stay stable.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { withRenderPage } from "./render-harness.mjs";

const cwd = process.env.INIT_CWD ?? process.cwd();

function parseArgs(argv) {
  const args = { file: undefined, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (!a.startsWith("--")) args.file = a;
    else throw new Error(`unknown option ${a}`);
  }
  if (!args.file || !args.out) {
    throw new Error("usage: render-thumbnails.mjs <catalog.json> --out <dir>");
  }
  return { file: path.resolve(cwd, args.file), out: path.resolve(cwd, args.out) };
}

const EXT = { "image/webp": "webp", "image/png": "png" };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dump = JSON.parse(await readFile(args.file, "utf8"));
  if (dump?.version !== 1 || !Array.isArray(dump.seeds)) {
    throw new Error(`${args.file} is not a \`template:dump\` catalogue`);
  }
  await mkdir(args.out, { recursive: true });

  const manifest = { version: 1, items: {}, skipped: {}, failed: {} };
  await withRenderPage({ blockExternal: true }, async (page) => {
    for (const seed of dump.seeds) {
      let result;
      try {
        result = await page.evaluate((c) => window.__renderThumbnail(c), seed.content);
      } catch (e) {
        result = { ok: false, unsupported: false, reason: String(e?.message ?? e) };
      }
      if (!result.ok) {
        (result.unsupported ? manifest.skipped : manifest.failed)[seed.slug] =
          result.reason;
        console.error(`${seed.slug}: ${result.unsupported ? "skipped" : "FAILED"} — ${result.reason}`);
        continue;
      }
      const ext = EXT[result.mimeType];
      if (!ext) {
        manifest.failed[seed.slug] = `unexpected encoding ${result.mimeType}`;
        continue;
      }
      const bytes = Buffer.from(result.dataUrl.split(",")[1], "base64");
      const file = `${seed.slug}.${ext}`;
      await writeFile(path.join(args.out, file), bytes);
      manifest.items[seed.slug] = {
        file,
        mimeType: result.mimeType,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        contentHash: seed.contentHash,
      };
      console.log(path.join(args.out, file));
    }
  });

  await writeFile(
    path.join(args.out, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const n = (o) => Object.keys(o).length;
  console.log(
    `${n(manifest.items)} rendered, ${n(manifest.skipped)} skipped, ${n(manifest.failed)} failed`,
  );
  if (n(manifest.failed) > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
