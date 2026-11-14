// What `install-deps.mjs` accepts as a `pnpm-lock.yaml`.
//
// The lockfile is the one file of the branch the install acts on in detail: it
// names every package, where each comes from and how it is fetched. So it is
// read by ALLOW-LIST. A lockfile is accepted only if every line of it is in the
// plain form pnpm itself writes and every field is one main's own lockfile
// uses, with a value of the expected shape:
//
//   * every package is fetched from the registry by name and version and
//     checked against a sha512 integrity — `resolution` is exactly
//     `{integrity: sha512-…}`, nothing else;
//   * every project the lockfile installs for is a plain directory under the
//     workspace root, and every `link:` names one of those projects;
//   * every dependency specifier is a version range or a `workspace:` range;
//   * every reference from a project or a package lands on an entry that was
//     itself checked.
//
// Anything else is refused, whether or not it is known to be harmful: another
// top-level section, another key, another protocol, another way of writing the
// same YAML.
//
// WHY A READER OF ITS OWN, AND WHY SO STRICT. This script runs from a bare copy
// of `scripts/agent` with no dependencies installed, so there is no YAML
// library to call — and a second, looser reader beside pnpm's is exactly what
// must not exist: a document the two read differently would be checked as one
// thing and installed as another. `parseStrictYaml` therefore accepts only a
// small subset of YAML in which there is one way to write each thing — block
// mappings indented by two, plain or single-quoted scalars on one line, flow
// collections on one line — and refuses the rest: double quotes, escapes,
// anchors, aliases, tags, merge keys, comments, multi-line scalars, tabs,
// duplicate keys, and any plain scalar YAML would read as a number, a date or
// null. Within that subset a YAML parser and this one build the same tree.
//
// `install-deps.test.mjs` holds main's own `pnpm-lock.yaml` to this grammar, so
// a pull request whose lockfile leaves it fails CI rather than surprising the
// agent jobs later.

import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

/**
 * Read a file of the branch as data: it must be a regular file — not a link,
 * a pipe or a device — and no larger than `max`. Opened without following a
 * link and checked again on the open descriptor.
 *
 * @returns {Buffer}
 */
export function readBranchFile(file, what, max) {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) refuse(`${what} is missing`);
  if (!stat.isFile()) refuse(`${what} is not a regular file`);
  if (stat.size > max) refuse(`${what} is larger than the install reads (${max} bytes)`);
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    refuse(`${what} is not a regular file`);
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size > max) refuse(`${what} is not a regular file of a size the install reads`);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

const MANIFEST_MAX = 1024 * 1024;

// ── the YAML subset ─────────────────────────────────────────────────────────

