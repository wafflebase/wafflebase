// The two pure halves of `design-pr.mjs`, and both are here because they broke.
//
// `parsePorcelain` is the one that matters: it decides which files reach someone
// else's pull request. The first version trimmed git's whole output before
// splitting, which ate a character of the first line whenever its status was an
// unstaged modification — the two-column status field starts with a SPACE there —
// and the plan printed `ackage.json`. A committed path that does not exist is the
// worst failure this script has, so the shape is pinned.

import test from "node:test";
import assert from "node:assert/strict";
import { defaultBody, parsePorcelain } from "../design-pr.mjs";

const z = (...records) => records.map((r) => `${r}\0`).join("");

test("parsePorcelain keeps the whole path of an unstaged modification", () => {
  // ` M path` — the status field's first column is a SPACE here. An earlier version
  // trimmed git's whole output before splitting and reported `ackage.json`.
  assert.deepEqual(parsePorcelain(z(" M package.json")), ["package.json"]);
});

test("parsePorcelain reads staged, untracked and mixed statuses", () => {
  const out = z("M  a.ts", "?? b.ts", "MM c.ts", " D d.ts", "A  e.ts");
  assert.deepEqual(parsePorcelain(out), ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]);
});

test("parsePorcelain takes the new path of a rename and drops its origin", () => {
  // Under `-z` a rename is TWO records, new first. The origin no longer exists, so
  // committing it would name nothing.
  assert.deepEqual(parsePorcelain(z("R  new.ts", "old.ts", " M other.ts")), [
    "new.ts",
    "other.ts",
  ]);
});

test("parsePorcelain drops the origin of a copy too", () => {
  assert.deepEqual(parsePorcelain(z("C  copy.ts", "source.ts")), ["copy.ts"]);
});

test("parsePorcelain keeps a path that merely looks like a rename", () => {
  // MEASURED: git prints `?? untracked -> weird.ts` for a file with that name, and
  // in the human format it quotes it — indistinguishable from `R old -> new` by
  // text alone. Splitting on the arrow truncated it to `weird.ts`, which is a path
  // that does not exist, committed into someone else's pull request.
  assert.deepEqual(parsePorcelain(z("?? untracked -> weird.ts")), ["untracked -> weird.ts"]);
});

test("parsePorcelain leaves quotes, tabs and newlines in a path alone", () => {
  // `-z` never escapes, so nothing has to be un-escaped — which is the whole reason
  // for using it over the human format, where a tab arrives as a literal `\t`.
  const weird = ['a"b.ts', "tab\tname.ts", "line\nname.ts"];
  assert.deepEqual(parsePorcelain(z(...weird.map((w) => `?? ${w}`))), weird);
});

test("parsePorcelain ignores empty and truncated records", () => {
  assert.deepEqual(parsePorcelain(z("", " M a.ts", "??")), ["a.ts"]);
});

test("defaultBody lists the intent labels, not the diff", () => {
  // The labels are what the editor recorded when each edit was staged. A body
  // built from them says a hover state on one variant changed; a body built from
  // the diff could only say a line differs.
  const body = defaultBody({
    labels: ["Button: Background Color · hover", "--primary → butter.500"],
    files: ["packages/frontend/src/components/ui/button.tsx"],
    precise: true,
  });
  assert.match(body, /## Changes/);
  assert.match(body, /- Button: Background Color · hover/);
  assert.match(body, /- --primary → butter\.500/);
  assert.match(body, /packages\/frontend\/src\/components\/ui\/button\.tsx/);
});

test("defaultBody says so when the list came from the working tree", () => {
  // The write log lives in the dev server's memory, so it is gone once the editor
  // is closed. Narrowing silently to `git status` would present a guess as the
  // editor's own record.
  const body = defaultBody({ labels: [], files: ["a.ts"], precise: false });
  assert.match(body, /editor was not running/);
  assert.match(body, /working tree/);
  assert.doesNotMatch(body, /## Changes/);
});

test("a protected branch is refused however it was named", async () => {
  // `--branch main` while already on `main` used to walk past the guard: the check
  // lived in the expression that only runs when no `--branch` was given, so the
  // names matched, the checkout was skipped, and the commit landed on `main`.
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../design-pr.mjs", import.meta.url), "utf8"),
  );
  assert.match(src, /if \(PROTECTED\.has\(branch\)\)/);
  assert.match(src, /PROTECTED = new Set\(\['main', 'master'\]\)/);
});

test("importing the script opens no pull request", async () => {
  // The module is imported above for its helpers. Everything with an effect sits
  // behind an `import.meta.url === process.argv[1]` guard, and this test exists
  // because losing that guard would make `node --test` push a branch.
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../design-pr.mjs", import.meta.url), "utf8"),
  );
  assert.match(src, /process\.argv\[1\] === fileURLToPath\(import\.meta\.url\)/);
});
