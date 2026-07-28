// config_hash — the stable identity of a JUDGE composition ("which judge").
//
// Two config manifests that describe the SAME judge behavior must produce the
// SAME hash, regardless of cosmetic differences (config_id/description), field
// order, lens order, or default-omitted-vs-explicit. Anything the panel actually
// consumes to produce findings is behavior-determining and enters the hash;
// pointers/cosmetics do not. See the harness schema doc §3.3–3.3.1.
//
// EXCLUDED from the hash (recorded as provenance only): schema_version,
// config_id, description, sdk_version, lens.rubric_path.
// INCLUDED: target + per-lens {id,title,model,samples,gating,needsIssueSpec,
// appliesWhen,rubric_sha256}, with panel defaults normalized so an omitted field
// hashes identically to its explicit default.

import { createHash } from "node:crypto";

// Per-lens fields that determine review behavior. Defaults mirror the panel
// (review-panel.mjs: gating ?? "blocking", samples Math.max(1,Number||2),
// appliesWhen ["**"] when empty/missing) so the same judge hashes stably whether
// or not defaults are written out explicitly.
function normalizeLens(l) {
  const lens = l || {};
  const appliesWhen = Array.isArray(lens.appliesWhen) && lens.appliesWhen.length
    ? [...lens.appliesWhen].map(String).sort() // a set of globs — order-independent
    : ["**"];
  return {
    id: String(lens.id ?? ""),
    title: String(lens.title ?? ""),
    model: String(lens.model ?? ""),
    samples: Math.max(1, Number(lens.samples) || 2),
    gating: String(lens.gating ?? "blocking"),
    needsIssueSpec: !!lens.needsIssueSpec,
    appliesWhen,
    rubric_sha256: String(lens.rubric_sha256 ?? ""),
  };
}

/** Recursively sort object keys (arrays keep their order — callers pre-sort any
 * array that is semantically a set). Produces a canonical, stable ordering. */
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep(v[k]);
    return out;
  }
  return v;
}

/** The canonical string hashed for identity — behavior-determining fields only,
 * lenses sorted by id, keys sorted recursively, no whitespace. */
export function canonicalConfig(manifest) {
  const m = manifest || {};
  const lenses = (Array.isArray(m.lenses) ? m.lenses : [])
    .map(normalizeLens)
    .sort((a, b) => a.id.localeCompare(b.id)); // lens order in the file never affects identity
  return JSON.stringify(sortKeysDeep({ target: String(m.target ?? ""), lenses }));
}

export function sha256Hex(str) {
  return createHash("sha256").update(String(str ?? ""), "utf8").digest("hex");
}

/** Identity of a judge composition: "sha256:<hex>" over canonicalConfig. */
export function configHash(manifest) {
  return `sha256:${sha256Hex(canonicalConfig(manifest))}`;
}

/** Content hash of a rubric (or any text): "sha256:<hex>". Used for
 * lens.rubric_sha256 so config identity reacts to rubric wording changes. */
export function contentHash(text) {
  return `sha256:${sha256Hex(text)}`;
}