const PLAIN_KEY = /^[A-Za-z0-9._][A-Za-z0-9._/@<>=^~|*+()$-]*(?: [A-Za-z0-9._/@<>=^~|*+()$-]+)*$/;
const PLAIN_VALUE = /^[A-Za-z0-9^~][A-Za-z0-9._/@<>=^~|*+():$-]*(?: [A-Za-z0-9._/@<>=^~|*+():$-]+)*$/;
const FLOW_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;
const FLOW_VALUE = /^[A-Za-z0-9^][A-Za-z0-9._/<>=^~|*+-]*(?: [A-Za-z0-9._/<>=^~|*+-]+)*$/;
const FLOW_ITEM = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
// Free text (a deprecation notice): one line, starting with a letter or digit,
// with nothing in it that would end the scalar early or start something else.
const FREE_TEXT = /^[A-Za-z0-9](?:(?! #|: )[^\n])*[^:\s]$|^[A-Za-z0-9]$/;
const FREE_TEXT_KEYS = new Set(["deprecated"]);
// Characters no line may contain: control characters, the line separators YAML
// knows beyond "\n", a byte-order mark, a backslash, a double quote, a tab.
const FORBIDDEN = new RegExp(
  `[${[[0x00, 0x09], [0x0b, 0x1f], [0x7f, 0x7f], [0x85, 0x85], [0x2028, 0x2029], [0xfeff, 0xfeff]]
    .map(([from, to]) => `\\u{${from.toString(16)}}-\\u{${to.toString(16)}}`)
    .join("")}\\\\"]`,
  "u",
);

/** A plain scalar YAML would not read as a string: a number, a date, null, a merge key. */
function isImplicit(text) {
  if (/^(~|null|true|false|yes|no|on|off|y|n|<<|=)$/i.test(text)) return true;
  if (/^[-+]?\.(inf|nan)$/i.test(text)) return true;
  if (/^[-+]?0[xXoObB][0-9a-fA-F_]+$/.test(text) || /^\d{4}-\d\d?-\d\d?/.test(text)) return true;
  return /^[-+.]?[0-9][0-9_.:,eE+-]*$/.test(text) && !/^\d+\.\d+\.\d/.test(text);
}

function plainString(text, pattern, what, lineNo) {
  if (!pattern.test(text) || text.includes(": ") || text.endsWith(":")) refuse(`pnpm-lock.yaml line ${lineNo}: ${what} is not in the plain form pnpm writes`);
  if (isImplicit(text)) refuse(`pnpm-lock.yaml line ${lineNo}: ${what} would not be read as a string`);
  return text;
}

/** `'…'` at the start of `text`: the string it holds and what follows it. `''` is a quote. */
function takeQuoted(text, lineNo) {
  let i = 1;
  let out = "";
  for (;;) {
    const end = text.indexOf("'", i);
    if (end === -1) refuse(`pnpm-lock.yaml line ${lineNo}: a quoted scalar does not end on its line`);
    out += text.slice(i, end);
    if (text[end + 1] !== "'") return [out, text.slice(end + 1)];
    out += "'";
    i = end + 2;
  }
}

function flowMapping(text, lineNo) {
  const map = new Map();
  let rest = text.slice(1, -1);
  while (rest.length > 0) {
    const colon = rest.indexOf(": ");
    if (colon === -1) refuse(`pnpm-lock.yaml line ${lineNo}: a flow mapping entry has no value`);
    const key = rest.slice(0, colon);
    if (!FLOW_KEY.test(key)) refuse(`pnpm-lock.yaml line ${lineNo}: a flow mapping key is not a plain word`);
    if (map.has(key)) refuse(`pnpm-lock.yaml line ${lineNo}: duplicate key ${key}`);
    rest = rest.slice(colon + 2);
    let value;
    if (rest.startsWith("'")) {
      [value, rest] = takeQuoted(rest, lineNo);
    } else {
      const comma = rest.indexOf(", ");
      value = comma === -1 ? rest : rest.slice(0, comma);
      rest = comma === -1 ? "" : rest.slice(comma);
      plainString(value, FLOW_VALUE, "a flow mapping value", lineNo);
    }
    map.set(key, value);
    if (rest === "") break;
    if (!rest.startsWith(", ") || rest.length === 2) refuse(`pnpm-lock.yaml line ${lineNo}: a flow mapping is not in the form pnpm writes`);
    rest = rest.slice(2);
  }
  return map;
}

function flowSequence(text, lineNo) {
  const items = [];
  let rest = text.slice(1, -1);
  if (rest === "") refuse(`pnpm-lock.yaml line ${lineNo}: an empty flow sequence`);
  for (;;) {
    let item;
    if (rest.startsWith("'")) {
      [item, rest] = takeQuoted(rest, lineNo);
    } else {
      const comma = rest.indexOf(", ");
      item = comma === -1 ? rest : rest.slice(0, comma);
      rest = comma === -1 ? "" : rest.slice(comma);
      plainString(item, FLOW_ITEM, "a flow sequence item", lineNo);
    }
    items.push(item);
    if (rest === "") return items;
    if (!rest.startsWith(", ") || rest.length === 2) refuse(`pnpm-lock.yaml line ${lineNo}: a flow sequence is not in the form pnpm writes`);
    rest = rest.slice(2);
  }
}

function scalarValue(key, text, lineNo) {
  if (text.startsWith("{")) {
    if (!text.endsWith("}")) refuse(`pnpm-lock.yaml line ${lineNo}: a flow mapping does not end on its line`);
    return flowMapping(text, lineNo);
  }
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) refuse(`pnpm-lock.yaml line ${lineNo}: a flow sequence does not end on its line`);
    return flowSequence(text, lineNo);
  }
  if (text.startsWith("'")) {
    const [value, rest] = takeQuoted(text, lineNo);
    if (rest !== "") refuse(`pnpm-lock.yaml line ${lineNo}: text follows a quoted scalar`);
    return value;
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (FREE_TEXT_KEYS.has(key)) {
    if (!FREE_TEXT.test(text) || isImplicit(text)) refuse(`pnpm-lock.yaml line ${lineNo}: the text of ${key} is not a plain one-line scalar`);
    return text;
  }
  return plainString(text, PLAIN_VALUE, "a value", lineNo);
}

/**
 * Read the subset of YAML described at the top of this file.
 *
 * @returns {Map<string, unknown>} mappings as `Map`, sequences as arrays,
 *   scalars as strings — or booleans for a bare `true` / `false`
 */
export function parseStrictYaml(text) {
  if (!text.endsWith("\n")) refuse("pnpm-lock.yaml does not end with a newline");
  const root = new Map();
  // Each open block: its indent, its container, and for a container not yet
  // known to be a mapping or a sequence, where to put it once it is.
  const stack = [{ indent: -2, node: root }];
  let pending = null; // a `key:` with nothing after it, waiting for its block
  const lines = text.split("\n");
  lines.pop();
  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1;
    if (line === "") continue;
    if (FORBIDDEN.test(line)) refuse(`pnpm-lock.yaml line ${lineNo}: a character the plain form pnpm writes never contains`);
    if (line.endsWith(" ")) refuse(`pnpm-lock.yaml line ${lineNo}: trailing whitespace`);
    // Leading SPACES only: another kind of whitespace is not indentation.
    const indent = /^ */.exec(line)[0].length;
    const content = line.slice(indent);

    if (pending) {
      if (indent !== pending.indent + 2) refuse(`pnpm-lock.yaml line ${lineNo}: ${pending.key} has no block under it`);
      const node = content.startsWith("- ") ? [] : new Map();
      pending.parent.set(pending.key, node);
      stack.push({ indent, node });
      pending = null;
    }
    while (stack.at(-1).indent > indent) stack.pop();
    const top = stack.at(-1);
    if (top.indent !== indent && !(top.indent === -2 && indent === 0)) {
      refuse(`pnpm-lock.yaml line ${lineNo}: indentation that matches no open block`);
    }

    if (Array.isArray(top.node)) {
      if (!content.startsWith("- ")) refuse(`pnpm-lock.yaml line ${lineNo}: a sequence holds something other than an item`);
      const item = content.slice(2);
      if (item.startsWith("'")) {
        const [value, rest] = takeQuoted(item, lineNo);
        if (rest !== "") refuse(`pnpm-lock.yaml line ${lineNo}: text follows a quoted scalar`);
        top.node.push(value);
      } else {
        top.node.push(plainString(item, PLAIN_KEY, "a sequence item", lineNo));
      }
      continue;
    }

    let key;
    let rest;
    if (content.startsWith("'")) {
      [key, rest] = takeQuoted(content, lineNo);
    } else {
      const colon = content.indexOf(":");
      if (colon === -1) refuse(`pnpm-lock.yaml line ${lineNo}: neither a mapping entry nor a sequence item`);
      key = plainString(content.slice(0, colon), PLAIN_KEY, "a key", lineNo);
      rest = content.slice(colon);
    }
    if (top.node.has(key)) refuse(`pnpm-lock.yaml line ${lineNo}: duplicate key ${key}`);
    if (rest === ":") {
      pending = { indent, key, parent: top.node };
      continue;
    }
    if (!rest.startsWith(": ") || rest.length === 2) refuse(`pnpm-lock.yaml line ${lineNo}: a mapping entry is not in the form pnpm writes`);
    top.node.set(key, scalarValue(key, rest.slice(2), lineNo));
  }
  if (pending) refuse(`pnpm-lock.yaml: ${pending.key} has no block under it`);
  return root;
}

