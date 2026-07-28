// Build a config manifest (+ reproduction snapshot) from a lenses directory, and
// materialize a lenses dir back from a snapshot so the panel can consume a
// specific config. This is the bridge between the harness config-as-code and
// review-panel.mjs's on-disk `lenses.json` + `<id>.md` layout.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentHash, configHash } from "./config-hash.mjs";

const nowIso = () => new Date().toISOString();

/**
 * Read a lenses dir (lenses.json + <id>.md rubrics) into a config manifest and a
 * reproduction snapshot. The manifest is the lean template (rubric hashes only);
 * the snapshot inlines full rubric text + the computed config_hash — the receipt.
 */
export function buildConfig(lensesDir, { configId, target = "reviewer", sdkVersion, description = "" } = {}) {
  const manifestLenses = JSON.parse(readFileSync(path.join(lensesDir, "lenses.json"), "utf8"));
  const lenses = manifestLenses.map((l) => {
    const rubricText = readFileSync(path.join(lensesDir, `${l.id}.md`), "utf8");
    return {
      id: l.id,
      title: l.title,
      model: l.model,
      samples: l.samples,
      gating: l.gating,
      needsIssueSpec: l.needsIssueSpec,
      appliesWhen: l.appliesWhen,
      rubric_path: `scripts/agent/lenses/${l.id}.md`,
      rubric_sha256: contentHash(rubricText),
      _rubric_text: rubricText, // stripped from the manifest; kept for the snapshot
    };
  });

  const manifest = {
    schema_version: 1,
    config_id: configId,
    target,
    description,
    sdk_version: sdkVersion,
    lenses: lenses.map(({ _rubric_text, ...keep }) => keep),
  };
  const hash = configHash(manifest);
  const snapshot = {
    config_hash: hash,
    captured_at: nowIso(),
    schema_version: 1,
    config_id: configId,
    target,
    sdk_version: sdkVersion,
    lenses: lenses.map(({ _rubric_text, rubric_path, ...keep }) => ({ ...keep, rubric_text: _rubric_text })),
  };
  return { manifest, snapshot, config_hash: hash };
}

/**
 * Write a snapshot back out as a lenses dir review-panel.mjs can load: a
 * `lenses.json` (the fields the panel reads) + one `<id>.md` per rubric. Lets the
 * runner feed the panel exactly the config under test, from the frozen receipt.
 */
export function materializeLenses(snapshot, destDir) {
  mkdirSync(destDir, { recursive: true });
  const lensesJson = snapshot.lenses.map((l) => ({
    id: l.id, title: l.title, gating: l.gating, needsIssueSpec: l.needsIssueSpec,
    appliesWhen: l.appliesWhen, model: l.model, samples: l.samples,
  }));
  writeFileSync(path.join(destDir, "lenses.json"), JSON.stringify(lensesJson, null, 2) + "\n");
  for (const l of snapshot.lenses) writeFileSync(path.join(destDir, `${l.id}.md`), l.rubric_text ?? "");
  return destDir;
}

// --- CLI: emit a config manifest for inspection -----------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith("--")) { args[process.argv[i].slice(2)] = process.argv[i + 1]; i++; }
  }
  const lensesDir = args["lenses-dir"] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lenses");
  const { manifest, config_hash } = buildConfig(lensesDir, {
    configId: args["config-id"] ?? "baseline",
    sdkVersion: args["sdk-version"] ?? "0.3.217",
    description: args.description ?? "",
  });
  if (args.out) {
    mkdirSync(path.dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(JSON.stringify({ config_hash, manifest }, null, 2));
}