// ── what a lockfile may say ────────────────────────────────────────────────

const NAME = "(?:@[a-z0-9][a-z0-9._~-]*/)?[A-Za-z0-9][A-Za-z0-9._~-]*";
const SEMVER = "\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
const PEERS = "(?:\\([A-Za-z0-9@._~/+()-]+\\))*";
const NAME_RE = new RegExp(`^${NAME}$`);
const PACKAGE_KEY = new RegExp(`^${NAME}@${SEMVER}$`);
const SNAPSHOT_KEY = new RegExp(`^${NAME}@${SEMVER}${PEERS}$`);
const VERSION_REF = new RegExp(`^${SEMVER}${PEERS}$`);
/** A version range or a dist-tag: no protocol, no path, no URL. */
const RANGE = /^[0-9A-Za-z.^~<>=|* +-]+$/;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;
const IMPORTER = /^(\.|[A-Za-z0-9@_][A-Za-z0-9@_.-]*(\/[A-Za-z0-9@_][A-Za-z0-9@_.-]*)*)$/;

const TOP_LEVEL = ["lockfileVersion", "settings", "overrides", "importers", "packages", "snapshots"];
const SETTINGS = ["autoInstallPeers", "excludeLinksFromLockfile"];
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];
const PACKAGE_FIELDS = ["resolution", "engines", "cpu", "os", "libc", "hasBin", "deprecated", "peerDependencies", "peerDependenciesMeta"];
const SNAPSHOT_FIELDS = ["dependencies", "optionalDependencies", "transitivePeerDependencies", "optional"];

const isMap = (v) => v instanceof Map;
const isString = (v) => typeof v === "string";

function only(map, allowed, where) {
  if (!isMap(map)) refuse(`pnpm-lock.yaml: ${where} is not a mapping`);
  for (const key of map.keys()) {
    if (!allowed.includes(key)) {
      refuse(`pnpm-lock.yaml: ${where} has the field ${JSON.stringify(key)}; the install accepts only ${allowed.join(", ")}`);
    }
  }
}

function stringMap(map, where) {
  if (!isMap(map)) refuse(`pnpm-lock.yaml: ${where} is not a mapping`);
  for (const [key, value] of map) {
    if (!isString(value)) refuse(`pnpm-lock.yaml: ${where} has a value for ${key} that is not a string`);
  }
}

/** A dependency specifier the install accepts: a range, a dist-tag, or a `workspace:` range. */
export function isAllowedSpecifier(specifier) {
  if (!isString(specifier)) return false;
  const range = specifier.startsWith("workspace:") ? specifier.slice("workspace:".length) : specifier;
  return RANGE.test(range);
}

/**
 * Hold the text of a `pnpm-lock.yaml` to the allow-list above.
 *
 * @returns {string[]} the projects it installs for, relative to the root
 */
export function checkLockfile(text) {
  const doc = parseStrictYaml(text);
  only(doc, TOP_LEVEL, "the lockfile");
  if (doc.get("lockfileVersion") !== "9.0") refuse("pnpm-lock.yaml is not lockfileVersion '9.0'");
  if (doc.has("settings")) {
    only(doc.get("settings"), SETTINGS, "settings");
    for (const [key, value] of doc.get("settings")) {
      if (typeof value !== "boolean") refuse(`pnpm-lock.yaml: settings.${key} is not true or false`);
    }
  }
  if (doc.has("overrides")) {
    stringMap(doc.get("overrides"), "overrides");
    for (const [key, value] of doc.get("overrides")) {
      if (!RANGE.test(value)) refuse(`pnpm-lock.yaml: the override for ${key} is not a plain version or range: ${value}`);
    }
  }

  const packages = doc.get("packages") ?? new Map();
  if (!isMap(packages)) refuse("pnpm-lock.yaml: packages is not a mapping");
  for (const [key, pkg] of packages) {
    if (!PACKAGE_KEY.test(key)) refuse(`pnpm-lock.yaml names a package that is not name@version from the registry: ${key}`);
    only(pkg, PACKAGE_FIELDS, `the package ${key}`);
    const resolution = pkg.get("resolution");
    if (!isMap(resolution) || resolution.size !== 1 || !INTEGRITY.test(resolution.get("integrity") ?? "")) {
      refuse(`pnpm-lock.yaml: the resolution of ${key} is not exactly {integrity: sha512-…}; the install fetches registry packages by integrity only`);
    }
    if (pkg.has("engines")) stringMap(pkg.get("engines"), `engines of ${key}`);
    for (const field of ["cpu", "os", "libc"]) {
      if (pkg.has(field) && !(Array.isArray(pkg.get(field)) && pkg.get(field).every(isString))) {
        refuse(`pnpm-lock.yaml: ${field} of ${key} is not a list of names`);
      }
    }
    if (pkg.has("hasBin") && pkg.get("hasBin") !== true) refuse(`pnpm-lock.yaml: hasBin of ${key} is not true`);
    if (pkg.has("deprecated") && !isString(pkg.get("deprecated"))) refuse(`pnpm-lock.yaml: deprecated of ${key} is not text`);
    if (pkg.has("peerDependencies")) stringMap(pkg.get("peerDependencies"), `peerDependencies of ${key}`);
    if (pkg.has("peerDependenciesMeta")) {
      const meta = pkg.get("peerDependenciesMeta");
      if (!isMap(meta)) refuse(`pnpm-lock.yaml: peerDependenciesMeta of ${key} is not a mapping`);
      for (const [peer, entry] of meta) {
        if (!isMap(entry) || entry.size !== 1 || entry.get("optional") !== true) {
          refuse(`pnpm-lock.yaml: peerDependenciesMeta of ${key} for ${peer} is not {optional: true}`);
        }
      }
    }
  }

  const snapshots = doc.get("snapshots") ?? new Map();
  if (!isMap(snapshots)) refuse("pnpm-lock.yaml: snapshots is not a mapping");
  /** A reference from a project or a snapshot must land on a checked snapshot. */
  const reference = (name, ref, from) => {
    if (!NAME_RE.test(name)) refuse(`pnpm-lock.yaml: ${from} depends on something that is not a package name: ${name}`);
    const key = isString(ref) && VERSION_REF.test(ref) ? `${name}@${ref}` : ref;
    if (!isString(key) || !SNAPSHOT_KEY.test(key) || !snapshots.has(key)) {
      refuse(`pnpm-lock.yaml: ${from} resolves ${name} to ${JSON.stringify(ref)}, which is not a registry package this lockfile describes`);
    }
  };
  for (const [key, snapshot] of snapshots) {
    if (!SNAPSHOT_KEY.test(key)) refuse(`pnpm-lock.yaml names a snapshot that is not name@version from the registry: ${key}`);
    const base = key.includes("(") ? key.slice(0, key.indexOf("(")) : key;
    if (!packages.has(base)) refuse(`pnpm-lock.yaml: the snapshot ${key} has no entry under packages`);
    only(snapshot, SNAPSHOT_FIELDS, `the snapshot ${key}`);
    for (const field of ["dependencies", "optionalDependencies"]) {
      if (!snapshot.has(field)) continue;
      if (!isMap(snapshot.get(field))) refuse(`pnpm-lock.yaml: ${field} of ${key} is not a mapping`);
      for (const [name, ref] of snapshot.get(field)) reference(name, ref, `the snapshot ${key}`);
    }
    if (snapshot.has("transitivePeerDependencies")) {
      const peers = snapshot.get("transitivePeerDependencies");
      if (!(Array.isArray(peers) && peers.every((p) => NAME_RE.test(p)))) {
        refuse(`pnpm-lock.yaml: transitivePeerDependencies of ${key} is not a list of package names`);
      }
    }
    if (snapshot.has("optional") && snapshot.get("optional") !== true) refuse(`pnpm-lock.yaml: optional of ${key} is not true`);
  }

  const importers = doc.get("importers");
  if (!isMap(importers) || importers.size === 0) refuse("pnpm-lock.yaml lists no importers");
  for (const name of importers.keys()) {
    if (!IMPORTER.test(name)) {
      refuse(`pnpm-lock.yaml names a project that is not a plain path under the workspace root: ${name}`);
    }
  }
  for (const [importer, project] of importers) {
    only(project, DEPENDENCY_FIELDS, `the project ${importer}`);
    for (const [field, deps] of project) {
      if (!isMap(deps)) refuse(`pnpm-lock.yaml: ${field} of ${importer} is not a mapping`);
      for (const [name, dep] of deps) {
        const where = `${importer} → ${name}`;
        if (!NAME_RE.test(name)) refuse(`pnpm-lock.yaml: ${importer} depends on something that is not a package name: ${name}`);
        if (!isMap(dep) || dep.size !== 2 || !dep.has("specifier") || !dep.has("version")) {
          refuse(`pnpm-lock.yaml: ${where} is not exactly a specifier and a version`);
        }
        const specifier = dep.get("specifier");
        const version = dep.get("version");
        if (!isAllowedSpecifier(specifier)) {
          refuse(`pnpm-lock.yaml: ${where} has the specifier ${JSON.stringify(specifier)}; the install accepts a version range or a workspace: range only`);
        }
        if (isString(version) && version.startsWith("link:")) {
          // A link is to another project of this workspace, by a relative path
          // that lands exactly on one of the importers.
          const target = path.posix.normalize(path.posix.join(importer, version.slice("link:".length)));
          if (!importers.has(target) || target === importer) {
            refuse(`pnpm-lock.yaml: ${where} links to ${version}, which is not another project of this workspace`);
          }
        } else {
          reference(name, version, `the project ${importer}`);
        }
      }
    }
  }
  return [...importers.keys()];
}

// ── the manifests of those projects ───────────────────────────────────────

const MANIFEST_DEPENDENCY_FIELDS = [...DEPENDENCY_FIELDS, "peerDependencies"];

/**
 * The top-level keys a project's `package.json` may carry: the ones this
 * repository's manifests use, plus plain metadata. Each is either checked
 * below or plays no part in an install that runs no scripts. A key that is not
 * here is refused, whatever it is — a manifest is read by allow-list for the
 * same reason the lockfile is.
 */
export const MANIFEST_KEYS = [
  // checked below
  "name", "version", "bin", "publishConfig", "engines", "peerDependenciesMeta", ...MANIFEST_DEPENDENCY_FIELDS,
  // root only, checked by install-deps.mjs
  "packageManager", "pnpm",
  // not read by an install without lifecycle scripts
  "private", "description", "scripts", "keywords", "author", "contributors", "license", "repository", "homepage", "bugs", "funding",
  "type", "main", "module", "types", "typings", "exports", "imports", "files", "sideEffects", "jest",
];
const PUBLISH_CONFIG_KEYS = ["access", "tag", "provenance"];
const BIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const VERSION_RE = new RegExp(`^${SEMVER}$`);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A path inside a package, written the plain way: relative, forward slashes, no `..`. */
function isPlainRelativePath(target) {
  if (typeof target !== "string" || target === "" || target.includes("\\") || path.posix.isAbsolute(target)) return false;
  const segments = target.split("/");
  if (segments[0] === ".") segments.shift();
  return segments.length > 0 && segments.every((segment) => segment !== "" && segment !== "." && segment !== ".." && ![...segment].some((c) => c.charCodeAt(0) < 32));
}

/**
 * Each project the lockfile installs for must be a real directory under the
 * root with a `package.json` the install can take as data: known keys only, a
 * well-formed name, dependencies named and ranged plainly, and executables
 * with plain names that point inside the package.
 *
 * Every string here that an install turns into part of a path — the package
 * name, a dependency's name, a `bin` name, a `bin` target — is held to a
 * grammar with no separator and no `..` in it.
 */
export function checkProjects(root, importers) {
  for (const importer of importers) {
    const dir = path.join(root, importer);
    const where = importer === "." ? "package.json" : `${importer}/package.json`;
    if (!existsSync(dir) || realpathSync(dir) !== dir) {
      refuse(`pnpm-lock.yaml names the project ${importer}, which is not a plain directory of this checkout`);
    }
    const text = readBranchFile(path.join(dir, "package.json"), where, MANIFEST_MAX).toString("utf8");
    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch {
      refuse(`${where} is not valid JSON`);
    }
    if (!isObject(manifest)) refuse(`${where} is not an object`);

    const unknown = Object.keys(manifest).filter((key) => !MANIFEST_KEYS.includes(key));
    if (unknown.length > 0) {
      refuse(`${where} has the field ${unknown.map((k) => JSON.stringify(k)).join(", ")}; the install accepts only the package.json fields it knows`);
    }
    if (typeof manifest.name !== "string" || !NAME_RE.test(manifest.name) || manifest.name.length > 214) {
      refuse(`${where}: name is not a plain package name`);
    }
    if (manifest.version !== undefined && (typeof manifest.version !== "string" || !VERSION_RE.test(manifest.version))) {
      refuse(`${where}: version is not a plain version`);
    }
    for (const field of MANIFEST_DEPENDENCY_FIELDS) {
      const deps = manifest[field];
      if (deps === undefined) continue;
      if (!isObject(deps)) refuse(`${where}: ${field} is not an object`);
      for (const [name, specifier] of Object.entries(deps)) {
        if (!NAME_RE.test(name)) refuse(`${where}: ${field} names a dependency that is not a plain package name: ${JSON.stringify(name)}`);
        if (!isAllowedSpecifier(specifier)) {
          refuse(`${where}: ${field}.${name} is ${JSON.stringify(specifier)}; the install accepts a version range or a workspace: range only`);
        }
      }
    }
    if (manifest.peerDependenciesMeta !== undefined) {
      const meta = manifest.peerDependenciesMeta;
      if (!isObject(meta) || !Object.entries(meta).every(([name, entry]) => NAME_RE.test(name) && isObject(entry) && Object.keys(entry).every((k) => k === "optional") && typeof (entry.optional ?? true) === "boolean")) {
        refuse(`${where}: peerDependenciesMeta is not a map of package names to {optional}`);
      }
    }
    if (manifest.engines !== undefined && !(isObject(manifest.engines) && Object.values(manifest.engines).every((v) => typeof v === "string"))) {
      refuse(`${where}: engines is not a map of strings`);
    }
    if (manifest.publishConfig !== undefined) {
      const extra = isObject(manifest.publishConfig) ? Object.keys(manifest.publishConfig).filter((k) => !PUBLISH_CONFIG_KEYS.includes(k)) : ["(not an object)"];
      if (extra.length > 0) refuse(`${where}: publishConfig has ${extra.join(", ")}; the install accepts only ${PUBLISH_CONFIG_KEYS.join(", ")} there`);
    }
    // Executables: a plain name each, pointing at a file inside the package.
    const { bin } = manifest;
    if (bin !== undefined) {
      const entries = typeof bin === "string" ? [[manifest.name.replace(/^@[^/]+\//, ""), bin]] : isObject(bin) ? Object.entries(bin) : refuse(`${where}: bin is neither a path nor an object`);
      for (const [name, target] of entries) {
        if (!BIN_NAME.test(name)) refuse(`${where}: bin has a name that is not a plain command name: ${JSON.stringify(name)}`);
        if (!isPlainRelativePath(target)) refuse(`${where}: bin.${name} is not a plain path inside the package`);
      }
    }
  }
}
